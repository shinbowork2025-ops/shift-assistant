// 従業員コードの正規化。
// 従業員コードは社内システム連携の照合キーのため、全角英数（IME入力）や
// 大文字小文字の揺れを吸収し、常に半角・大文字へ統一して保存する。
// シフトコードはセル値の内部キーとして使用されるため、ここでは正規化しない
// （正規化すると既存セルとの参照が切れる）。
export function normalizeEmployeeCode(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
}

export function isNormalizedEmployeeCode(value) {
  const text = String(value ?? "");
  return text !== "" && text === normalizeEmployeeCode(text);
}
