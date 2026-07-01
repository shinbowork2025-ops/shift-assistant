# Shift Assistant

店舗PCのブラウザだけで動作するシフト作成支援ツールです。

## 設計方針

- 静的なHTML・CSS・JavaScriptのみで動作
- 入力データはブラウザ内のIndexedDBに保存
- シフトデータを外部サーバーへ送信しない
- JavaScript Object Notation（JSON）でバックアップ・復元
- Comma-Separated Values（CSV）で表計算ソフト向けに出力
- ビルド処理や外部ライブラリを使わない

## 初期版の機能

- 従業員の追加・編集・削除
- 月の切り替え
- 早番・中番・遅番・短時間・公休・有休・希望休の入力
- 従業員別の勤務日数・勤務時間集計
- 日別の出勤人数集計
- IndexedDBへの自動保存
- CSV出力
- JSONバックアップ・復元
- 印刷用レイアウト

## データの扱い

アプリ本体はGitHub Pagesから読み込みますが、入力した氏名やシフトはIndexedDBにだけ保存します。`fetch`や`XMLHttpRequest`などの送信処理は実装していません。

さらにContent Security Policy（CSP）の`connect-src 'none'`を指定し、JavaScriptから外部へ通信できないようにしています。

ブラウザの閲覧データを削除すると保存内容も消えるため、定期的にJSONバックアップを作成してください。同じURLでも、別のPC・別のブラウザ・別のブラウザ利用者の保存領域とは共有されません。

## GitHub Pagesでの公開

このリポジトリは、`main`ブランチのルートをそのまま公開する構成です。ビルドコマンドは不要です。

1. 初期版のプルリクエストを`main`へマージする
2. GitHubのリポジトリ画面で`Settings`を開く
3. 左側の`Pages`を開く
4. `Build and deployment`の`Source`で`Deploy from a branch`を選ぶ
5. ブランチを`main`、フォルダーを`/(root)`にして保存する

公開URLは次の形式になります。

```text
https://shinbowork2025-ops.github.io/shift-assistant/
```

`.nojekyll`を配置しているため、Jekyllによる変換を行わず、静的ファイルをそのまま公開します。

## ローカルでの確認

ファイルを直接開くのではなく、簡易Webサーバーを使用します。

```bash
python -m http.server 8000
```

その後、ブラウザで`http://localhost:8000`を開きます。

## 今後の候補

- 勤務区分と時間の編集
- 必要人数の設定と不足警告
- 最大連勤数などの条件違反表示
- 希望休を考慮した自動作成
- 従業員の並べ替え
- 複数案の保存と比較
