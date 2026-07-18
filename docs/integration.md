# 社内システム連携仕様（入出力契約）

この文書は、Shift Assistantと社内システム（勤怠・シフト管理など）を接続するための入出力契約を定義します。ツール本体は外部と通信しません。**入口（マスター取込）と出口（連携用エクスポート）のファイル形式だけを固定**し、その間の転送手段（共有フォルダ、アップロード、API連携など）は接続する側が自由に選べる構造です。

```text
社内システム／人事マスター                     社内システム（登録・確定）
        │                                          ▲
        │ マスターCSV・Excel（入力契約）            │ 連携用CSV・JSON（出力契約）
        ▼                                          │
   ┌─────────────────────────────┐
   │        Shift Assistant（店舗PCのブラウザ内で完結）      │
   │  従業員・シフト区分の管理 → シフト編成 → 検証 → 出力    │
   └─────────────────────────────┘
```

## 共通の約束事

- **照合キー**：従業員は`従業員コード`、シフト区分は`シフトコード`で照合します。
- **従業員コード**は必須・重複禁止です。入力時にUnicode NFKC正規化（全角英数→半角）と大文字化を自動適用し、常に**半角・大文字**で保存・出力します（`ｅ００１`→`E001`）。社内システムの社員番号と同じ値を使うことを推奨します。
- **シフトコード**はセル値の内部キーのため正規化しません（正規化すると既存シフト表との参照が切れるため）。社内システムの勤務区分コードと異なる場合は、受け側でマッピング表を管理してください。
- **日をまたぐシフト**（終了時刻≦開始時刻）には対応していません。マスター取込時にエラーとして拒否します。
- 文字コードはUTF-8。日付は`YYYY-MM-DD`、月は`YYYY-MM`、時刻は`HH:MM`（24時間表記）。
- 時間量はすべて**分単位の整数**（例：実働450 = 7時間30分）。
- 出力形式には`formatVersion`（現在は`2`）を含めます。フィールドの追加は同一バージョンで行うことがありますが、既存フィールドの削除・意味変更時は必ずバージョンを上げます。取り込み側は未知のフィールドを無視してください。

## 入力契約：マスターCSV・Excel

従業員とシフト区分の登録・更新に使用します。画面の「Excel・CSVから登録」で取り込みます。

```csv
種別,コード,名称,開始時刻,終了時刻,所属,表示順,略称,固定残業時間,シフト残業時間
従業員,E001,田中太郎,,,園芸,1,,20,
シフト,01,早番,06:45,16:15,,,01,,0
シフト,休,公休,,,,,休,,0
```

| 列 | 従業員行 | シフト行 |
| --- | --- | --- |
| 種別 | `従業員` | `シフト` |
| コード | **必須・重複禁止**。半角・大文字へ自動正規化。既存と同じコードは更新扱い | 推奨。空欄時は`shift-名称`を自動生成（連携キーになるため明示を推奨） |
| 名称（または氏名／シフト名） | 必須 | 必須（空欄時はコードを使用） |
| 開始時刻・終了時刻 | 使用しない | `HH:MM`。両方空欄なら休日区分 |
| 所属 | 任意 | 使用しない |
| 表示順 | 任意（数値） | 使用しない |
| 略称 | 使用しない | 任意（印刷・画面表示用） |
| 固定残業時間 | 月間固定残業枠。`20`（時間）、`1.5`、`01:30`形式 | 使用しない |
| シフト残業時間 | 使用しない | 1回割当あたりの残業見込み |
| 雇用区分 | `社員`／`準社員`／`パート・アルバイト` | 使用しない |

- 従業員コードのない従業員行はエラーとして取り込みません。
- 既存の従業員・シフト区分との照合はコードのみで行います（氏名では照合しません）。従業員コードは正規化後の値で照合するため、`ｅ００１`の行は既存の`E001`の更新として扱い、保存値も`E001`へ揃えます。
- 終了時刻が開始時刻以前のシフト行（日またぎ）はエラーとして取り込みません。
- 取込によってシフトの時刻が変わった場合、配置済みの休憩が新しい勤務枠に収まるかを全日付で検査し、収まらない休憩は自動で再配置します（取込結果に件数を表示）。

## 出力契約：連携用エクスポート

画面の「社内システム連携用の出力」から保存します。

### 出力条件（ツール内検証の範囲）

不完全なデータを下流に流さないため、次を**すべて**満たす場合のみ出力できます。満たさない場合は理由（未入力セル数・エラー件数・先頭の問題）を表示してエラーになります。

1. 月間の要確認一覧が「ツール内検証OK」であること：未入力セルがゼロ、かつエラー（必要人数不足、11時間未満の勤務間隔、連続勤務上限超過、固定残業枠超過、休憩ルール違反など）がゼロ
2. 従業員コード・シフトコードに欠落・重複・未正規化（全角や小文字）がないこと
3. すべての勤務シフトの休憩が、勤務時間の内側に配置され、ツールに実装された休憩ルールの必要時間を満たしていること

出力成功が示すのは、`shift-assistant-standard`検査プロファイルの実装済み検査を通過した候補案であることだけです。就業規則全体、元マスターの正確性、個別の労働契約や勤務制限、接続先固有の入力条件、担当者の確認・承認、実際の登録結果は検査しません。正式登録前に担当者または接続先の承認工程で確認してください。

警告・情報レベルの指摘（月境界の未登録など）は出力を妨げませんが、JSONの`validation.counts`に件数として記録します。会社固有の検査を追加するときは既存プロファイルの意味を変更せず、別の`profile`または新しい`profileVersion`として定義します。

### 連携用JSON（全量：マスター＋割当）

ファイル名：`（シフト表名）-（YYYY-MM）-integration.json`

```json
{
  "format": "shift-assistant-integration",
  "formatVersion": 2,
  "documentStatus": "candidate",
  "generatedAt": "2026-07-18T09:00:00.000Z",
  "workspaceName": "園芸売場",
  "month": "2026-07",
  "validation": {
    "profile": "shift-assistant-standard",
    "profileVersion": 1,
    "toolChecksPassed": true,
    "checkedAt": "2026-07-18T09:00:00.000Z",
    "counts": {
      "blank": 0,
      "error": 0,
      "warning": 0,
      "info": 1
    },
    "checksPerformed": [
      "assignment_completeness",
      "shift_code_reference",
      "requested_day_off_consistency",
      "break_and_lock_consistency",
      "configured_break_rules",
      "minimum_rest_interval_11h",
      "configured_consecutive_work_limit",
      "configured_coverage_requirements",
      "configured_fixed_overtime_limit",
      "adjacent_month_boundaries_when_available",
      "integration_master_codes"
    ],
    "notChecked": [
      "source_master_accuracy",
      "all_company_work_rules",
      "individual_contracts_and_restrictions",
      "target_system_schema_and_mapping",
      "human_approval_and_registration_result"
    ],
    "humanReview": {
      "requiredBeforeRegistration": true,
      "approvalRecordedByTool": false
    }
  },
  "employees": [
    {
      "employeeCode": "E001",
      "name": "田中太郎",
      "department": "園芸",
      "employmentType": "fulltime",
      "fixedOvertimeMinutes": 1200
    }
  ],
  "shiftTypes": [
    {
      "shiftCode": "01",
      "name": "早番",
      "isWork": true,
      "start": "06:45",
      "end": "16:15",
      "paidMinutes": null,
      "overtimeMinutes": 0
    }
  ],
  "assignments": [
    {
      "date": "2026-07-01",
      "employeeCode": "E001",
      "shiftCode": "01",
      "isWork": true,
      "start": "06:45",
      "end": "16:15",
      "breaks": [{ "start": "12:00", "end": "13:00" }],
      "breakMinutes": 60,
      "workMinutes": 510,
      "overtimeMinutes": 0
    }
  ]
}
```

| フィールド | 説明 |
| --- | --- |
| `documentStatus` | 常に`candidate`。担当者が確認・承認する前の候補案であり、正式登録済み・承認済みを示さない |
| `validation.profile` | 実施した検査集合の安定した識別子。現在は`shift-assistant-standard` |
| `validation.profileVersion` | 検査プロファイルの版。検査の意味や必須項目を変更するときに上げる |
| `validation.toolChecksPassed` | 実装済みの出力必須検査を通過したこと。出力ファイルでは常に`true` |
| `validation.counts` | 未入力、エラー、警告、情報の件数。警告と情報は出力を妨げない |
| `validation.checksPerformed` | ツールが実施した検査の識別子一覧 |
| `validation.notChecked` | ツールが検査していない事項の識別子一覧 |
| `validation.humanReview` | 正式登録前の担当者確認が必要であり、このツールは承認を記録しないことを示す |
| `employmentType` | `fulltime`（社員）／`semi`（準社員）／`parttime`（パート・アルバイト） |
| `isWork` | `true`＝勤務シフト、`false`＝公休・有給などの休日区分 |
| `paidMinutes` | シフト区分に固定の実働分が設定されている場合のみ数値。未設定は`null`（勤務時間−休憩から算出） |
| `breaks` | シフトに**実際に配置された**休憩の開始・終了時刻の配列。出力条件により、すべて勤務時間の内側に収まっていることが保証される。休日区分では常に空配列 |
| `breakMinutes` | 配置された休憩の合計分 |
| `workMinutes` | 勤務時間から配置済み休憩を差し引いた実働分。出力条件により休憩はツールに実装された休憩ルールを通過している |
| `overtimeMinutes` | そのシフト1回あたりの残業見込み分 |

`assignments`には入力済みのセルだけが含まれます（空欄セルは出力されません）。

### 連携用CSV（割当のみ・縦持ち）

ファイル名：`（シフト表名）-（YYYY-MM）-integration.csv`

1行＝1従業員×1日。JSONの候補状態、検査プロファイル、`assignments`と同じ内容です。区切りはカンマ、改行はCRLF、引用符はRFC 4180準拠。BOMなし。値の書き換え（Excel向け数式ガードなど）は行いません。

```csv
format_version,document_status,validation_profile,validation_profile_version,date,employee_code,shift_code,is_work,start,end,break_minutes,work_minutes,overtime_minutes,breaks
2,candidate,shift-assistant-standard,1,2026-07-01,E001,01,1,06:45,16:15,60,510,0,12:00-13:00
2,candidate,shift-assistant-standard,1,2026-07-02,E001,休,0,,,0,0,0,
```

- `is_work`：`1`＝勤務、`0`＝休日区分
- `breaks`：`HH:MM-HH:MM`を`/`で連結（例：`10:00-10:15/12:00-13:00`）
- `document_status`：常に`candidate`。承認済み・登録済みを示さない
- `validation_profile`と`validation_profile_version`：JSONの同名情報と同じ。検査範囲の識別に使用する

## 参考：バックアップJSONとの違い

「全データをバックアップ」のJSONはツール内部の保存形式（`applicationSchemaVersion`付き）で、**ツールの復元専用**です。内部形式は予告なく変わるため、パイプラインは必ず上記の連携用エクスポートに接続してください。

## パイプライン接続時の想定手順

1. 人事マスターから入力契約の形式（CSV）へ変換するアダプタを用意する
2. 店舗で編成・検証後、連携用CSVまたはJSONを出力する
3. 出力ファイルを社内システムの取込形式へ変換するアダプタを用意する

ツール側の改修は不要で、両端のアダプタ2枚を書くだけで接続できます。
