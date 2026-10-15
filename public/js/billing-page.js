(function () {
  const main = document.querySelector("#main");
  const Payments = window.Loomkey.Payments;
  const Session = window.Loomkey.Session;
  let meta = null;
  let busy = false;

  Payments.init({
    publicKey: (window.LOOMKEY_CONFIG && window.LOOMKEY_CONFIG.publicKey) || "",
    apiBase: "/api",
    brand: { title: "Loomkey", description: "Booking payment" },
    getAuthToken: () => Session.token(),
    onSuccess: (result) => note(result && result.message ? result.message : "Saved.", false),
    onFailure: (err) => note(err && err.message ? err.message : "Request failed.", true),
  });

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function money(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "KES" }).format(n);
    } catch (_) {
      return (currency || "") + " " + n.toFixed(2);
    }
  }

  function note(message, isError) {
    const el = document.querySelector("#status");
    if (!el) return;
    el.textContent = message || "";
    el.className = isError ? "bad" : "ok";
  }

  function field(name, label, value, type) {
    return '<label>' + esc(label) +
      '<input name="' + esc(name) + '" type="' + (type || "text") + '" value="' + esc(value || "") + '"></label>';
  }

  function options(list, selected) {
    return list.map((item) => {
      const value = typeof item === "string" ? item : item.id;
      const label = typeof item === "string" ? item : item.label;
      return '<option value="' + esc(value) + '"' + (value === selected ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
  }

  async function run(button, work) {
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    note("", false);
    try {
      await work();
      await render();
      note("Done.", false);
    } catch (err) {
      note(err && err.message ? err.message : "Request failed.", true);
      if (button) button.disabled = false;
    } finally {
      busy = false;
    }
  }

  function planCard() {
    const pro = (meta.plans || []).find((plan) => plan.id === "pro");
    const price = pro ? pro.currency + " " + pro.price + " billed " + pro.interval + "ly" : "";
    return '<article class="card" id="plan"><h2>Free plan</h2><p class="figure" style="font-size:18px">Pro</p><p class="mute">' + esc(price) + "</p></article>";
  }

  function renderGuest(who, payments) {
    const rows = (payments || []).map((item) =>
      "<tr><td>" + esc(item.bookingId) + "</td><td>" + esc(item.status) + "</td><td>" + esc(money(item.amount, item.currency)) + "</td><td>" + esc(item.tx_ref) + "</td></tr>"
    ).join("");
    main.innerHTML =
      header(who) +
      '<article class="card"><h2>Your booking payments</h2>' +
      (rows ? '<table><thead><tr><th>Booking</th><th>Status</th><th>Amount</th><th>Reference</th></tr></thead><tbody>' + rows + "</tbody></table>"
        : '<p class="empty">No booking payments yet.</p>') +
      '<div class="actions"><a class="btn" href="/pay/BK-1042">Pay a booking</a></div></article>' +
      '<article class="card"><h2>Guest profile</h2><form id="guest-form"><div class="fields">' +
      field("name", "Name", who.name) + field("phone", "Phone", "") + field("country", "Country", "") +
      '</div><div class="actions"><button class="btn" type="submit">Save profile</button></div></form></article>' +
      statusLine();
    document.querySelector("#guest-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      run(event.submitter, () => Payments.guest.updateProfile(data));
    });
  }

  function renderAdmin(who, platform) {
    const primary = platform.payout && platform.payout.primary;
    const secondary = platform.payout && platform.payout.secondary;
    main.innerHTML =
      header(who) +
      '<section class="grid">' + planCard() +
      '<article class="card"><h2>Platform commission</h2><p class="figure">' + esc(money(platform.balance, platform.currency)) + "</p>" +
      '<p class="mute">' + esc(platform.commissionPercent) + "% of each verified booking</p></article></section>" +
      '<article class="card"><h2>Sweep accounts</h2>' +
      destLine("Primary", primary) + destLine("Secondary", secondary) +
      '<div class="actions"><button class="btn" id="sweep" type="button">Sweep commission</button></div></article>' +
      statusLine();
    document.querySelector("#sweep").addEventListener("click", (event) => {
      if (!window.confirm("Sweep the platform commission to the payout account?")) return;
      run(event.currentTarget, async () => {
        const result = await Payments.admin.sweep();
        if (result && result.swept === false) throw new Error(result.reason || "Nothing was swept.");
      });
    });
  }

  function destLine(label, dest) {
    if (!dest) return '<div class="row"><span>' + esc(label) + '</span><span class="mute">Not configured</span></div>';
    const detail = dest.type === "mpesa" ? dest.phone : dest.bank_code + " " + dest.account_number;
    return '<div class="row"><span>' + esc(label) + " · " + esc(dest.type) + "</span><span>" + esc(detail) + "</span></div>";
  }

  function header(who) {
    return '<header class="top"><div><h1>Billing</h1><p class="lede">' + esc(who.name) + " · " + esc(who.role) + "</p></div></header>";
  }

  function statusLine() {
    return '<p id="status" role="status"></p>';
  }

  function renderOwner(who, profile, balance, staff, payouts) {
    const payout = profile.payout || {};
    const recent = (balance.recent || []).map((entry) =>
      '<div class="row"><span>' + esc(entry.note || "Ledger") + (entry.bookingId ? " · " + esc(entry.bookingId) : "") +
      '</span><span>' + esc(money(entry.amount, balance.currency)) + "</span></div>"
    ).join("");
    const staffRows = (staff || []).map((person) => {
      const dest = person.kind === "group"
        ? person.members.map((member) => member.name + " " + member.sharePercent + "%").join(", ")
        : ((person.payout && person.payout.type) || "no payout");
      return "<tr><td>" + esc(person.name) + "<div class=\"mute\">" + esc(person.role) + " · " + esc(person.kind) + "</div></td>" +
        "<td>" + esc(dest) + "</td>" +
        "<td><form class=\"pay-one\" data-staff=\"" + esc(person.id) + "\">" +
        '<input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required style="width:110px">' +
        '<select name="payType">' + options(meta.payTypes, person.payRate && person.payRate.type) + "</select>" +
        '<button class="btn" type="submit">Pay</button></form></td></tr>';
    }).join("");
    const history = (payouts || []).map((item) =>
      "<tr><td>" + esc(item.payee && (item.payee.memberName || item.payee.name) || item.kind) + "</td><td>" +
      esc(item.status) + "</td><td>" + esc(money(item.amount, item.currency)) + "</td><td>" + esc(item.reference) + "</td></tr>"
    ).join("");

    main.innerHTML =
      header(who) +
      '<section class="grid">' + planCard() +
      '<article class="card"><h2>Balance</h2><p class="figure">' + esc(money(balance.balance, balance.currency)) + "</p>" +
      '<p class="mute">Commission ' + esc(balance.commissionPercent) + "%</p></article></section>" +
      '<article class="card"><h2>Payout destination</h2>' + destLine("Current", payout.type ? payout : null) +
      '<form id="payout-form"><div class="fields">' +
      field("businessName", "Business", profile.businessName) +
      field("name", "Name", profile.name || who.name) +
      field("email", "Email", profile.email || who.email, "email") +
      field("phone", "Phone", profile.phone) +
      '<label>Type<select name="type">' + options(meta.payoutTypes, payout.type || "mpesa") + "</select></label>" +
      '<div data-for="mpesa" class="fields" style="grid-column:1/-1">' + field("mpesaPhone", "M-Pesa phone", "") + field("mpesaName", "M-Pesa name", profile.name || who.name) + "</div>" +
      '<div data-for="bank" class="fields" style="grid-column:1/-1">' + field("bank_code", "Bank code", "") + field("account_number", "Account number", "") + field("account_name", "Account name", profile.name || who.name) + "</div>" +
      '</div><div class="actions"><button class="btn" type="submit">Save payout details</button></div></form></article>' +
      '<article class="card"><h2>Withdraw</h2><form id="withdraw-form" class="fields">' +
      field("amount", "Amount", "", "number") +
      '</form><div class="actions"><button class="btn" id="withdraw" type="button">Withdraw to payout account</button></div></article>' +
      '<article class="card"><h2>Staff</h2>' +
      (staffRows ? "<table><thead><tr><th>Profile</th><th>Destination</th><th>Pay</th></tr></thead><tbody>" + staffRows + "</tbody></table>" : '<p class="empty">No staff profiles.</p>') +
      '<div class="actions"><button class="btn ghost" id="payroll" type="button">Run payroll from pay rates</button></div></article>' +
      '<article class="card"><h2>Add staff</h2><form id="staff-form"><div class="fields">' +
      field("name", "Name", "") +
      '<label>Role<select name="role">' + options(meta.staffRoles, "cleaner") + "</select></label>" +
      field("phone", "M-Pesa phone", "") +
      field("payRate", "Pay rate", "", "number") +
      '<label>Rate type<select name="payRateType">' + options(meta.payTypes, "per_task") + "</select></label>" +
      '</div><div class="actions"><button class="btn" type="submit">Add individual staff</button></div></form></article>' +
      '<article class="card"><h2>Recent balance</h2>' + (recent || '<p class="empty">No ledger entries.</p>') + "</article>" +
      '<article class="card"><h2>Payouts</h2>' +
      (history ? "<table><thead><tr><th>Payee</th><th>Status</th><th>Amount</th><th>Reference</th></tr></thead><tbody>" + history + "</tbody></table>" : '<p class="empty">No payouts yet.</p>') +
      "</article>" + statusLine();

    const payoutForm = document.querySelector("#payout-form");
    const syncPayoutFields = () => {
      const type = payoutForm.querySelector('[name="type"]').value;
      payoutForm.querySelectorAll("[data-for]").forEach((el) => { el.hidden = el.getAttribute("data-for") !== type; });
    };
    syncPayoutFields();
    payoutForm.querySelector('[name="type"]').addEventListener("change", syncPayoutFields);
    payoutForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      const body = { businessName: data.businessName, name: data.name, email: data.email, phone: data.phone };
      if (data.type === "bank" && data.account_number) {
        body.payout = { type: "bank", bank_code: data.bank_code, account_number: data.account_number, account_name: data.account_name };
      } else if (data.type === "mpesa" && data.mpesaPhone) {
        body.payout = { type: "mpesa", phone: data.mpesaPhone, name: data.mpesaName || data.name };
      }
      run(event.submitter, () => Payments.owner.saveProfile(body));
    });

    document.querySelector("#withdraw").addEventListener("click", (event) => {
      const amount = document.querySelector('#withdraw-form [name="amount"]').value;
      if (!window.confirm("Withdraw " + amount + " to your payout account?")) return;
      run(event.currentTarget, () => Payments.owner.withdraw(amount));
    });

    document.querySelectorAll(".pay-one").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const staffId = form.getAttribute("data-staff");
        if (!window.confirm("Pay " + data.amount + " to this staff profile?")) return;
        run(event.submitter, () => Payments.owner.payStaff(staffId, data.amount, data.payType, ""));
      });
    });

    document.querySelector("#payroll").addEventListener("click", (event) => {
      const items = (staff || []).filter((person) => person.payRate && Number(person.payRate.amount) > 0).map((person) => ({
        staffId: person.id,
        amount: person.payRate.amount,
        payType: meta.payTypes.includes(person.payRate.type) ? person.payRate.type : "salary",
        note: "Pay rate",
      }));
      if (!items.length) {
        note("No staff profile has a pay rate.", true);
        return;
      }
      if (!window.confirm("Run payroll for " + items.length + " profile" + (items.length === 1 ? "" : "s") + "?")) return;
      run(event.currentTarget, () => Payments.owner.payroll(items, "Payroll"));
    });

    document.querySelector("#staff-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      run(event.submitter, () => Payments.owner.createStaff({
        kind: "individual",
        name: data.name,
        role: data.role,
        payout: { type: "mpesa", phone: data.phone, name: data.name },
        payRate: data.payRate ? { type: data.payRateType, amount: Number(data.payRate) } : null,
      }));
    });
  }

  async function render() {
    const who = await Session.session();
    if (!meta) meta = await fetch("/api/meta").then((res) => res.json());
    if (who.role === "guest") {
      renderGuest(who, await Payments.guest.myPayments());
      return;
    }
    if (who.role === "admin") {
      renderAdmin(who, await Payments.admin.platform());
      return;
    }
    const [profile, balance, staff, payouts] = await Promise.all([
      Payments.owner.getProfile(),
      Payments.owner.balance(),
      Payments.owner.listStaff(),
      Payments.owner.payouts(),
    ]);
    renderOwner(who, profile, balance, staff, payouts);
  }

  render().catch((err) => {
    main.innerHTML = '<h1>Billing</h1><p id="status" class="bad" role="status"></p>';
    note(err.message || "Billing could not load.", true);
  });
})();
