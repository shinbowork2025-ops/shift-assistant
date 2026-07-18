# バックアップ出力仕様

## 目的と責任範囲

Shift Assistantは、端末内に保存された全シフト表を、情報システム側の転送・世代管理処理が取り扱える単一のJavaScript Object Notation（JSON）ファイルとして出力します。

ツールの責任範囲は、ファイルの作成、管理用メタデータの付与、内容の整合性確認、復元までです。次は接続する情報システム側で決定します。

- 転送手段：共有フォルダ、端末管理ソフト、社内サーバー、利用者によるアップロードなど
- 保存先と保存期間
- 暗号化とアクセス権
- 世代管理と削除
- 転送失敗の再試行・通知
- 定期的な復元試験

ツール本体は外部へ自動送信せず、現在のContent Security Policyにより外部通信を禁止しています。

## ファイル名

```text
shift-assistant-backup-YYYY-MM-DDTHH-MM-SSZ-識別子先頭8文字.json
```

日時を秒単位、一意な識別子を別途付けるため、同じ日に複数回作成しても上書きしません。

## 出力形式

```json
{
  "format": "shift-assistant-backup",
  "formatVersion": 1,
  "exportId": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-07-18T09:00:00.000Z",
  "producer": {
    "application": "Shift Assistant",
    "applicationSchemaVersion": 5
  },
  "summary": {
    "activeWorkspaceId": "workspace-1",
    "workspaceCount": 1,
    "workspaces": [
      {
        "workspaceId": "workspace-1",
        "workspaceName": "園芸売場",
        "targetMonth": "2026-07",
        "employeeCount": 12
      }
    ]
  },
  "payloadSha256": "64桁の16進数",
  "payload": {
    "application": "Shift Assistant",
    "applicationSchemaVersion": 5,
    "activeWorkspaceId": "workspace-1",
    "workspaces": [],
    "settings": {}
  }
}
```

## 管理用フィールド

| フィールド | 用途 |
| --- | --- |
| `format` | 他のJSONファイルとバックアップを識別 |
| `formatVersion` | バックアップファイル全体の形式を識別 |
| `exportId` | 同じバックアップの二重転送・二重保管を識別 |
| `createdAt` | 作成日時。協定世界時のISO 8601形式 |
| `producer.applicationSchemaVersion` | 内部保存データの版 |
| `summary` | 個々のシフト表を展開せず、対象月や件数を確認するための情報 |
| `payloadSha256` | `payload`をJSON文字列化し、Secure Hash Algorithm 256-bit（SHA-256）で求めたハッシュ値 |
| `payload` | 復元対象となる全シフト表と設定 |

`payload`には従業員名、従業員コード、所属、資格、勤務予定が含まれます。転送・保管時は社内の個人情報取扱基準に従ってください。

## 復元時の処理

1. `format`と`formatVersion`を検査
2. `payload`からSHA-256によるハッシュ値を再計算し、`payloadSha256`と比較
3. 内容が変更されていれば復元を中止
4. 内部保存形式を版ごとの移行処理で現在版へ変換
5. ワークスペースを正規化して保存

従来の管理用メタデータを持たない全シフト表バックアップと、旧単一シフト表バックアップも引き続き読み込めます。

## 接続側の受入条件

- `exportId`を一意キーとして重複を検出する
- 保存後のファイル件数と作成日時を記録する
- `payloadSha256`を用いて破損を検出する
- 転送途中のファイルを完成済みとして扱わない
- 保存先から実際に復元できることを定期的に確認する
- 保存期間終了後の削除方法と記録を決定する
