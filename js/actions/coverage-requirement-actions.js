import { setCoverageRequirements } from "../model.js";
import { runWithHistory } from "../history.js";
import { refresh } from "./view-actions.js";

export function saveCoverageRequirements(requirements) {
  runWithHistory("必要人数の設定を変更", () => setCoverageRequirements(requirements));
  refresh();
}
