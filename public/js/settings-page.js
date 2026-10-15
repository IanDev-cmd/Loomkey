(function () {
  const main = document.querySelector("#main");
  const Payments = window.Loomkey.Payments;
  const Session = window.Loomkey.Session;
  Payments.init({
    publicKey: (window.LOOMKEY_CONFIG && window.LOOMKEY_CONFIG.publicKey) || "",
    apiBase: "/api",
    getAuthToken: () => Session.token(),
    onFailure: (err) => {
      const el = document.querySelector("#status");
      if (el) { el.textContent = err.message; el.className = "bad"; }
    },
  });

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function field(name, label, value) {
    return "<label>" + esc(label) + '<input name="' + name + '" value="' + esc(value || "") + '"></label>';
  }

  Session.session().then(async (who) => {
    if (who.role === "admin") {
      const platform = await Payments.admin.platform();
      main.innerHTML = '<header class="top"><div><h1>Settings</h1><p class="lede">Platform payout is set with PLATFORM_PAYOUT.</p></div></header>' +
        '<article class="card"><h2>Commission balance</h2><p class="figure">' + esc(platform.balance) + " " + esc(platform.currency) + "</p></article>";
      return;
    }
    if (who.role === "guest") {
      main.innerHTML = '<header class="top"><div><h1>Settings</h1><p class="lede">Guest profile</p></div></header>' +
        '<article class="card"><form id="form"><div class="fields">' + field("name", "Name", who.name) + field("phone", "Phone", "") + field("country", "Country", "") +
        '</div><div class="actions"><button class="btn" type="submit">Save</button></div></form><p id="status" role="status"></p></article>';
      document.querySelector("#form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target));
        await Payments.guest.updateProfile(data);
        document.querySelector("#status").textContent = "Saved.";
      });
      return;
    }
    const profile = await Payments.owner.getProfile();
    main.innerHTML = '<header class="top"><div><h1>Settings</h1><p class="lede">Owner profile. Payout destination is on Billing.</p></div></header>' +
      '<article class="card"><form id="form"><div class="fields">' +
      field("businessName", "Business", profile.businessName) +
      field("name", "Name", profile.name) +
      field("email", "Email", profile.email || who.email) +
      field("phone", "Phone", profile.phone) +
      '</div><div class="actions"><button class="btn" type="submit">Save profile</button></div></form><p id="status" role="status"></p></article>';
    document.querySelector("#form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = document.querySelector("#status");
      try {
        await Payments.owner.saveProfile(Object.fromEntries(new FormData(event.target)));
        status.textContent = "Saved.";
        status.className = "ok";
      } catch (err) {
        status.textContent = err.message;
        status.className = "bad";
      }
    });
  }).catch((err) => {
    main.innerHTML = "<h1>Settings</h1><p class=\"bad\">" + esc(err.message) + "</p>";
  });
})();
