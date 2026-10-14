/**
 * キーワード定義。出典は FSDN の "Keywords and Non-Required Keywords"。
 * where: top = 関数・スクリプトの外側、body = 内側、both = どちらでも
 */
export interface KeywordDef {
    label: string;
    detail: string;
    where: 'top' | 'body' | 'both';
}

export const KEYWORDS: KeywordDef[] = [
    // 関数・スクリプト
    { label: 'Function', detail: '関数の定義を開始します(EndFunction で終了)', where: 'top' },
    { label: 'Script', detail: 'スクリプトの定義を開始します(EndScript で終了)', where: 'top' },
    { label: 'Return', detail: '関数またはスクリプトの実行を終了します', where: 'body' },
    { label: 'Optional', detail: '以降の引数を省略可能にします', where: 'both' },
    { label: 'ByRef', detail: '引数を参照渡しにします', where: 'both' },

    // 制御構造
    { label: 'If', detail: '条件分岐を開始します(EndIf で終了)', where: 'body' },
    { label: 'While', detail: '条件ループを開始します(EndWhile で終了)', where: 'body' },
    { label: 'For', detail: 'カウンタループを開始します(EndFor で終了)', where: 'body' },
    { label: 'ForEach', detail: '要素ごとのループを開始します(EndForEach で終了)', where: 'body' },
    { label: 'To', detail: 'For ループの終了値を指定します', where: 'body' },
    { label: 'Descending', detail: 'For ループを降順にします', where: 'body' },
    { label: 'In', detail: 'ForEach で処理する構造体を指定します', where: 'body' },
    { label: 'Then', detail: 'If / ElIf の条件の後に置けます(省略可)', where: 'body' },
    { label: 'Not', detail: '条件を反転します(! 演算子と同じ)', where: 'body' },
    { label: 'Let', detail: '代入を開始します(省略可)', where: 'body' },

    // 変数・定数
    { label: 'Const', detail: '定数の宣言部を開始します', where: 'top' },
    { label: 'Globals', detail: 'グローバル変数の宣言部を開始します', where: 'top' },
    { label: 'Var', detail: 'ローカル変数の宣言部を開始します', where: 'body' },

    // 型
    { label: 'Void', detail: '戻り値なし', where: 'both' },
    { label: 'Int', detail: '整数型', where: 'both' },
    { label: 'String', detail: '文字列型', where: 'both' },
    { label: 'Handle', detail: 'ハンドル型', where: 'both' },
    { label: 'Object', detail: 'オブジェクト型', where: 'both' },
    { label: 'Variant', detail: 'バリアント型', where: 'both' },
    { label: 'Collection', detail: 'コレクション型', where: 'both' },
    { label: 'New', detail: 'コレクションや配列を生成します', where: 'body' },
    { label: 'IntArray', detail: '整数の配列型', where: 'both' },
    { label: 'StringArray', detail: '文字列の配列型', where: 'both' },
    { label: 'HandleArray', detail: 'ハンドルの配列型', where: 'both' },
    { label: 'ObjectArray', detail: 'オブジェクトの配列型', where: 'both' },
    { label: 'VariantArray', detail: 'バリアントの配列型', where: 'both' },

    // コンパイラ指令
    { label: 'Include', detail: 'ヘッダーファイルを取り込みます', where: 'top' },
    { label: 'Use', detail: 'スクリプトバイナリを取り込みます', where: 'top' },
    { label: 'Import', detail: 'ファイルを取り込みます', where: 'top' },
    { label: 'Prototype', detail: '関数のプロトタイプを宣言します', where: 'top' },
    { label: 'ScriptFile', detail: 'スクリプトファイル名を指定します', where: 'top' },
    { label: 'ScriptFileVersion', detail: 'スクリプトファイルのバージョンを指定します', where: 'top' },
];
