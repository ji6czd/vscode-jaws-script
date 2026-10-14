import * as vscode from 'vscode';
import { findCall, signatureParts } from './call';
import { registerCompileCommand } from './compile';
import { analyze, Block, CLOSER_LABEL, Declared } from './context';
import { DIRECTIVE_RE, directiveFileItems, includedDeclarations } from './includes';
import { KEYWORDS } from './keywords';

function keywordItems(inBody: boolean): vscode.CompletionItem[] {
    return KEYWORDS.filter((k) => k.where === 'both' || k.where === (inBody ? 'body' : 'top')).map((k) => {
        const item = new vscode.CompletionItem(k.label, vscode.CompletionItemKind.Keyword);
        item.detail = k.detail;
        return item;
    });
}

/** 開いているブロックを閉じるキーワードと、そのブロック内で使える分岐キーワード */
function blockItems(innermost: Block): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const closer = new vscode.CompletionItem(CLOSER_LABEL[innermost], vscode.CompletionItemKind.Keyword);
    closer.detail = '開いているブロックを閉じます';
    closer.sortText = '0';
    items.push(closer);

    if (innermost === 'if') {
        for (const label of ['ElIf', 'Else']) {
            const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
            item.detail = 'If の分岐';
            item.sortText = '0';
            items.push(item);
        }
    }
    return items;
}

const DECLARED_KIND = {
    variable: vscode.CompletionItemKind.Variable,
    constant: vscode.CompletionItemKind.Constant,
    function: vscode.CompletionItemKind.Function,
};

/** 同じファイルで宣言された名前。大文字小文字を区別せず、先に現れたもの(ローカル優先)を採用する */
function declaredItems(declared: Declared[]): vscode.CompletionItem[] {
    const seen = new Set<string>();
    const items: vscode.CompletionItem[] = [];
    for (const d of declared) {
        const key = d.name.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const item = new vscode.CompletionItem(d.name, DECLARED_KIND[d.kind]);
        item.detail = d.source ? `${d.detail} · ${d.source}` : d.detail;
        if (d.documentation) {
            item.documentation = new vscode.MarkdownString(d.documentation);
        }
        if (d.detail.endsWith('(local)')) {
            item.sortText = '1' + d.name;
        }
        items.push(item);
    }
    return items;
}

export function activate(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider(
        { language: 'jaws-script' },
        {
            async provideCompletionItems(document, position, _token, completionContext) {
                const prefix = document.lineAt(position.line).text.slice(0, position.character);
                const directive = DIRECTIVE_RE.exec(prefix);
                if (directive) {
                    return directiveFileItems(document, position, directive[1], directive[2]);
                }
                // 引用符やパス区切りで自動的に呼ばれたのは、ファイル名の補完のためだけ
                if (completionContext.triggerCharacter) {
                    return undefined;
                }

                const ctx = analyze(document, position);
                if (ctx.suppressed) {
                    return undefined;
                }

                const inBody = ctx.stack.some((b) => b === 'script' || b === 'function');
                const items = keywordItems(inBody);
                if (inBody) {
                    // 現在のファイルの名前を先に並べ、同名なら現在のファイルを優先する
                    const included = await includedDeclarations(document);
                    items.push(...declaredItems([...ctx.declared, ...included]));
                }
                if (ctx.stack.length > 0) {
                    items.push(...blockItems(ctx.stack[ctx.stack.length - 1]));
                }
                return items;
            },
        },
        '"',
        '/',
        '\\'
    );
    context.subscriptions.push(provider);

    const signatures = vscode.languages.registerSignatureHelpProvider(
        { language: 'jaws-script' },
        {
            async provideSignatureHelp(document, position) {
                const call = findCall(document, position);
                if (!call) {
                    return undefined;
                }

                // 補完と同じ優先順位で、同名の関数のうち先に宣言されたものを使う
                const ctx = analyze(document, position);
                const included = await includedDeclarations(document);
                const key = call.name.toLowerCase();
                const found = [...ctx.declared, ...included].find(
                    (d) => d.kind === 'function' && d.params && d.name.toLowerCase() === key
                );
                if (!found) {
                    return undefined;
                }

                const parts = signatureParts(found);
                const signature = new vscode.SignatureInformation(
                    parts.label,
                    found.summary ? new vscode.MarkdownString(found.summary) : undefined
                );
                signature.parameters = (found.params ?? []).map(
                    (p, i) =>
                        new vscode.ParameterInformation(
                            parts.params[i],
                            p.documentation ? new vscode.MarkdownString(p.documentation) : undefined
                        )
                );

                const help = new vscode.SignatureHelp();
                help.signatures = [signature];
                help.activeSignature = 0;
                help.activeParameter = call.activeParam;
                return help;
            },
        },
        { triggerCharacters: ['(', ','], retriggerCharacters: [',', ')'] }
    );
    context.subscriptions.push(signatures);

    registerCompileCommand(context);
}

export function deactivate() {}
