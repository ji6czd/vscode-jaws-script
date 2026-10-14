# JAWS Script

VS Code で JAWS のスクリプト(`.jss`)を書くための拡張機能です。

## 機能

- **補完**: キーワード、現在のファイルの変数・定数・関数、`Include` したファイルの宣言、JAWS 組み込み関数
- **ファイル名の補完**: `Include` / `Use` / `Import` の引用符の中
- **引数のヒント**: 関数名の後ろの `(` や `,` を入力したとき
- **コンパイル**: コマンドパレットの「JAWS Script: Compile」。エラーは該当行に表示されます

組み込み関数は、インストールされている JAWS の `builtin.jsd` から読み込みます。JAWS のファイルはこの拡張機能に含まれていません。

## 設定

| 設定 | 説明 |
| --- | --- |
| `jawsScript.jawsVersion` | 使う JAWS のバージョン(例: `2026`)。空のときは最新 |
| `jawsScript.language` | JAWS の言語フォルダー(例: `jpn`、`enu`)。空のときは VS Code の表示言語に合わせます |
| `jawsScript.includePaths` | `Include` したファイルを探す追加のフォルダー |
| `jawsScript.compilerPath` | `scompile.exe` のパス。空のときは JAWS のフォルダーから探します |

## 必要なもの

- VS Code 1.140 以降
- Windows と JAWS(コンパイルと、組み込み関数・標準ヘッダーの補完に必要です)

## ライセンス

[BSD 3-Clause License](LICENSE)
