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
        ├─ auth-ui.js ─ ログイン画面・ログアウト
        │    └─ simple-auth.js ─ 資格情報照合・タブ内セッション
        │         └─ auth-config.js ─ テスト環境用の認証設定
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
             ├─ employment-types.js
             ├─ coverage-requirements.js
             ├─ intervals.js
             ├─ shift-metrics.js
             ├─ month-overview.js
             ├─ daily-overview.js
             ├─ break-rules.js
             ├─ break-scheduler.js
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

## 簡易認証

`app.js`は最初に`requireSimpleAuthentication()`を待ち、成功後にだけ`initialize()`を実行します。これにより、未認証の状態では`loadSavedState()`を呼ばず、IndexedDBの保存データを画面へ読み込みません。

テスト環境の資格情報は`auth-config.js`へ分離し、パスワードはPassword-Based Key Derivation Function 2（PBKDF2）で導出した値と照合します。認証済み状態は`sessionStorage`へ保存し、ログアウト時に削除します。正式採用時は`auth-ui.js`の呼出境界を維持したまま、`simple-auth.js`を社内認証方式へ置き換えます。

この層は静的なクライアント内の簡易ゲートであり、権限分離や改ざん耐性のある監査記録を提供しません。

保存形式は`workspace-schema.js`の`APPLICATION_SCHEMA_VERSION`で管理します。複数シフト表形式を変更する場合は、旧版から次版への変換関数を1つずつ追加し、`migrateWorkspaceEnvelope()`で現在版まで順番に適用します。未知の古い版を推測して変換したり、新しい版を古いアプリで読み込んだりしてはいけません。実在する最初の複数シフト表形式は版4です。

端末外保管用のファイル生成と検証は`backup-export.js`へ集約します。バックアップには一意な識別子、管理用サマリー、内部保存形式の版、Secure Hash Algorithm 256-bit（SHA-256）による内容のハッシュ値を付けます。外部保存先への転送はアプリ本体へ直接実装せず、[バックアップ出力仕様](backup-pipeline.md)を境界として情報システム側の処理へ接続します。

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

`index.html`から読み込む`styles.css`と`print.css`には`?v=日付`のバージョン付きURLを使用しています。これらのCSSを変更したときは`index.html`の`?v=`を更新し、GitHub Pagesのキャッシュ（最大10分）による新HTML・旧CSSの混在を防いでください。

## 起動失敗の検知

`js/boot-guard.js`は従来型スクリプトとして読み込まれ、ES Modulesのアプリ本体が壊れていても単独で動作します。`app.js`が初期化完了時に`document.documentElement.dataset.appReady`を立て、一定時間たっても立たない場合は再読み込みを促すバナーを表示します。キャッシュ混在や文字化けコミットなどでモジュール解析が失敗しても、利用者が白画面のまま待ち続けない仕組みです。

## 集計

### 月間集計

`month-overview.js`の`buildMonthOverview()`を使用します。

1回の従業員×日付走査で、次を同時に生成します。

- 各セルのシフト
- 従業員別の勤務日数・実働・残業
- 日別の出勤人数・実働・残業

月間画面、CSV出力、月間印刷で同じ計算を再利用します。似た集計ロジックを別ファイルへ複製しないでください。

実働分は`shift-metrics.js`の`paidMinutesForShift()`を共通の優先順位として使用します。シフト区分の`paidMinutes`が設定済みなら固定値を最優先し、未設定時だけ休憩を差し引きます。月間集計は予定休憩、転記一覧と連携用出力は配置済み休憩を渡します。

### 1日集計

`daily-overview.js`の`buildDailyOverview()`を使用します。

- シフト情報
- 休憩情報
- 休憩検証
- 15分単位の勤務・休憩セル
- 休憩を除いた実配置人数（合計と雇用区分別）

を一度に構築します。雇用区分の定義と表記ゆれの正規化は`employment-types.js`へ集約しています。

必要人数の設定と充足評価は`coverage-requirements.js`（純粋モジュール）にあります。`buildDailyOverview()`は対象日の曜日に合うバンドだけを選び、必要人数が覆う時間帯を表示範囲へ広げたうえで、合計・雇用区分別の不足を`requirementEvaluation`として返します。設定はワークスペースの`coverageRequirements`として保存し、`model.js`の`getCoverageRequirements()`/`setCoverageRequirements()`と履歴（`history.js`のドキュメント）に含めます。編集UIは`coverage-requirements-ui.js`で、`必要人数を設定`ボタンから遅延読み込みします。

## 休憩

休憩の法定基準と店舗ルールは`break-rules.js`へ集約します。

- 計画：`plannedBreakTemplates()`
- 必要時間：`requiredBreakMinutes()`
- 検証：`validateBreaks()`

配置時刻の決定は純粋ソルバー`break-scheduler.js`が行います。貪欲な初期配置のあと、辞書式の全体目的関数（最小実配置人数の最大化 → 手薄スロット数の最小化 → 同時休憩の平準化 → 目標時刻からのずれ最小化）を改善する移動を繰り返します。`breaks.js`はアプリ状態との橋渡しだけを担います。ルール変更時は、画面・印刷・CSVへ個別の条件分岐を追加せず、共通関数を変更してください。

休憩は常に勤務時間の内側（境界に接しない）へ配置される必要があります（`breaksFitShiftWindow()`）。`generateBreaksForDate()`は、保護された手動休憩でも現在のシフトの勤務枠に収まらない場合は保護を解除して再配置します。シフト変更・ソルバー適用・ペイント入力・マスター取込のどの経路でも、勤務枠外の休憩が残らないことを不変条件として維持してください。

### 手動編集

`js/break-edit-ui.js`は1日チャートの「休憩✎」ボタンから遅延読み込みするダイアログで、選択中の日付・従業員1人分の休憩配列を直接編集します。保存は`model.js`の`setEmployeeBreaksForDate(dateValue, employeeId, breaksArray, options)`（他の従業員の配列を維持したまま1人分だけ差し替える）を`js/actions/break-edit-actions.js`から`runWithHistory()`で呼び出し、Undo対象にします。入力欄はvalidateBreaks()を使って保存前にライブ検証します。自動配置（`generateBreaksForDate`）は手動編集を区別せず上書きするため、シフト変更や「休憩を再配置」を実行すると手動編集は失われます。

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
- マスター取込プレビュー：`master-import-preview-ui.js`（全件検証後の追加・更新・変更なし・エラーを表示し、エラー時の部分適用を利用者へ明示確認する）
- Excel展開：`xlsx-lite.js`
- 読込アクション：`actions/file-actions.js`
- 社内システム連携用エクスポート：`integration-export.js`（純粋モジュール。契約は`docs/integration.md`。コードの欠落・重複・未正規化、休憩ルール違反がある場合は出力を拒否する。`files.js`側でさらに`validateMonthReadiness()`のゲートを通し、ツール内検証OKの候補案だけ出力する）
- 検証範囲の記録：`validation-profile.js`（検査プロファイルとその版、実施項目、未検査項目、人による承認が必要なことを定義する。会社固有の検査を追加するときは既存プロファイルの意味を変更せず、新しいプロファイルまたは新版として追加する）
- 従業員コードの正規化：`master-codes.js`（NFKC＋大文字化。入力境界＝ダイアログ・CSV取込で適用）
- 休憩と割当の整合性検査：`break-integrity.js`（純粋モジュール。勤務枠に収まらない休憩・勤務でない日の残留休憩を列挙。`breaks.js`の`repairBrokenBreaks()`がマスター取込後に再配置する）

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
- 必要人数の正規化と充足評価
- DOM IDとHTMLの突き合わせ
- 全ソースのUTF-8健全性（文字化けコミットの混入防止）

## やらないこと

- 小さな関数ごとにファイルを分割してモジュール数を無制限に増やす
- 同じ集計・日付変換・休憩判定を複数ファイルへコピーする
- 非表示ビューを毎回描画する
- 連続操作の各ステップでIndexedDBへ保存する
- 互換性確認なしに保存形式を変更する
- 外部ライブラリを便利さだけで追加する
