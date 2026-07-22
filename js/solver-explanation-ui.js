const METRICS = [
  ["必要人数不足", "必要人数・雇用区分・部門・資格の条件に対して不足した人数枠です。0が適用条件です。"],
  ["勤務間隔・連勤違反", "11時間未満の勤務間隔と、従業員ごとの連続勤務上限超過を数えます。0が適用条件です。"],
  ["固定残業枠超過", "各シフトに設定した残業見込みの合計が、従業員の固定残業枠を超えた時間です。"],
  ["公平性スコア", "休日数、土日勤務、遅番回数、シフト種別の偏りを比較するための相対値です。小さい案を優先しますが、時間や人数の単位ではありません。"],
  ["優先・既存傾向", "優先シフトと既存の入力傾向から外れた程度を表す相対値です。必要人数などの条件より後に比較します。"]
];

export function initializeSolverExplanationUi() {
  const slot = document.querySelector("#monthResultsSlot");
  if (!slot || document.querySelector("#solverMetricExplanation")) return null;

  const details = document.createElement("details");
  details.id = "solverMetricExplanation";
  details.className = "panel month-solver-metric-explanation";
  const summary = document.createElement("summary");
  summary.textContent = "月間ソルバーの評価値について";
  const introduction = document.createElement("p");
  introduction.className = "muted";
  introduction.textContent = "結果は上から順に比較します。後の指標が改善しても、前の指標が悪化する案は優先しません。";
  const list = document.createElement("dl");
  for (const [label, description] of METRICS) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = description;
    list.append(term, definition);
  }
  details.append(summary, introduction, list);
  slot.append(details);
  return details;
}

export { METRICS };