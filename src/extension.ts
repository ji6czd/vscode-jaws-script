import * as vscode from 'vscode';
import { analyze, Block, CLOSER_LABEL, Declared } from './context';
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
        item.detail = d.detail;
        if (d.detail.endsWith('(local)')) {
            item.sortText = '1' + d.name;
        }
        items.push(item);
    }
    return items;
}

function functionItems(): vscode.CompletionItem[] {
    // TODO: .jsd パーサーから動的生成する
    const sayString = new vscode.CompletionItem('SayString', vscode.CompletionItemKind.Function);
    sayString.detail = 'void SayString(String sText, int nPunc)';
    sayString.documentation = new vscode.MarkdownString('指定したテキストを読み上げます。');

    const sayMessage = new vscode.CompletionItem('SayMessage', vscode.CompletionItemKind.Function);
    sayMessage.detail = 'void SayMessage(String sLongMessage, String sShortMessage)';
    sayMessage.documentation = new vscode.MarkdownString('メッセージを読み上げます。長いメッセージと短いメッセージを指定します。');

    return [sayString, sayMessage];
}

export function activate(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider(
        { language: 'jaws-script' },
        {
            provideCompletionItems(document, position) {
                const ctx = analyze(document, position);
                if (ctx.suppressed) {
                    return undefined;
                }

                const inBody = ctx.stack.some((b) => b === 'script' || b === 'function');
                const items = keywordItems(inBody);
                if (inBody) {
                    items.push(...declaredItems(ctx.declared), ...functionItems());
                }
                if (ctx.stack.length > 0) {
                    items.push(...blockItems(ctx.stack[ctx.stack.length - 1]));
                }
                return items;
            },
        }
    );
    context.subscriptions.push(provider);
}

export function deactivate() {}
