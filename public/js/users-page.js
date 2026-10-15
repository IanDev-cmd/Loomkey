(function () {
  const main = document.querySelector("#main");
  fetch("/api/meta").then((res) => res.json()).then((meta) => {
    const copy = {
      guest: "Pays a booking in full, as a deposit, or as the remaining balance.",
      owner: "Receives booking income after commission, pays staff, and withdraws.",
      admin: "Sees platform commission and can sweep it to the Loomkey payout account.",
    };
    main.innerHTML =
      '<header class="top"><div><h1>Users</h1><p class="lede">Sign-in actors</p></div></header>' +
      '<article class="card">' + meta.actors.map((actor) =>
        '<div class="row"><span class="pill">' + actor + "</span><span>" + copy[actor] + "</span></div>"
      ).join("") +
      '<p class="mute">A staff profile is a payee owned by an owner. Staff do not sign in.</p></article>';
  });
})();
