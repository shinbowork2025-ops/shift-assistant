import { workspaceSnapshot } from "./render-print-common.js";
import { renderMonthlyPrintDocument } from "./render-print-month.js";
import { renderTransferPrintDocument } from "./render-print-transfer.js";

export function renderPrintPreview(elements, printedAt = new Date()) {
  const workspace = workspaceSnapshot();
  const mode = elements.printModeSelect.value === "transfer" ? "transfer" : "monthly";
  elements.printPreviewContainer.dataset.printMode = mode;
  elements.printTitle.textContent = mode === "transfer"
    ? `${workspace.name}｜転記一覧`
    : `${workspace.name}｜月間印刷`;

  const documentElement = mode === "transfer"
    ? renderTransferPrintDocument(workspace, printedAt)
    : renderMonthlyPrintDocument(workspace, printedAt);
  elements.printPreviewContainer.replaceChildren(documentElement);
}
