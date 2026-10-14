import { Declared, LineSource, maskLine, RESERVED } from './context';

/** 呼び出しの開き括弧を探すために遡る行数の上限(閉じ忘れた括弧の影響を避ける) */
const MAX_LOOKBACK = 50;

export interface Call {
    /** 呼び出している関数名 */
    name: string;
    /** カーソルがある引数の位置(0 始まり) */
    activeParam: number;
}

/** 開き括弧の直前にある関数名。メソッド呼び出し(obj.Name)や関数の宣言は関数名として扱わない */
function nameBefore(code: string, open: number): string {
    let end = open;
    while (end > 0 && code[end - 1] === ' ') {
        end--;
    }
    let start = end;
    while (start > 0 && /\w/.test(code[start - 1])) {
        start--;
    }
    const name = code.slice(start, end);
    if (!/^[A-Za-z_]/.test(name) || (start > 0 && code[start - 1] === '.')) {
        return '';
    }
    const before = /([A-Za-z_]\w*)\s*$/.exec(code.slice(0, start));
    if (before && /^(function|script)$/i.test(before[1])) {
        return '';
    }
    return name;
}

/**
 * カーソル位置が、どの関数呼び出しの何番目の引数かを求める。
 * コメントと文字列は無視し、複数行にわたる呼び出しと入れ子の呼び出しに対応する。
 * If (...) や (a + b) のような、関数呼び出しでない括弧は飛ばして外側の呼び出しを返す。
 */
export function findCall(document: LineSource, position: { line: number; character: number }): Call | undefined {
    const stack: { name: string; commas: number }[] = [];

    for (let ln = Math.max(0, position.line - MAX_LOOKBACK); ln <= position.line; ln++) {
        let text = document.lineAt(ln).text;
        if (ln === position.line) {
            text = text.slice(0, position.character);
        }
        const { code } = maskLine(text);
        for (let i = 0; i < code.length; i++) {
            if (code[i] === '(') {
                stack.push({ name: nameBefore(code, i), commas: 0 });
            } else if (code[i] === ',' && stack.length > 0) {
                stack[stack.length - 1].commas++;
            } else if (code[i] === ')') {
                stack.pop();
            }
        }
    }

    for (let i = stack.length - 1; i >= 0; i--) {
        const { name, commas } = stack[i];
        if (name && !RESERVED.has(name.toLowerCase())) {
            return { name, activeParam: commas };
        }
    }
    return undefined;
}

/** シグネチャの全体と、各引数がその中で占める範囲 */
export function signatureParts(d: Declared): { label: string; params: [number, number][] } {
    let label = d.detail.slice(0, d.detail.indexOf('(') + 1);
    const params: [number, number][] = [];
    (d.params ?? []).forEach((p, i) => {
        if (i > 0) {
            label += ', ';
        }
        params.push([label.length, label.length + p.label.length]);
        label += p.label;
    });
    return { label: label + ')', params };
}
