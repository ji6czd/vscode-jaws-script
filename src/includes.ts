import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Declared, LineSource, scanDeclarations } from './context';
import { parseJsd } from './jsd';

interface Cached {
    mtimeMs: number;
    declared: Declared[];
    includes: string[];
    /** Use / Import で参照している .jsd のファイル名 */
    jsds: string[];
}

const cache = new Map<string, Cached>();
const jsdCache = new Map<string, { mtimeMs: number; declared: Declared[] }>();
const INCLUDE_RE = /^\s*include\s+"([^"]+)"/i;
const JSD_REF_RE = /^\s*(use|import)\s+"([^"]+)"/i;

/** どのスクリプトからも暗黙に参照される、組み込み関数の定義 */
const BUILTIN_JSD = 'builtin.jsd';

/** Include の入れ子をたどる深さの上限(循環は visited で防ぐ) */
const MAX_DEPTH = 8;

/** ファイル中の Include "名前" を集める */
function findIncludes(source: LineSource): string[] {
    const names: string[] = [];
    for (let ln = 0; ln < source.lineCount; ln++) {
        const m = INCLUDE_RE.exec(source.lineAt(ln).text);
        if (m) {
            names.push(m[1]);
        }
    }
    return names;
}

/**
 * Use / Import "名前" が参照する .jsd のファイル名を集める。
 * Use はスクリプトバイナリ(.jsb)を取るので、同名の .jsd が定義ファイルになる。
 */
function findJsdRefs(source: LineSource): string[] {
    const names: string[] = [];
    for (let ln = 0; ln < source.lineCount; ln++) {
        const m = JSD_REF_RE.exec(source.lineAt(ln).text);
        if (m) {
            names.push(m[2].replace(/\.[^./\\]+$/, '') + '.jsd');
        }
    }
    return names;
}

function decode(buf: Buffer): string {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        return buf.toString('utf16le');
    }
    // Shift_JIS の日本語はコメントや文字列にしか現れないので、UTF-8 として読んでも宣言は読める
    return buf.toString('utf8');
}

function toLineSource(text: string): LineSource {
    const lines = text.split(/\r\n|\r|\n/);
    return { lineCount: lines.length, lineAt: (n) => ({ text: lines[n] }) };
}

async function load(file: string): Promise<Cached | undefined> {
    try {
        const { mtimeMs } = await fs.stat(file);
        const hit = cache.get(file);
        if (hit && hit.mtimeMs === mtimeMs) {
            return hit;
        }
        const source = toLineSource(decode(await fs.readFile(file)));
        const loaded = {
            mtimeMs,
            declared: scanDeclarations(source),
            includes: findIncludes(source),
            jsds: findJsdRefs(source),
        };
        cache.set(file, loaded);
        return loaded;
    } catch {
        return undefined;
    }
}

async function loadJsd(file: string): Promise<Declared[]> {
    try {
        const { mtimeMs } = await fs.stat(file);
        const hit = jsdCache.get(file);
        if (hit && hit.mtimeMs === mtimeMs) {
            return hit.declared;
        }
        const declared = parseJsd(decode(await fs.readFile(file)), path.basename(file));
        jsdCache.set(file, { mtimeMs, declared });
        return declared;
    } catch {
        return [];
    }
}

async function resolve(name: string, dirs: string[]): Promise<string | undefined> {
    for (const dir of dirs) {
        const candidate = path.resolve(dir, name);
        try {
            if ((await fs.stat(candidate)).isFile()) {
                return candidate;
            }
        } catch {
            // 次の候補へ
        }
    }
    return undefined;
}

async function isDirectory(dir: string): Promise<boolean> {
    try {
        return (await fs.stat(dir)).isDirectory();
    } catch {
        return false;
    }
}

/**
 * インストールされている JAWS の、スクリプトとヘッダーのフォルダーを推定する。
 * バージョンは設定 jawsScript.jawsVersion、なければ ProgramData にある最新のもの。
 * 言語は設定 jawsScript.language、なければ VS Code の表示言語(ja なら jpn、それ以外は enu)を優先する。
 */
export async function detectJawsDirs(): Promise<string[]> {
    if (process.platform !== 'win32') {
        return [];
    }
    const config = vscode.workspace.getConfiguration('jawsScript');
    const shared = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Freedom Scientific', 'JAWS');

    let version = config.get<string>('jawsVersion', '').trim();
    if (!version) {
        try {
            const entries = await fs.readdir(shared, { withFileTypes: true });
            version =
                entries
                    .filter((e) => e.isDirectory() && /^\d+(\.\d+)?$/.test(e.name))
                    .map((e) => e.name)
                    .sort((a, b) => parseFloat(b) - parseFloat(a))[0] ?? '';
        } catch {
            return [];
        }
    }
    if (!version) {
        return [];
    }

    const sharedSettings = path.join(shared, version, 'SETTINGS');
    const userSettings = path.join(process.env.APPDATA ?? '', 'Freedom Scientific', 'JAWS', version, 'Settings');

    let language = config.get<string>('language', '').trim();
    if (!language) {
        const preferred = vscode.env.language.startsWith('ja') ? ['jpn', 'enu'] : ['enu', 'jpn'];
        language = preferred.find((l) => existsSync(path.join(sharedSettings, l))) ?? preferred[0];
    }

    // builtin.jsd は Scripts\<言語> の下にある
    const scripts = path.join(shared, version, 'Scripts');
    const dirs = [path.join(scripts, language), scripts, path.join(sharedSettings, language)];
    if (process.env.APPDATA) {
        dirs.push(path.join(userSettings, language));
    }
    const found: string[] = [];
    for (const dir of dirs) {
        if (await isDirectory(dir)) {
            found.push(dir);
        }
    }
    return found;
}

async function searchDirs(document: vscode.TextDocument): Promise<string[]> {
    const dirs: string[] = [];
    if (document.uri.scheme === 'file') {
        dirs.push(path.dirname(document.uri.fsPath));
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (folder.uri.scheme === 'file') {
            dirs.push(folder.uri.fsPath);
        }
    }
    dirs.push(...vscode.workspace.getConfiguration('jawsScript').get<string[]>('includePaths', []));
    dirs.push(...(await detectJawsDirs()));
    return dirs;
}

/** ファイル名を取るディレクティブと、補完するファイルの拡張子 */
const DIRECTIVE_EXTENSIONS: Record<string, string[]> = {
    include: ['.jsh', '.jsm'],
    use: ['.jsb'],
    import: ['.jsd'],
};

/** カーソルが Include / Use / Import の引用符の中にあるか。[1] がディレクティブ、[2] が入力済みのパス */
export const DIRECTIVE_RE = /^\s*(include|use|import)\s+"([^"]*)$/i;

/** Include / Use / Import "..." の中で、探索先にあるファイルとフォルダーを候補にする */
export async function directiveFileItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    directive: string,
    typed: string
): Promise<vscode.CompletionItem[]> {
    const extensions = DIRECTIVE_EXTENSIONS[directive.toLowerCase()] ?? [];
    const sep = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\'));
    const dirPart = typed.slice(0, sep + 1);
    const namePart = typed.slice(sep + 1);
    // 既定の単語範囲は '.' で切れるので、入力済みのファイル名部分を置換範囲にする
    const range = new vscode.Range(position.line, position.character - namePart.length, position.line, position.character);

    const items: vscode.CompletionItem[] = [];
    const seen = new Set<string>();
    const dirs = await searchDirs(document);
    for (const [order, dir] of dirs.entries()) {
        const target = path.resolve(dir, dirPart);
        let entries;
        try {
            entries = await fs.readdir(target, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const key = entry.name.toLowerCase();
            const isDir = entry.isDirectory();
            if (seen.has(key) || (!isDir && !extensions.includes(path.extname(key)))) {
                continue;
            }
            seen.add(key);

            const item = new vscode.CompletionItem(
                entry.name,
                isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
            );
            item.detail = target;
            item.range = range;
            item.sortText = String(order).padStart(2, '0') + key;
            if (isDir) {
                item.insertText = entry.name + '/';
                item.command = { command: 'editor.action.triggerSuggest', title: '' };
            }
            items.push(item);
        }
    }
    return items;
}

/**
 * 現在のファイル以外で宣言された名前を集める。同名のときは先に並んだものが優先される。
 * 1. Include されているファイル(入れ子を含む)の変数・定数・関数
 * 2. Use / Import した .jsd の関数(Use は組み込みの定義を上書きできる)
 * 3. builtin.jsd の組み込み関数
 */
export async function includedDeclarations(document: vscode.TextDocument): Promise<Declared[]> {
    const out: Declared[] = [];
    const visited = new Set<string>();
    const jsds: string[] = [];
    if (document.uri.scheme === 'file') {
        visited.add(document.uri.fsPath.toLowerCase());
    }

    async function visit(names: string[], dirs: string[], depth: number) {
        for (const name of names) {
            const file = await resolve(name, dirs);
            if (!file || visited.has(file.toLowerCase())) {
                continue;
            }
            visited.add(file.toLowerCase());

            const info = await load(file);
            if (!info) {
                continue;
            }
            const source = path.basename(file);
            out.push(...info.declared.map((d) => ({ ...d, source })));
            jsds.push(...info.jsds);
            if (depth < MAX_DEPTH) {
                await visit(info.includes, [path.dirname(file), ...dirs], depth + 1);
            }
        }
    }

    const dirs = await searchDirs(document);
    await visit(findIncludes(document), dirs, 0);

    const loadedJsds = new Set<string>();
    for (const name of [...findJsdRefs(document), ...jsds, BUILTIN_JSD]) {
        const file = await resolve(name, dirs);
        if (file && !loadedJsds.has(file.toLowerCase())) {
            loadedJsds.add(file.toLowerCase());
            out.push(...(await loadJsd(file)));
        }
    }
    return out;
}
