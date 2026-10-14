import { Declared } from './context';

/**
 * スクリプトドキュメントファイル(.jsd)の読み込み。builtin.jsd や、Use / Import したファイルが対象。
 * 書式は 1 行 1 フィールドで、`:function 名前` または `:script 名前` がレコードの始まり。
 *   :Synopsis 概要
 *   :Description 説明
 *   :Returns 型 説明
 *   :Param 型[/byRef]/名前 説明   (名前は省略されることがある)
 *   :Optional                      (これ以降の引数が省略可能)
 *   :Category カテゴリ
 */
interface Param {
    type: string;
    name: string;
    byRef: boolean;
    optional: boolean;
    description: string;
}

interface Entry {
    kind: 'function' | 'script';
    name: string;
    synopsis: string;
    description: string;
    returnType: string;
    returnDescription: string;
    params: Param[];
    category: string;
}

function newEntry(kind: Entry['kind'], name: string): Entry {
    return {
        kind,
        name,
        synopsis: '',
        description: '',
        returnType: '',
        returnDescription: '',
        params: [],
        category: '',
    };
}

const TYPE_NAMES = new Map(
    [
        'Void',
        'Int',
        'String',
        'Handle',
        'Object',
        'Variant',
        'Collection',
        'IntArray',
        'StringArray',
        'HandleArray',
        'ObjectArray',
        'VariantArray',
    ].map((t) => [t.toLowerCase(), t])
);

/** 型名の大文字小文字がファイルによって揺れているので、正規の綴りにそろえる */
function canonicalType(type: string): string {
    return TYPE_NAMES.get(type.toLowerCase()) ?? type;
}

/** `型`、`型/名前`、`型/byRef`、`型/byRef/名前` のいずれか */
function parseParam(spec: string, description: string, optional: boolean): Param {
    const [rawType, ...rest] = spec.split('/');
    const type = canonicalType(rawType);
    const byRef = rest.length > 0 && rest[0].toLowerCase() === 'byref';
    const name = (byRef ? rest.slice(1) : rest).join('/');
    return { type, name, byRef, optional, description };
}

function parseEntries(text: string): Entry[] {
    const entries: Entry[] = [];
    let current: Entry | undefined;
    let optional = false;

    for (const line of text.split(/\r\n|\r|\n/)) {
        const m = /^:(\w+)\s*(.*)$/.exec(line);
        if (!m) {
            continue;
        }
        const key = m[1].toLowerCase();
        const value = m[2].trim();

        if (key === 'function' || key === 'script') {
            current = newEntry(key, value);
            entries.push(current);
            optional = false;
            continue;
        }
        if (!current) {
            continue;
        }
        switch (key) {
            case 'synopsis':
                current.synopsis = value;
                break;
            case 'description':
                current.description = value;
                break;
            case 'returns': {
                const space = value.search(/\s/);
                current.returnType = canonicalType(space < 0 ? value : value.slice(0, space));
                current.returnDescription = space < 0 ? '' : value.slice(space).trim();
                break;
            }
            case 'optional':
                optional = true;
                break;
            case 'param': {
                const space = value.search(/\s/);
                const spec = space < 0 ? value : value.slice(0, space);
                const description = space < 0 ? '' : value.slice(space).trim();
                current.params.push(parseParam(spec, description, optional));
                break;
            }
            case 'category':
                current.category = value;
                break;
        }
    }
    return entries;
}

/** 引数の表記。Optional は、最初に省略可能になる引数の前にだけ付ける */
function paramLabels(e: Entry): string[] {
    let inOptional = false;
    return e.params.map((p, i) => {
        const optional = p.optional && !inOptional ? 'Optional ' : '';
        inOptional = inOptional || p.optional;
        return `${optional}${p.type}${p.byRef ? ' ByRef' : ''} ${p.name || `arg${i + 1}`}`;
    });
}

function signature(e: Entry): string {
    if (e.kind === 'script') {
        return `Script ${e.name}()`;
    }
    return `${e.returnType || 'Void'} ${e.name}(${paramLabels(e).join(', ')})`;
}

/** 概要・説明・戻り値(引数ごとの説明は含めない) */
function summary(e: Entry): string {
    const blocks: string[] = [];
    if (e.synopsis) {
        blocks.push(`**${e.synopsis}**`);
    }
    if (e.description) {
        blocks.push(e.description);
    }
    if (e.returnType && e.returnDescription) {
        blocks.push(`**Returns** \`${e.returnType}\` ${e.returnDescription}`);
    }
    return blocks.join('\n\n');
}

function documentation(e: Entry): string {
    const blocks: string[] = [];
    const head = summary(e);
    if (head) {
        blocks.push(head);
    }
    if (e.params.length > 0) {
        const lines = e.params.map((p, i) => {
            const label = `${p.type}${p.byRef ? ' ByRef' : ''} ${p.name || `arg${i + 1}`}`;
            return `- \`${label}\`${p.optional ? ' (optional)' : ''}${p.description ? ' — ' + p.description : ''}`;
        });
        blocks.push('**Parameters**\n\n' + lines.join('\n'));
    }
    if (e.category) {
        blocks.push(`Category: ${e.category}`);
    }
    return blocks.join('\n\n');
}

/** .jsd のテキストを、補完用の宣言に変換する */
export function parseJsd(text: string, source: string): Declared[] {
    return parseEntries(text).map((e) => {
        const labels = paramLabels(e);
        return {
            name: e.name,
            kind: 'function',
            detail: signature(e),
            documentation: documentation(e),
            summary: summary(e),
            params:
                e.kind === 'script'
                    ? undefined
                    : e.params.map((p, i) => ({ label: labels[i], documentation: p.description || undefined })),
            source,
        };
    });
}
