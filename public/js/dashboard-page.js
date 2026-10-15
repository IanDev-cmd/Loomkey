(function () {
  const main = document.querySelector("#main");
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function money(amount, currency) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount)); }
    catch (_) { return amount + " " + currency; }
  }
  window.Loomkey.Payments.init({
    apiBase: "/api",
    publicKey: (window.LOOMKEY_CONFIG && window.LOOMKEY_CONFIG.publicKey) || "",
    getAuthToken: () => window.Loomkey.Session.token(),
  });
  Promise.all([
    fetch("/api/listings").then((res) => res.json()),
    fetch("/api/meta").then((res) => res.json()),
    window.Loomkey.Session.session().catch(() => null),
  ]).then(async ([listings, meta, who]) => {
    const active = listings.filter((item) => item.status === "active").length;
    const inactive = listings.length - active;
    let balance = "";
    if (who && who.role === "owner") {
      const bal = await window.Loomkey.Payments.owner.balance();
      balance = '<article class="card"><h2>Owner balance</h2><p class="figure">' + esc(money(bal.balance, bal.currency)) + '</p><p class="mute">Commission ' + esc(bal.commissionPercent) + '%</p></article>';
    }
    main.innerHTML =
      '<header class="top"><div><h1>Dashboard</h1><p class="lede">' + esc(meta.product) + "</p></div></header>" +
      '<section class="grid"><article class="card"><h2>Listings</h2><p class="figure">' + active + '</p><p class="mute">' + inactive + ' inactive</p></article>' +
      (balance || '<article class="card"><h2>Balance</h2><p class="empty">Sign in as an owner to see the settlement balance.</p></article>') +
      "</section>" +
      '<article class="card"><h2>Rooms</h2>' + listings.map((item) =>
        '<div class="row"><span>' + esc(item.name) + '</span><span class="pill">' + esc(item.status) + "</span></div>"
      ).join("") + "</article>";
  }).catch((err) => {
    main.innerHTML = "<h1>Dashboard</h1><p class=\"bad\">" + esc(err.message) + "</p>";
  });
})();
