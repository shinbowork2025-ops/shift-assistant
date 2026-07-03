# Shift Assistant アーキテクチャ

この文書は、機能追加や不具合修正の際に、どのモジュールを変更すべきかを判断するための開発者向け資料です。

## 基本方針

- 静的なHTML・CSS・JavaScriptだけで動かす
- JavaScriptはブラウザ標準のES Modulesを使用する
- ビルドツール、外部ライブラリ、CDNを導入しない
- 入力データはIndexedDBへ保存する
- 外部へデータを送信しない
- 画面に表示していない重いDOMは生成しない
- 計算処理は可能な限りDOMから切り離し、純粋関数としてテストする

## レイヤー構成

```text
index.html / CSS
        │
        ▼
app.js ─ 初期化
        │
        ├─ events.js ─ DOMイベントの配線
        │
        ├─ actions.js ─ 公開アクションの互換ファサード
        │    ├─ actions/view-actions.js
        │    ├─ actions/workspace-actions.js
        │    ├─ actions/schedule-actions.js
        │    └─ actions/file-actions.js
        │
        ├─ render.js ─ 表示中ビューだけを描画
        │    ├─ render-month.js
        │    ├─ render-day.js
        │    └─ render-print*.js
        │
        ├─ model.js ─ アプリ状態・保存・ワークスペース操作
        │    └─ db.js ─ IndexedDB
        │
        └─ 純粋計算モジュール
             ├─ date-time.js
             ├─ intervals.js
             ├─ shift-metrics.js
             ├─ month-overview.js
             ├─ daily-overview.js
             ├─ break-rules.js
             ├─ workspace-normalizer.js
             └─ history-patch.js
```

## 状態管理

`model.js`の`state`は、現在編集中のワークスペースを表します。

```text
state
├─ selectedMonth
├─ selectedDate
├─ currentView
├─ employees
├─ shiftTypes
├─ shifts
└─ breaks
```

`workspaceState`は、端末内に保存されている複数ワークスペースと選択中IDを持ちます。

編集時は`state`を更新し、`scheduleSave()`を呼びます。`scheduleSave()`は選択中ワークスペースへ参照を同期し、短時間の連続変更をまとめてIndexedDBへ保存します。

表示月・対象日・ビューの切替など、データを編集しない画面状態の保存には`scheduleViewStateSave()`を使います。こちらは切替欄に表示する更新日時（`updatedAt`）を変更しません。タブが非表示になる際は`flushPendingSave()`がデバウンス待ちの変更を即時保存します。

### 状態変更のルール

- UIイベントから直接`state`を書き換えず、原則としてactions層を通す
- シフト変更は`setShift()`を使用する
- 休憩変更は`setBreaksForDate()`を使用する
- 複数セルを一括変更する場合は`{ save: false }`を使い、最後に`scheduleSave()`を1回だけ呼ぶ
- Undo対象にする変更は`runWithHistory()`または履歴トランザクションで囲む

## 描画

`render.js`はシェル部分と現在表示中のビューだけを描画します。

- 月間画面：`render-month.js`
- 1日チャート：`render-day.js`
- 印刷・転記：`render-print.js`

非表示ビューを先回りして描画してはいけません。印刷データが必要な場合は印刷ビューへ移動した時、または印刷直前に生成します。

## UIレイアウトとスロット

`index.html`が画面全体のレイアウトを決めます。

- 固定トップバー：アプリ名と保存状態を常時表示
- ステップナビ：月間シフト表 → 1日チャート → 印刷・転記の3画面切替
- データ管理・ヘルプ：`<details>`で折りたたみ、初期表示のボタン数を減らす
- 初回ガイド：従業員が未登録のときに空状態へ3ステップの案内を表示

自分でパネルを生成するUIモジュール（履歴・ペイント・ロック・自動配置の結果）は、`index.html`に用意された次のスロットへマウントします。挿入位置の判断を各モジュールに分散させないでください。

- `#historySlot`：操作履歴パネル（`history-ui.js`）
- `#monthToolsSlot`：ペイント入力・セルロックのツールパネル
- `#monthResultsSlot`：公休・勤務自動配置の結果表示

スロットが見つからない場合に限り、従来のアンカー要素（`.schedule-heading`など）へのフォールバック挿入を許可します。

## CSS構成

- `styles.css`：デザイントークン（`:root`のカスタムプロパティ）と全共通コンポーネント。旧`workspace.css`・`history.css`・`overtime.css`・`daily-colors.css`を統合済み
- `print.css`・`print-page.css`：印刷専用
- `paint.css`・`lock.css`・`auto-days-off.css`・`auto-work-shift.css`：機能ごとに遅延読み込み

色・角丸・余白は`styles.css`のトークンを参照し、機能CSSへ固定値を複製しないでください。

## 集計

### 月間集計

`month-overview.js`の`buildMonthOverview()`を使用します。

1回の従業員×日付走査で、次を同時に生成します。

- 各セルのシフト
- 従業員別の勤務日数・実働・残業
- 日別の出勤人数・実働・残業

月間画面、CSV出力、月間印刷で同じ計算を再利用します。似た集計ロジックを別ファイルへ複製しないでください。

### 1日集計

`daily-overview.js`の`buildDailyOverview()`を使用します。

- シフト情報
- 休憩情報
- 休憩検証
- 15分単位の勤務・休憩セル
- 休憩を除いた実配置人数

を一度に構築します。

## 休憩

休憩の法定基準と店舗ルールは`break-rules.js`へ集約します。

- 計画：`plannedBreakTemplates()`
- 必要時間：`requiredBreakMinutes()`
- 検証：`validateBreaks()`

自動配置アルゴリズムは`breaks.js`にあります。ルール変更時は、画面・印刷・CSVへ個別の条件分岐を追加せず、共通関数を変更してください。

## Undo・Redo

`history.js`は操作の前後状態から差分を作成し、ワークスペース別に最大50件保持します。

- 差分生成・適用：`history-patch.js`
- スタック管理：`history-stack.js`
- アプリ状態との連携：`history.js`
- UI・ショートカット：`history-ui.js`

単一セル変更では、変更されたシフト値や休憩枝だけを履歴へ保存します。従業員配列やシフトマスターの変更は、配列単位で保存します。

## ペイント入力

`paint-input.js`は1ストローク中の変更を日付別にまとめます。

1. 各セルを`setShift(..., { save: false })`で変更
2. 日付別に変更従業員IDを収集
3. ストローク終了時に日付単位で休憩を再配置
4. `scheduleSave()`を1回呼ぶ
5. 履歴へ1操作として登録

セルごとに保存や全画面描画を実行しないでください。

## CSV・Excel

- CSV解析・マスター反映：`csv.js`
- Excel展開：`xlsx-lite.js`
- 読込アクション：`actions/file-actions.js`

Excel解析モジュールは`.xlsx`を選択した時だけ動的に読み込みます。通常起動時の静的importへ戻さないでください。

## 印刷

印刷は画面表の縮小ではなく、印刷専用DOMを生成します。

- データ生成：`print-data.js`
- 月間印刷：`render-print-month.js`
- 転記一覧：`render-print-transfer.js`
- A4横設定：`print.css`

A4横固定、縦方向の複数ページ、日付見出しの繰り返しを維持します。

## 新機能を追加する手順

1. 既存の純粋計算モジュールで表現できるか確認する
2. 新しい計算が必要ならDOMから独立した関数として実装する
3. 自動テストを追加する
4. actions層に状態変更を実装する
5. events層でUIイベントを接続する
6. 表示中ビューだけを更新する
7. IndexedDB保存とUndoの単位を確認する
8. 外部通信や外部ライブラリが増えていないことを確認する

## テスト

```bash
node --test tests/*.test.mjs
```

CIでは次を検査します。

- 全JavaScriptの構文
- 相対import先の存在
- 休憩境界
- 日付・時刻
- 月間・日別集計
- 印刷データ
- CSV・Excel解析
- ワークスペース移行
- Undo／Redo差分
- ペイントストローク
- DOM IDとHTMLの突き合わせ
- 全ソースのUTF-8健全性（文字化けコミットの混入防止）

## やらないこと

- 小さな関数ごとにファイルを分割してモジュール数を無制限に増やす
- 同じ集計・日付変換・休憩判定を複数ファイルへコピーする
- 非表示ビューを毎回描画する
- 連続操作の各ステップでIndexedDBへ保存する
- 互換性確認なしに保存形式を変更する
- 外部ライブラリを便利さだけで追加する
