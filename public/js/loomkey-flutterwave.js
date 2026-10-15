/* =====================================================================
 * Loomkey – Flutterwave client module (JS only, no CSS)
 *
 *   Loomkey.Payments.init({ publicKey: "FLWPUBK-...", apiBase: "/api", getAuthToken })
 *
 *   GUEST   Loomkey.Payments.payBooking(bookingId, { kind, payToken, customer })
 *   OWNER   Loomkey.Payments.owner.*   (profile, staff, balance, payStaff, payroll, withdraw)
 *   ADMIN   Loomkey.Payments.admin.*   (platform balance + commission sweep)
 *
 * Amounts, currency and the 10% split are decided on the SERVER only.
 * ===================================================================== */
(function (global) {
  "use strict";

  const FLW_SCRIPT = "https://checkout.flutterwave.com/v3.js";

  const config = {
    publicKey: "",
    apiBase: "/api",
    brand: { title: "Loomkey", logo: "", description: "Booking payment" },
    // null/undefined => Flutterwave shows EVERY method enabled on your account
    // (card, M-Pesa, mobile money, bank transfer, USSD, Apple Pay, Google Pay ...).
    // Or pass a string such as "card, mpesa" to restrict.
    paymentOptions: null,
    onSuccess: null,   // (verifiedPayment) => void
    onFailure: null,   // (error) => void
    onClose: null,     // () => void
    getAuthToken: null // () => string | Promise<string>   (owner/admin/guest-account calls)
  };

  let scriptPromise = null;
  let busy = false;

  /* ---------- helpers ---------- */

  function loadFlutterwave() {
    if (global.FlutterwaveCheckout) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = FLW_SCRIPT;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        scriptPromise = null;
        reject(new Error("Could not load Flutterwave. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (typeof config.getAuthToken === "function") {
      const token = await config.getAuthToken();
      if (token) headers.Authorization = "Bearer " + token;
    }
    const res = await fetch(config.apiBase + path, {
      method: method,
      headers: headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (!res.ok) throw new Error((data && data.message) || "Request failed (" + res.status + ")");
    return data;
  }
  const get = function (p) { return request("GET", p); };
  const post = function (p, b) { return request("POST", p, b || {}); };
  const put = function (p, b) { return request("PUT", p, b || {}); };
  const del = function (p) { return request("DELETE", p); };

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent("loomkey:payment:" + name, { detail: detail })); } catch (_) { /* ignore */ }
  }

  function money(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) throw new Error("Enter an amount greater than 0.");
    if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) throw new Error("Amount can have at most 2 decimals.");
    return v;
  }

  /* =================================================================
   * GUEST – pay for a booking (all methods)
   * ================================================================= */
  /**
   * @param {string} bookingId
   * @param {object} [opts]
   * @param {"full"|"deposit"|"balance"} [opts.kind="full"]
   * @param {string} [opts.payToken]   signed token from the guest's pay link
   * @param {object} [opts.customer]   { name, email, phone_number, country }  (name + email required)
   */
  async function payBooking(bookingId, opts) {
    opts = opts || {};
    if (busy) return;
    if (!config.publicKey) throw new Error("Flutterwave public key is not configured.");
    if (!bookingId) throw new Error("bookingId is required.");

    busy = true;
    emit("start", { bookingId: bookingId });

    try {
      // 1. Server creates the pending payment and decides amount/currency
      const intent = await post("/payments/init", {
        bookingId: bookingId,
        kind: opts.kind || "full",
        payToken: opts.payToken || null,
        customer: opts.customer || null,
      });

      // 2. Load Flutterwave
      await loadFlutterwave();

      // 3. Open checkout and 4. verify on the server
      const verified = await new Promise(function (resolve, reject) {
        let finished = false;
        const checkout = {
          public_key: config.publicKey,
          tx_ref: intent.tx_ref,
          amount: intent.amount,
          currency: intent.currency,
          customer: intent.customer,
          meta: Object.assign({ bookingId: bookingId, product: "loomkey" }, intent.meta || {}),
          customizations: {
            title: config.brand.title,
            description: intent.description || config.brand.description,
            logo: config.brand.logo,
          },
          callback: async function (response) {
            finished = true;
            try {
              if (modal && typeof modal.close === "function") modal.close();
              if (response.status !== "successful" && response.status !== "completed") {
                throw new Error("Payment was not completed.");
              }
              const v = await post("/payments/verify", { tx_ref: intent.tx_ref, transaction_id: response.transaction_id });
              if (!v || v.status !== "successful") throw new Error((v && v.message) || "Payment could not be verified.");
              resolve(v);
            } catch (err) { reject(err); }
          },
          onclose: function () {
            if (!finished) reject(Object.assign(new Error("Payment window closed."), { cancelled: true }));
          },
        };
        if (config.paymentOptions) checkout.payment_options = config.paymentOptions; // omit => all methods
        const modal = global.FlutterwaveCheckout(checkout);
      });

      emit("success", verified);
      if (typeof config.onSuccess === "function") config.onSuccess(verified);
      return verified;
    } catch (err) {
      if (err && err.cancelled) {
        emit("cancelled", { bookingId: bookingId });
        if (typeof config.onClose === "function") config.onClose();
      } else {
        emit("error", { bookingId: bookingId, message: err.message });
        if (typeof config.onFailure === "function") config.onFailure(err);
        else console.error("[Loomkey Payments]", err);
      }
    } finally {
      busy = false;
    }
  }

  function checkStatus(txRef) { return post("/payments/status", { tx_ref: txRef }); }

  const guest = {
    payBooking: payBooking,
    checkStatus: checkStatus,
    updateProfile: function (p) { return put("/guests/me", p); },   // { name, phone, country }
    myPayments: function () { return get("/guests/me/payments"); },
  };

  /* =================================================================
   * OWNER – profile, staff (individual / group), pay staff, withdraw
   * ================================================================= */
  /*
   * Payout destination objects:
   *   M-Pesa: { type: "mpesa", phone: "0712345678", name: "Jane Wanjiru" }
   *   Bank:   { type: "bank", bank_code: "044", account_number: "1234567890", account_name: "Jane Wanjiru" }
   *
   * Staff profile objects:
   *   Individual: { kind: "individual", name, role, payout, propertyIds?, payRate? }
   *   Group:      { kind: "group", name: "Sunrise Cleaners", role: "cleaner",
   *                 members: [ { name, sharePercent: 60, payout }, { name, sharePercent: 40, payout } ] }
   *   role: cleaner | technician | manager | co-host | caretaker | laundry | security | gardener | driver | other
   *   Group shares must add up to exactly 100.
   */
  const owner = {
    getProfile: function () { return get("/owners/me"); },
    saveProfile: function (p) { return put("/owners/me", p); },    // { businessName, name, email, phone, payout }
    balance: function () { return get("/owners/me/balance"); },

    listStaff: function () { return get("/owners/me/staff"); },
    createStaff: function (profile) { return post("/owners/me/staff", profile); },
    updateStaff: function (id, profile) { return put("/owners/me/staff/" + encodeURIComponent(id), profile); },
    removeStaff: function (id) { return del("/owners/me/staff/" + encodeURIComponent(id)); },

    /** Pay one staff profile. Groups are split by member share automatically.
     *  payType: salary | per_task | bonus | advance | reimbursement | other */
    payStaff: function (staffId, amount, payType, note) {
      return post("/owners/me/payouts", { staffId: staffId, amount: money(amount), payType: payType || "other", note: note || "" })
        .then(function (r) { emit("payout", r); return r; });
    },
    /** Payroll run: items = [{ staffId, amount, payType, note }] */
    payroll: function (items, title) {
      const clean = (items || []).map(function (i) {
        return { staffId: i.staffId, amount: money(i.amount), payType: i.payType || "salary", note: i.note || "" };
      });
      return post("/owners/me/payouts/bulk", { items: clean, title: title || "Payroll" })
        .then(function (r) { emit("payout", r); return r; });
    },
    payouts: function () { return get("/owners/me/payouts"); },
    withdraw: function (amount) {
      return post("/owners/me/withdraw", { amount: money(amount) }).then(function (r) { emit("payout", r); return r; });
    },
  };

  /* =================================================================
   * ADMIN – Loomkey commission (10%) -> separate M-Pesa / bank
   * ================================================================= */
  const admin = {
    platform: function () { return get("/admin/platform"); },        // balance + masked payout accounts
    sweep: function () { return post("/admin/platform/sweep"); },    // pays out accumulated commission
  };

  /* =================================================================
   * DOM binding
   *   <button data-pay-booking="BK-1042" data-pay-kind="deposit" data-pay-token="...">Pay</button>
   *   <button data-pay-staff="staff_ab12" data-amount="1500" data-pay-type="per_task">Pay cleaner</button>
   * Guest details for data-pay-booking come from inputs with
   *   [data-guest-name] [data-guest-email] [data-guest-phone] [data-guest-country]
   * ================================================================= */
  function readGuestFields(scope) {
    const q = function (sel) { const el = (scope || document).querySelector(sel); return el ? String(el.value || "").trim() : ""; };
    const c = { name: q("[data-guest-name]"), email: q("[data-guest-email]"), phone_number: q("[data-guest-phone]"), country: q("[data-guest-country]") };
    return c.name || c.email ? c : null;
  }

  function bindButtons(root) {
    (root || document).querySelectorAll("[data-pay-booking]").forEach(function (btn) {
      if (btn.__lkBound) return;
      btn.__lkBound = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const form = btn.closest("form") || document;
        payBooking(btn.getAttribute("data-pay-booking"), {
          kind: btn.getAttribute("data-pay-kind") || "full",
          payToken: btn.getAttribute("data-pay-token") || null,
          customer: readGuestFields(form),
        }).finally(function () { btn.disabled = false; btn.removeAttribute("aria-busy"); });
      });
    });

    (root || document).querySelectorAll("[data-pay-staff]").forEach(function (btn) {
      if (btn.__lkBound) return;
      btn.__lkBound = true;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        const amount = btn.getAttribute("data-amount");
        const label = btn.getAttribute("data-label") || "this staff profile";
        if (!global.confirm("Pay " + amount + " to " + label + "?")) return;
        btn.disabled = true;
        owner.payStaff(btn.getAttribute("data-pay-staff"), amount, btn.getAttribute("data-pay-type") || "other", btn.getAttribute("data-note") || "")
          .then(function (r) { if (typeof config.onSuccess === "function") config.onSuccess({ payouts: r }); })
          .catch(function (err) {
            emit("error", { message: err.message });
            if (typeof config.onFailure === "function") config.onFailure(err); else console.error("[Loomkey Payments]", err);
          })
          .finally(function () { btn.disabled = false; });
      });
    });
  }

  function init(options) {
    options = options || {};
    Object.keys(options).forEach(function (k) {
      if (k === "brand") Object.assign(config.brand, options.brand);
      else config[k] = options[k];
    });
    bindButtons(document);
    if (!init.__observer && global.MutationObserver) {
      init.__observer = new MutationObserver(function () { bindButtons(document); });
      init.__observer.observe(document.body, { childList: true, subtree: true });
    }
    return publicApi;
  }

  const publicApi = {
    init: init, config: config,
    guest: guest, owner: owner, admin: admin,
    // backwards-compatible shortcuts
    payBooking: payBooking, checkStatus: checkStatus,
  };

  global.Loomkey = global.Loomkey || {};
  global.Loomkey.Payments = publicApi;
})(window);
