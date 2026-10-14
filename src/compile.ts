import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface CompilerMessage {
    file: string;
    /** 1 始まり */
    line: number;
    /** 0 のときは行全体を指す */
    column: number;
    severity: 'error' | 'warning';
    message: string;
}

/**
 * scompile.exe の出力から、次の形式の行を取り出す。
 *   file C:\path\to\file.jss, line 8, column 0: Error: Unknown variable hoge
 */
export function parseCompilerOutput(text: string): CompilerMessage[] {
    const messages: CompilerMessage[] = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
        const m = /^file (.+), line (\d+), column (\d+): (Error|Warning):?\s*(.*)$/i.exec(line.trim());
        if (m) {
            messages.push({
                file: m[1],
                line: Number(m[2]),
                column: Number(m[3]),
                severity: m[4].toLowerCase() === 'warning' ? 'warning' : 'error',
                message: m[5],
            });
        }
    }
    return messages;
}

/** scompile.exe の場所。設定があればそれを使い、なければインストールされている JAWS から探す */
async function findCompiler(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('jawsScript');
    const configured = config.get<string>('compilerPath', '').trim();
    if (configured) {
        return configured;
    }

    const version = config.get<string>('jawsVersion', '').trim();
    for (const programFiles of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
        if (!programFiles) {
            continue;
        }
        const root = path.join(programFiles, 'Freedom Scientific', 'JAWS');
        let versions: string[];
        try {
            versions = version
                ? [version]
                : (await fs.readdir(root, { withFileTypes: true }))
                      .filter((e) => e.isDirectory() && /^\d+(\.\d+)?$/.test(e.name))
                      .map((e) => e.name)
                      .sort((a, b) => parseFloat(b) - parseFloat(a));
        } catch {
            continue;
        }
        for (const v of versions) {
            const candidate = path.join(root, v, 'scompile.exe');
            try {
                await fs.access(candidate);
                return candidate;
            } catch {
                // 次の候補へ
            }
        }
    }
    return undefined;
}

/** 終了コードを符号付きで表す(-1 が 4294967295 と出るので) */
function exitCode(code: unknown): string {
    if (typeof code !== 'number') {
        return '';
    }
    return ` (終了コード ${code > 0x7fffffff ? code - 0x100000000 : code})`;
}

/** 「JAWS Script: Compile」コマンドを登録する */
export function registerCompileCommand(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('JAWS Script');
    const diagnostics = vscode.languages.createDiagnosticCollection('jaws-script');
    context.subscriptions.push(output, diagnostics);

    function publish(text: string) {
        diagnostics.clear();
        const byFile = new Map<string, { uri: vscode.Uri; items: vscode.Diagnostic[] }>();
        for (const m of parseCompilerOutput(text)) {
            const line = Math.max(0, m.line - 1);
            // 列の基準が分からないので、列があればそこから行末まで、なければ行全体を示す
            const start = m.column > 0 ? m.column - 1 : 0;
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(line, start, line, Number.MAX_SAFE_INTEGER),
                m.message,
                m.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = 'scompile';

            const key = m.file.toLowerCase();
            const entry = byFile.get(key) ?? { uri: vscode.Uri.file(m.file), items: [] };
            entry.items.push(diagnostic);
            byFile.set(key, entry);
        }
        for (const { uri, items } of byFile.values()) {
            diagnostics.set(uri, items);
        }
    }

    async function compile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'jaws-script' || editor.document.uri.scheme !== 'file') {
            vscode.window.showWarningMessage('JAWS Script: コンパイルする .jss ファイルを開いてください。');
            return;
        }
        if (process.platform !== 'win32') {
            vscode.window.showWarningMessage('JAWS Script: コンパイルは Windows でのみ使えます。');
            return;
        }

        const compiler = await findCompiler();
        if (!compiler) {
            vscode.window.showErrorMessage(
                'JAWS Script: scompile.exe が見つかりません。設定 jawsScript.compilerPath に場所を指定してください。'
            );
            return;
        }

        if (editor.document.isDirty && !(await editor.document.save())) {
            return;
        }

        const file = editor.document.uri.fsPath;
        output.clear();
        output.show(true);
        output.appendLine(`> "${compiler}" "${file}"`);

        await new Promise<void>((resolve) => {
            execFile(
                compiler,
                [file],
                { cwd: path.dirname(file), windowsHide: true, encoding: 'buffer' },
                (error, stdout, stderr) => {
                    const text = Buffer.concat([stdout, stderr]).toString('utf8').trimEnd();
                    if (text) {
                        output.appendLine(text);
                    }
                    publish(text);

                    if (error) {
                        output.appendLine(`\nコンパイルに失敗しました${exitCode(error.code)}`);
                        vscode.window.showErrorMessage(`JAWS Script: コンパイルに失敗しました。${path.basename(file)}`);
                    } else {
                        output.appendLine('\nコンパイルが終了しました。');
                        vscode.window.setStatusBarMessage(`JAWS Script: ${path.basename(file)} をコンパイルしました`, 5000);
                    }
                    resolve();
                }
            );
        });
    }

    context.subscriptions.push(vscode.commands.registerCommand('jawsScript.compile', compile));
}
