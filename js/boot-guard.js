// アプリ本体（ES Modules）の読み込みに失敗すると、画面は表示されたまま
// 一切の操作が効かなくなる。GitHub Pagesのキャッシュ更新直後などに
// 新旧ファイルが混在すると起こりうるため、初期化完了フラグを監視して
// 失敗時には再読み込みの案内を表示する。
// ES Modulesが壊れていても動くよう、このファイルだけは従来型スクリプトにする。
(function () {
  var WAIT_AFTER_LOAD_MS = 4000;
  var FALLBACK_MS = 15000;

  function showRecoveryBanner() {
    if (document.documentElement.dataset.appReady === "1") return;
    if (document.documentElement.dataset.appBooted === "1") return;
    if (document.getElementById("bootRecovery")) return;

    var banner = document.createElement("div");
    banner.id = "bootRecovery";
    banner.setAttribute("role", "alert");
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;" +
      "display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;" +
      "padding:14px 16px;background:#b3261e;color:#fff;font-weight:700;" +
      "font-family:sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);";

    var message = document.createElement("span");
    message.textContent = "アプリの読み込みに失敗しました。更新の直後は反映まで数分かかることがあります。少し待ってから再読み込みしてください。";

    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "再読み込み";
    button.style.cssText = "min-height:40px;padding:8px 18px;border:0;border-radius:8px;" +
      "background:#fff;color:#b3261e;font-weight:700;cursor:pointer;";
    button.addEventListener("click", function () {
      window.location.reload();
    });

    banner.append(message, button);
    document.body.append(banner);
  }

  window.addEventListener("load", function () {
    window.setTimeout(showRecoveryBanner, WAIT_AFTER_LOAD_MS);
  });
  // loadイベント自体が発生しない場合の保険。
  window.setTimeout(showRecoveryBanner, FALLBACK_MS);
})();
