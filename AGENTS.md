# Shift Assistant

店舗向けのシフト編成支援ツール。ビルド不要の静的な HTML・CSS・JavaScript（ES Modules）のみで動作し、データはブラウザの IndexedDB に保存する。

## Cursor Cloud specific instructions

- 依存パッケージやパッケージマネージャは無い（`package.json` や lockfile は存在しない）。必要なのは `node`（ES Modules テスト実行用）と `python3`（静的サーバ用）で、どちらも VM に既定でインストール済み。`npm install` などは不要。
- 開発サーバの起動: `python3 -m http.server 8000` をリポジトリルートで実行し、ブラウザで `http://localhost:8000` を開く。ビルド工程は無い。
- テスト: `node --test tests/*.test.mjs`（`tests/*.test.mjs`）。
- 構文チェック（CI の Lint 相当、`.github/workflows/validate.yml` 参照）: `find js tests -name '*.js' -o -name '*.mjs' | xargs -n1 node --check`。専用の ESLint 等は無い。
- アプリは外部サーバへ通信しない設計で、CSP により `connect-src 'none'`。データは全て IndexedDB に保存されるため、動作確認は同一ブラウザプロファイル内で完結する。
