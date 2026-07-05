import { openRestProposal } from "./rest-assistant-ui.js";

export function initializeProposalButton(button) {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void openRestProposal();
  }, { capture: true });
}
