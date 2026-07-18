// テスト環境用の固定資格情報。
// 正式採用時はこの設定を直接運用せず、simple-auth.jsと同じ境界で社内認証へ差し替える。
export const AUTH_CONFIG = Object.freeze({
  profileId: "local-test-v1",
  environmentLabel: "テスト環境",
  userId: "99999",
  password: Object.freeze({
    algorithm: "PBKDF2",
    hash: "SHA-256",
    iterations: 120000,
    saltBase64: "FJqLROXHc1FWuVtkNd3f1w==",
    expectedBase64: "hTEVVdniGhgQ7skkkUvABMGfxxMsNYUWST1vpwft36E="
  })
});
