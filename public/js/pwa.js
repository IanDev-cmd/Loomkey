(function () {
  const popupRoot = document.createElement("div");
  popupRoot.id = "push-popups";
  document.body.appendChild(popupRoot);

  function popup(title, body) {
    const card = document.createElement("article");
    card.className = "push-pop";
    card.setAttribute("role", "status");
    const h = document.createElement("strong");
    h.textContent = title || "Loomkey";
    const p = document.createElement("p");
    p.textContent = body || "";
    card.append(h, p);
    popupRoot.appendChild(card);
    requestAnimationFrame(() => card.classList.add("show"));
    setTimeout(() => {
      card.classList.remove("show");
      setTimeout(() => card.remove(), 280);
    }, 6500);
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.querySelectorAll("[data-install]").forEach((button) => {
      button.hidden = false;
    });
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-install]");
    if (!button) return;
    if (!deferredPrompt) {
      popup("Install Loomkey", "In Chrome, open the menu and choose Install app. On iPhone, tap Share, then Add to Home Screen.");
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.hidden = true;
  });

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      popup("Notifications", "This browser cannot receive push notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      popup("Notifications", "Permission was not granted, so the phone shade will stay quiet.");
      return;
    }
    const ready = await navigator.serviceWorker.ready;
    const keyRes = await fetch("/api/push/public-key");
    const key = await keyRes.json();
    const subscription = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    });
    const saved = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
    if (!saved.ok) throw new Error("Could not save this device.");
    popup("Notifications on", "A push is on its way to the phone shade and this popup.");
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-enable-push]")) return;
    enablePush().catch((err) => popup("Notifications", err.message || "Push could not be enabled."));
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "loomkey-push") popup(data.title, data.body);
    });
  }

  function paintQr(img, path) {
    img.src = "/api/qr.svg?path=" + encodeURIComponent(path);
    img.alt = path === "/install" ? "QR code that opens Loomkey so Chrome can install it" : "QR code for booking payment";
  }

  function qrBlock() {
    const section = document.createElement("section");
    section.className = "qr-grid";
    section.setAttribute("data-qr-block", "");
    section.innerHTML =
      '<article class="card qr-card"><h2>Payment QR</h2><img data-qr="pay" data-booking="BK-1042" width="196" height="196" alt="QR code for booking payment"><p class="mute">Scan to pay booking BK-1042 on a phone.</p><p class="mute" data-pay-url></p></article>' +
      '<article class="card qr-card"><h2>Install on Chrome</h2><img data-qr="install" width="196" height="196" alt="QR code that opens Loomkey so Chrome can install it"><p class="mute">Scan with the phone camera. Chrome opens the install page.</p><div class="actions"><button class="btn" type="button" data-install>Install app</button><button class="btn ghost" type="button" data-enable-push>Enable notifications</button></div></article>';
    return section;
  }

  const main = document.querySelector("#main");
  if (main && location.pathname === "/billing") {
    const attach = () => {
      if (main.querySelector("[data-qr-block]")) return;
      if (!main.querySelector(".card") && !main.querySelector("#status")) return;
      main.appendChild(qrBlock());
      loadQrs();
    };
    new MutationObserver(attach).observe(main, { childList: true, subtree: true });
    attach();
  }

  function loadQrs() {
  fetch("/api/pwa/links")
    .then((res) => res.json())
    .then((links) => {
      document.querySelectorAll("[data-qr='install']").forEach((img) => paintQr(img, "/install"));
      document.querySelectorAll("[data-qr='pay']").forEach((img) => {
        const booking = img.getAttribute("data-booking") || "BK-1042";
        paintQr(img, "/pay/" + booking);
      });
      document.querySelectorAll("[data-install-url]").forEach((el) => {
        el.textContent = links.installUrl;
      });
      document.querySelectorAll("[data-pay-url]").forEach((el) => {
        el.textContent = links.payUrl;
      });
    })
    .catch(() => {});
  }
  loadQrs();
})();
