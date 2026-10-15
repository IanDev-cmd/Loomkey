(function () {
  const main = document.querySelector("#main");
  fetch("/api/meta").then((res) => res.json()).then((meta) => {
    main.innerHTML =
      '<header class="top"><div><h1>Providers</h1><p class="lede">Service directory</p></div></header>' +
      '<article class="card"><p class="empty">No provider records are stored. Staff who can be paid are on Billing.</p>' +
      '<div class="actions"><a class="btn" href="/billing">Open billing</a></div></article>' +
      '<article class="card"><h2>Staff roles the ledger accepts</h2>' +
      meta.staffRoles.map((role) => '<div class="row"><span>' + role + "</span></div>").join("") +
      "</article>";
  });
})();
