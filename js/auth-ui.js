import { AUTH_CONFIG } from "./auth-config.js";
import {
  authenticatedSession,
  clearAuthenticatedSession,
  storeAuthenticatedSession,
  verifySimpleCredentials
} from "./simple-auth.js";

export function showAuthenticatedApplication() {
  const gate = document.querySelector("#authGate");
  if (!gate) throw new Error("簡易認証画面が見つかりません。");
  gate.hidden = true;
  document.body.classList.remove("auth-pending");
  document.documentElement.dataset.authenticated = "1";
}

function bindLogout() {
  document.querySelector("#logoutButton")?.addEventListener("click", () => {
    clearAuthenticatedSession();
    window.location.reload();
  });
}

export async function requireSimpleAuthentication() {
  const gate = document.querySelector("#authGate");
  const form = document.querySelector("#authForm");
  const userIdInput = document.querySelector("#authUserId");
  const passwordInput = document.querySelector("#authPassword");
  const error = document.querySelector("#authError");
  const submitButton = document.querySelector("#authSubmitButton");
  const environmentLabel = document.querySelector("#authEnvironmentLabel");
  if (!gate || !form || !userIdInput || !passwordInput || !error || !submitButton || !environmentLabel) {
    throw new Error("簡易認証画面の構成が不正です。");
  }

  document.documentElement.dataset.appBooted = "1";
  environmentLabel.textContent = AUTH_CONFIG.environmentLabel;
  bindLogout();
  if (authenticatedSession()) return;

  gate.hidden = false;
  userIdInput.focus();
  await new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      submitButton.disabled = true;
      let accepted = false;
      try {
        const valid = await verifySimpleCredentials(userIdInput.value, passwordInput.value);
        if (!valid) {
          error.textContent = "従業員IDまたはパスワードが違います。";
          passwordInput.value = "";
          passwordInput.focus();
          return;
        }
        storeAuthenticatedSession();
        accepted = true;
        submitButton.textContent = "読み込み中";
        resolve();
      } catch (authenticationError) {
        console.error(authenticationError);
        error.textContent = "認証処理に失敗しました。ページを再読み込みしてください。";
      } finally {
        if (!accepted) submitButton.disabled = false;
      }
    });
  });
}
