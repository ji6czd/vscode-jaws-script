import * as vscode from 'vscode';
import { KEYWORDS } from './keywords';

/** 開いているブロックの種類(小文字で保持する) */
export type Block = 'script' | 'function' | 'if' | 'while' | 'for' | 'foreach';

export interface Declared {
    name: string;
    kind: 'variable' | 'constant' | 'function';
    detail: string;
    /** Include / Use / Import したファイルから来た名前の場合、そのファイル名 */
    source?: string;
    /** 説明(Markdown) */
    documentation?: string;
    /** 概要と説明だけ(引数ヒントに使う。引数ごとの説明は params に持つ) */
    summary?: string;
    /** 関数の引数。スクリプトや変数には持たない。引数なしの関数は空配列 */
    params?: ParamInfo[];
}

export interface ParamInfo {
    /** `Optional Int ByRef iValue` のように、シグネチャにそのまま並べる表記 */
    label: string;
    documentation?: string;
}

/** 行単位で読めるテキスト。vscode.TextDocument と、ファイルから読んだ文字列の両方を扱う */
export interface LineSource {
    lineCount: number;
    lineAt(line: number): { text: string };
}

export interface Context {
    /** コメント・文字列・Messages ブロックの内側にいる(補完しない) */
    suppressed: boolean;
    /** カーソル位置で開いているブロック。末尾が最も内側 */
    stack: Block[];
    /** 現在のファイルで宣言されている、カーソル位置から参照できる名前 */
    declared: Declared[];
}

const OPENERS: Record<string, Block> = {
    script: 'script',
    function: 'function',
    if: 'if',
    while: 'while',
    for: 'for',
    foreach: 'foreach',
};

const CLOSERS: Record<string, Block> = {
    endscript: 'script',
    endfunction: 'function',
    endif: 'if',
    endwhile: 'while',
    endfor: 'for',
    endforeach: 'foreach',
};

/** 各ブロックを閉じるキーワード */
export const CLOSER_LABEL: Record<Block, string> = {
    script: 'EndScript',
    function: 'EndFunction',
    if: 'EndIf',
    while: 'EndWhile',
    for: 'EndFor',
    foreach: 'EndForEach',
};

export const RESERVED = new Set(KEYWORDS.map((k) => k.label.toLowerCase()));

const TYPES =
    'int|string|handle|object|variant|collection|intarray|stringarray|handlearray|objectarray|variantarray';
/** 変数宣言と引数宣言: 型 [ByRef] 名前 */
const DECL_RE = new RegExp(`\\b(${TYPES})\\s+(?:byref\\s+)?([A-Za-z_]\\w*)`, 'gi');
/** 定数宣言: 名前 = 値 */
const CONST_RE = /(?:^|[,\s])([A-Za-z_]\w*)\s*=(?!=)/g;

/** 複数行にわたる関数ヘッダーを読み続ける行数の上限 */
const MAX_HEADER_LINES = 10;

interface Header {
    kind: 'function' | 'script';
    prefix: string;
    text: string;
    line: number;
    lines: number;
    scopeId: number;
    record: boolean;
}

interface State {
    stack: Block[];
    inMessages: boolean;
    scopeId: number;
    header: Header | undefined;
}

interface Local {
    name: string;
    type: string;
    scopeId: number;
    line: number;
}

interface Recorder {
    locals: Local[];
    globals: Declared[];
    constants: Declared[];
    functions: Declared[];
}

/**
 * コメントと文字列の中身を空白に置き換える(長さは変えない)。
 * open は、行がコメントまたは閉じていない文字列で終わることを示す。
 */
export function maskLine(line: string): { code: string; open: boolean } {
    let code = '';
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === ';') {
            return { code: code + ' '.repeat(line.length - i), open: true };
        }
        if (ch === '"') {
            const close = line.indexOf('"', i + 1);
            if (close < 0) {
                return { code: code + ' '.repeat(line.length - i), open: true };
            }
            code += '"' + ' '.repeat(close - i - 1) + '"';
            i = close + 1;
            continue;
        }
        code += ch;
        i++;
    }
    return { code, open: false };
}

function cloneState(s: State): State {
    return { ...s, stack: [...s.stack], header: s.header && { ...s.header } };
}

function inBody(stack: Block[]): boolean {
    return stack.some((b) => b === 'script' || b === 'function');
}

function countOf(text: string, ch: string): number {
    return text.split(ch).length - 1;
}

/** 関数ヘッダーを読み終えたかどうか(括弧が閉じたか) */
function headerComplete(h: Header): boolean {
    const opens = countOf(h.text, '(');
    return opens > 0 && countOf(h.text, ')') >= opens;
}

function finishHeader(state: State, rec: Recorder | null) {
    const h = state.header;
    state.header = undefined;
    if (!h || !rec || !h.record) {
        return;
    }
    const open = h.text.indexOf('(');
    const close = h.text.lastIndexOf(')');
    const nameMatch = /^\s*([A-Za-z_]\w*)/.exec(h.text);
    if (!nameMatch) {
        return;
    }
    const params = open >= 0 ? h.text.slice(open + 1, close >= 0 ? close : undefined) : '';

    const keyword = h.kind === 'function' ? 'Function' : 'Script';
    const labels = params
        .split(',')
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => p.length > 0);
    const signature = `${h.prefix ? h.prefix + ' ' : ''}${keyword} ${nameMatch[1]}(${labels.join(', ')})`;
    rec.functions.push({
        name: nameMatch[1],
        kind: 'function',
        detail: signature,
        params: h.kind === 'function' ? labels.map((label) => ({ label })) : undefined,
    });

    for (const m of params.matchAll(DECL_RE)) {
        if (!RESERVED.has(m[2].toLowerCase())) {
            rec.locals.push({ name: m[2], type: m[1], scopeId: h.scopeId, line: h.line });
        }
    }
}

/**
 * 1行ぶん状態を進める。rec が null のときは名前を記録しない。
 * dropTrailing は、カーソルに接した入力途中の語を数えない指定。
 */
function step(state: State, code: string, ln: number, rec: Recorder | null, dropTrailing: boolean) {
    const firstNonSpace = code.search(/\S/);
    if (firstNonSpace < 0) {
        return;
    }

    let words = [...code.matchAll(/[A-Za-z_]\w*/g)].map((m) => ({
        text: m[0],
        index: m.index ?? 0,
    }));
    if (dropTrailing && words.length > 0) {
        const last = words[words.length - 1];
        if (last.index + last.text.length === code.length) {
            words = words.slice(0, -1);
        }
    }
    const first = words.length > 0 && words[0].index === firstNonSpace ? words[0].text.toLowerCase() : '';

    if (state.inMessages) {
        if (first === 'endmessages') {
            state.inMessages = false;
        } else if (rec) {
            const m = /^\s*@([A-Za-z_]\w*)/.exec(code);
            if (m) {
                rec.constants.push({ name: m[1], kind: 'constant', detail: 'Message' });
            }
        }
        return;
    }
    if (first === 'messages' && state.stack.length === 0) {
        state.inMessages = true;
        return;
    }
    if (first === 'prototype') {
        return;
    }

    if (state.header) {
        state.header.text += ' ' + code;
        state.header.lines++;
        if (headerComplete(state.header) || state.header.lines > MAX_HEADER_LINES) {
            finishHeader(state, rec);
        }
        return;
    }

    let startedHeader = false;
    for (const { text, index } of words) {
        const key = text.toLowerCase();
        if (key in OPENERS) {
            const block = OPENERS[key];
            state.stack.push(block);
            if (block === 'script' || block === 'function') {
                state.scopeId++;
                state.header = {
                    kind: block,
                    prefix: code.slice(0, index).trim(),
                    text: code.slice(index + text.length),
                    line: ln,
                    lines: 1,
                    scopeId: state.scopeId,
                    record: rec !== null,
                };
                startedHeader = true;
                if (headerComplete(state.header)) {
                    finishHeader(state, rec);
                }
                break;
            }
        } else if (key in CLOSERS) {
            const idx = state.stack.lastIndexOf(CLOSERS[key]);
            if (idx >= 0) {
                state.stack.length = idx;
            }
        }
    }

    if (!rec || startedHeader) {
        return;
    }
    if (inBody(state.stack)) {
        for (const m of code.matchAll(DECL_RE)) {
            if (!RESERVED.has(m[2].toLowerCase())) {
                rec.locals.push({ name: m[2], type: m[1], scopeId: state.scopeId, line: ln });
            }
        }
    } else if (state.stack.length === 0) {
        for (const m of code.matchAll(DECL_RE)) {
            if (!RESERVED.has(m[2].toLowerCase())) {
                rec.globals.push({ name: m[2], kind: 'variable', detail: `${m[1]} (global)` });
            }
        }
        for (const m of code.matchAll(CONST_RE)) {
            if (!RESERVED.has(m[1].toLowerCase())) {
                rec.constants.push({ name: m[1], kind: 'constant', detail: 'Const' });
            }
        }
    }
}

/** ファイル全体から、グローバル変数・定数・関数の宣言を集める(ヘッダーファイル用) */
export function scanDeclarations(source: LineSource): Declared[] {
    const state: State = { stack: [], inMessages: false, scopeId: 0, header: undefined };
    const rec: Recorder = { locals: [], globals: [], constants: [], functions: [] };
    for (let ln = 0; ln < source.lineCount; ln++) {
        step(state, maskLine(source.lineAt(ln).text).code, ln, rec, false);
    }
    return [...rec.globals, ...rec.constants, ...rec.functions];
}

/** ドキュメント全体を走査して、カーソル位置の文脈と参照できる名前を求める */
export function analyze(document: LineSource, position: vscode.Position): Context {
    const state: State = { stack: [], inMessages: false, scopeId: 0, header: undefined };
    const rec: Recorder = { locals: [], globals: [], constants: [], functions: [] };
    let snapshot: { suppressed: boolean; stack: Block[]; scopeId: number } | undefined;

    for (let ln = 0; ln < document.lineCount; ln++) {
        const text = document.lineAt(ln).text;

        if (ln === position.line) {
            // カーソル行は、カーソルより前だけで状態を求める。この行の宣言は記録しない
            const prefix = maskLine(text.slice(0, position.character));
            const snap = cloneState(state);
            step(snap, prefix.code, ln, null, true);
            snapshot = {
                suppressed: prefix.open || snap.inMessages,
                stack: snap.stack,
                scopeId: snap.scopeId,
            };
            step(state, maskLine(text).code, ln, null, false);
        } else {
            step(state, maskLine(text).code, ln, rec, false);
        }
    }

    const snap = snapshot ?? { suppressed: false, stack: [], scopeId: 0 };
    const declared: Declared[] = [];
    if (inBody(snap.stack)) {
        for (const l of rec.locals) {
            if (l.scopeId === snap.scopeId && l.line < position.line) {
                declared.push({ name: l.name, kind: 'variable', detail: `${l.type} (local)` });
            }
        }
    }
    declared.push(...rec.globals, ...rec.constants, ...rec.functions);

    return { suppressed: snap.suppressed, stack: snap.stack, declared };
}
