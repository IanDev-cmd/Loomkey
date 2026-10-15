/* =====================================================================
 * Loomkey – Flutterwave server module (Node 18+, Express)
 *
 * MONEY FLOW
 *   1. GUEST pays for a booking (any method enabled on your Flutterwave account)
 *   2. On verified payment the server splits it in the ledger:
 *        90%  -> OWNER balance        (PLATFORM_FEE_PERCENT = 10)
 *        10%  -> PLATFORM balance     (Loomkey commission)
 *   3. OWNER pays STAFF from their balance (Flutterwave Transfers: M-Pesa or bank).
 *      Staff can be an individual or a GROUP (split by member share %).
 *   4. PLATFORM sweeps its commission to a SEPARATE M-Pesa and/or bank account.
 *
 * USER CATEGORIES / PROFILES
 *   guest  – pays for bookings (profile auto-saved at checkout)
 *   owner  – receives booking income, manages staff, pays staff, withdraws
 *   staff  – payee profile owned by an owner: individual or group
 *   (admin – Loomkey operator: commission balance + sweep)
 *
 * ENV
 *   FLW_SECRET_KEY, FLW_SECRET_HASH
 *   PLATFORM_FEE_PERCENT      default 10
 *   SETTLEMENT_CURRENCY       default KES
 *   PLATFORM_PAYOUT           JSON, e.g.
 *     {"primary":{"type":"mpesa","phone":"0712345678","name":"Loomkey Ltd"},
 *      "secondary":{"type":"bank","bank_code":"044","account_number":"1234567890","account_name":"Loomkey Ltd"}}
 *   PLATFORM_MIN_SWEEP        default 100 (major units)
 *   APP_URL                   optional public origin; falls back to RENDER_EXTERNAL_URL
 *
 * npm i express
 * ===================================================================== */
const express = require("express");
const crypto = require("crypto");

const FLW_BASE = "https://api.flutterwave.com/v3";
const SECRET_KEY = process.env.FLW_SECRET_KEY;
const SECRET_HASH = process.env.FLW_SECRET_HASH;
const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 10);
const CURRENCY = process.env.SETTLEMENT_CURRENCY || "KES";
const MIN_SWEEP_MINOR = Math.round(Number(process.env.PLATFORM_MIN_SWEEP || 100) * 100);
const PLATFORM_PAYOUT = safeJson(process.env.PLATFORM_PAYOUT) || {};

const STAFF_ROLES = ["cleaner", "technician", "manager", "co-host", "caretaker", "laundry", "security", "gardener", "driver", "other"];
const PAY_TYPES = ["salary", "per_task", "bonus", "advance", "reimbursement", "other"];
const MAX_BULK_LINES = 100; // Flutterwave bulk transfer limit per request

if (!SECRET_KEY) console.warn("FLW_SECRET_KEY is not set");
if (!SECRET_HASH) console.warn("FLW_SECRET_HASH is not set – webhooks will be rejected");

/* ---------------------------------------------------------------------
 * Small utilities (money is handled in integer MINOR units: 4500.50 -> 450050)
 * ------------------------------------------------------------------- */
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } }
const toMinor = (x) => Math.round(Number(x) * 100);
const fromMinor = (m) => Math.round(m) / 100;
const ref = (prefix) => "LMK-" + prefix + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** 0712345678 / +254712345678 / 712345678 -> 254712345678 */
function normalizeKePhone(input) {
  const d = String(input || "").replace(/\D/g, "");
  let n = null;
  if (/^254[17]\d{8}$/.test(d)) n = d;
  else if (/^0[17]\d{8}$/.test(d)) n = "254" + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) n = "254" + d;
  if (!n) throw new HttpError(400, "Invalid Kenyan mobile number.");
  return n;
}

/** Payout destination: { type:"mpesa", phone, name? } or { type:"bank", bank_code, account_number, account_name } */
function cleanDestination(d) {
  if (!d || typeof d !== "object") throw new HttpError(400, "Payout details are required.");
  if (d.type === "mpesa") return { type: "mpesa", phone: normalizeKePhone(d.phone), name: String(d.name || "").trim() };
  if (d.type === "bank") {
    const bank_code = String(d.bank_code || "").trim();
    const account_number = String(d.account_number || "").replace(/\s/g, "");
    const account_name = String(d.account_name || "").trim();
    if (!bank_code || !/^\d{6,20}$/.test(account_number) || !account_name) {
      throw new HttpError(400, "Bank payout needs bank_code, account_number and account_name.");
    }
    return { type: "bank", bank_code, account_number, account_name };
  }
  throw new HttpError(400, "Payout type must be 'mpesa' or 'bank'.");
}

/** Flutterwave Transfers target: M-Pesa Kenya uses bank code "MPS" and the phone as account number */
function transferTarget(dest) {
  return dest.type === "mpesa"
    ? { account_bank: "MPS", account_number: dest.phone }
    : { account_bank: dest.bank_code, account_number: dest.account_number };
}

function maskDestination(d) {
  if (!d) return null;
  if (d.type === "mpesa") return { type: "mpesa", phone: d.phone.slice(0, 5) + "****" + d.phone.slice(-3) };
  return { type: "bank", bank_code: d.bank_code, account_number: "****" + d.account_number.slice(-4), account_name: d.account_name };
}

/** Platform commission split of a gross amount (minor units) */
function computeSplit(grossMinor) {
  const feeMinor = Math.round(grossMinor * FEE_PERCENT / 100);
  return { grossMinor, feeMinor, ownerMinor: grossMinor - feeMinor, feePercent: FEE_PERCENT };
}

/** Split an amount across group members by share %. Remainder minor units go to the first members. */
function splitByShares(amountMinor, members) {
  const out = members.map((m) => ({ m, v: Math.floor(amountMinor * m.shareBp / 10000) }));
  let left = amountMinor - out.reduce((s, x) => s + x.v, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length, left--) out[i].v += 1;
  return out.map((x) => ({ member: x.m, amountMinor: x.v }));
}

/* ---------------------------------------------------------------------
 * DATA LAYER – replace with real database calls (use transactions!)
 * Ledger rule: the debit + payout-record creation must be ONE DB transaction,
 * and payments.tx_ref / payouts.reference need UNIQUE constraints.
 * ------------------------------------------------------------------- */
const db = {
  guests: new Map(),     // email -> profile
  owners: new Map(),     // ownerId -> profile
  staff: new Map(),      // staffId -> profile
  payments: new Map(),   // tx_ref -> payment
  payouts: new Map(),    // reference -> payout line
  balances: new Map(),   // account -> minor units
  ledger: [],            // append-only entries

  async getUserFromToken(token) {
    const { userFromToken } = require("../auth/session");
    return userFromToken(token);
  },
  async getBooking(bookingId) {
    // TODO: load from DB. Amounts in MAJOR units.
    return { id: bookingId, ownerId: "owner_1", currency: CURRENCY, total: 4500, depositPercent: 30, amountPaid: 0, propertyName: "Sample Property" };
  },
  async verifyPayToken(_bookingId, _token) {
    // TODO: check the signed pay link emailed/WhatsApped to the guest. Return true when valid.
    return true;
  },
  async markBookingPaid(bookingId, payment) {
    // TODO: update booking.amountPaid, trigger push notification ("New booking paid") to the owner
    console.log("Booking paid:", bookingId, fromMinor(payment.amountMinor), payment.currency);
  },

  async upsertGuest(g) {
    const key = g.email.toLowerCase();
    const prev = this.guests.get(key) || { id: "guest_" + crypto.randomBytes(6).toString("hex"), createdAt: new Date().toISOString() };
    const next = { ...prev, ...g, email: key, updatedAt: new Date().toISOString() };
    this.guests.set(key, next);
    return next;
  },

  balance(acct) { return this.balances.get(acct) || 0; },
  async credit(acct, minor, meta) {
    this.balances.set(acct, this.balance(acct) + minor);
    this.ledger.push({ id: ref("LED"), acct, minor, dir: "credit", ...meta, at: new Date().toISOString() });
  },
  async debit(acct, minor, meta) {
    if (this.balance(acct) < minor) throw new HttpError(402, "Insufficient balance.");
    this.balances.set(acct, this.balance(acct) - minor);
    this.ledger.push({ id: ref("LED"), acct, minor: -minor, dir: "debit", ...meta, at: new Date().toISOString() });
  },
};

const ownerAcct = (id) => "owner:" + id;
const PLATFORM_ACCT = "platform";

/* ---------------------------------------------------------------------
 * Flutterwave API
 * ------------------------------------------------------------------- */
async function flw(path, options) {
  if (!SECRET_KEY) throw new Error("FLW_SECRET_KEY is not set.");
  const res = await fetch(FLW_BASE + path, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: "Bearer " + SECRET_KEY, "Content-Type": "application/json", ...(options && options.headers) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "error") throw new Error(data.message || "Flutterwave error " + res.status);
  return data;
}

/* ---------------------------------------------------------------------
 * 1) GUEST PAYMENTS  (collection + commission split)
 * ------------------------------------------------------------------- */
function amountFor(booking, kind) {
  const total = toMinor(booking.total), paid = toMinor(booking.amountPaid || 0);
  const outstanding = Math.max(0, total - paid);
  if (kind === "deposit") return Math.min(outstanding, Math.round(total * booking.depositPercent / 100));
  return outstanding; // "full" and "balance"
}

let onPayment = function () {};
function setOnPayment(fn) { onPayment = typeof fn === "function" ? fn : function () {}; }

/** Idempotent: safe from /verify, the webhook, or both at once. */
async function reconcile(txRef) {
  const payment = db.payments.get(txRef);
  if (!payment) return { status: "failed", message: "Unknown transaction reference." };
  if (payment.status === "successful") return { status: "successful", payment };

  const { data: tx } = await flw("/transactions/verify_by_reference?tx_ref=" + encodeURIComponent(txRef));
  if (!tx) return { status: "pending", message: "Transaction not found at Flutterwave yet." };

  const ok = tx.status === "successful" && tx.tx_ref === payment.tx_ref &&
    tx.currency === payment.currency && toMinor(tx.amount) >= payment.amountMinor;

  if (payment.status === "successful") return { status: "successful", payment }; // another call won the race
  if (!ok) {
    payment.status = tx.status === "pending" ? "pending" : "failed";
    return { status: payment.status, message: "Payment not successful or amount mismatch." };
  }

  // Flip status synchronously BEFORE any await so a concurrent call cannot double-credit.
  payment.status = "successful";
  Object.assign(payment, { flw_id: tx.id, flw_ref: tx.flw_ref, payment_type: tx.payment_type, paid_at: tx.created_at });
  payment.split = computeSplit(payment.amountMinor);

  const meta = { tx_ref: txRef, bookingId: payment.bookingId };
  await db.credit(ownerAcct(payment.ownerId), payment.split.ownerMinor, { ...meta, note: "Booking income (net of " + FEE_PERCENT + "% commission)" });
  await db.credit(PLATFORM_ACCT, payment.split.feeMinor, { ...meta, note: "Platform commission" });
  await db.markBookingPaid(payment.bookingId, payment);
  Promise.resolve(onPayment(payment)).catch((err) => console.error("payment notify:", err && err.message));
  return { status: "successful", payment };
}

/* ---------------------------------------------------------------------
 * 2) PAYOUT ENGINE (owner -> staff, owner withdrawals, platform sweep)
 * ------------------------------------------------------------------- */
/**
 * lines: [{ destination, amountMinor, narration, payee:{type,id,name,memberName?} }]
 * Debits `account` up front; refunds automatically if Flutterwave rejects the request
 * or later reports the transfer as FAILED (webhook).
 */
async function runTransfers({ account, lines, kind, ownerId, title }) {
  if (!lines.length) throw new HttpError(400, "Nothing to pay.");
  if (lines.length > MAX_BULK_LINES) throw new HttpError(400, "Too many payout lines (max " + MAX_BULK_LINES + ").");
  const total = lines.reduce((s, l) => s + l.amountMinor, 0);

  await db.debit(account, total, { note: title || kind, kind });

  const records = lines.map((l) => {
    const rec = {
      reference: ref("PO"), account, ownerId: ownerId || null, kind, status: "processing",
      amountMinor: l.amountMinor, currency: CURRENCY, destination: l.destination,
      narration: (l.narration || title || "Loomkey payout").slice(0, 100), payee: l.payee || null,
      createdAt: new Date().toISOString(),
    };
    db.payouts.set(rec.reference, rec);
    return rec;
  });

  try {
    const publicOrigin = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
    const callback_url = publicOrigin ? publicOrigin.replace(/\/$/, "") + "/api/payments/webhook" : undefined;
    if (records.length === 1) {
      const r = records[0];
      await flw("/transfers", {
        method: "POST",
        body: JSON.stringify({
          ...transferTarget(r.destination), amount: fromMinor(r.amountMinor), currency: CURRENCY, debit_currency: CURRENCY,
          reference: r.reference, narration: r.narration, beneficiary_name: r.destination.name || r.destination.account_name || undefined, callback_url,
        }),
      });
    } else {
      await flw("/bulk-transfers", {
        method: "POST",
        body: JSON.stringify({
          title: (title || "Loomkey payroll").slice(0, 60),
          bulk_data: records.map((r) => ({
            bank_code: transferTarget(r.destination).account_bank, account_number: transferTarget(r.destination).account_number,
            amount: fromMinor(r.amountMinor), currency: CURRENCY, reference: r.reference, narration: r.narration,
          })),
        }),
      });
    }
  } catch (err) {
    for (const r of records) r.status = "failed";
    await db.credit(account, total, { note: "Refund: payout rejected", kind: "refund" });
    throw new HttpError(502, "Payout could not be started: " + err.message);
  }
  return records;
}

/** Called by the transfer webhook. Idempotent. */
async function settleTransfer(reference, flwStatus) {
  const rec = db.payouts.get(reference);
  if (!rec || rec.status !== "processing") return;
  const s = String(flwStatus || "").toUpperCase();
  if (s === "SUCCESSFUL") { rec.status = "paid"; rec.paidAt = new Date().toISOString(); }
  else if (s === "FAILED") {
    rec.status = "failed"; // set synchronously first
    await db.credit(rec.account, rec.amountMinor, { note: "Refund: payout failed", kind: "refund", reference });
  }
}

function publicPayout(p) {
  return { reference: p.reference, kind: p.kind, status: p.status, amount: fromMinor(p.amountMinor), currency: p.currency,
    payee: p.payee, destination: maskDestination(p.destination), narration: p.narration, createdAt: p.createdAt, paidAt: p.paidAt || null };
}

/* ---------------------------------------------------------------------
 * Profiles: owner + staff (individual or group)
 * ------------------------------------------------------------------- */
function buildStaff(body, ownerId, existing) {
  const kind = body.kind;
  if (!["individual", "group"].includes(kind)) throw new HttpError(400, "kind must be 'individual' or 'group'.");
  const name = String(body.name || "").trim();
  if (!name) throw new HttpError(400, "name is required.");
  const role = STAFF_ROLES.includes(body.role) ? body.role : "other";

  const base = {
    id: existing ? existing.id : "staff_" + crypto.randomBytes(6).toString("hex"),
    ownerId, kind, name, role, active: body.active !== false,
    propertyIds: Array.isArray(body.propertyIds) ? body.propertyIds : [],
    payRate: body.payRate ? { type: body.payRate.type, amount: Number(body.payRate.amount) } : null, // optional hint, e.g. per_clean 800
    createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  if (kind === "individual") {
    return { ...base, payout: cleanDestination(body.payout), members: [] };
  }
  const members = (body.members || []).map((m) => {
    if (!m || !m.name) throw new HttpError(400, "Every group member needs a name.");
    const shareBp = Math.round(Number(m.sharePercent) * 100);
    if (!(shareBp > 0)) throw new HttpError(400, "Every group member needs a sharePercent above 0.");
    return { id: m.id || "mem_" + crypto.randomBytes(4).toString("hex"), name: String(m.name).trim(), shareBp, payout: cleanDestination(m.payout) };
  });
  if (members.length < 2) throw new HttpError(400, "A group needs at least 2 members.");
  if (members.reduce((s, m) => s + m.shareBp, 0) !== 10000) throw new HttpError(400, "Group member shares must add up to exactly 100%.");
  return { ...base, payout: null, members };
}

function publicStaff(s) {
  return {
    id: s.id, kind: s.kind, name: s.name, role: s.role, active: s.active, propertyIds: s.propertyIds, payRate: s.payRate,
    payout: maskDestination(s.payout),
    members: s.members.map((m) => ({ id: m.id, name: m.name, sharePercent: m.shareBp / 100, payout: maskDestination(m.payout) })),
  };
}

function linesForStaff(staff, amountMinor, narration) {
  if (staff.kind === "individual") {
    return [{ destination: staff.payout, amountMinor, narration, payee: { type: "staff", id: staff.id, name: staff.name } }];
  }
  return splitByShares(amountMinor, staff.members)
    .filter((x) => x.amountMinor > 0)
    .map((x) => ({ destination: x.member.payout, amountMinor: x.amountMinor, narration,
      payee: { type: "staff_group", id: staff.id, name: staff.name, memberName: x.member.name } }));
}

function parseAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new HttpError(400, "Amount must be a positive number with at most 2 decimals.");
  }
  return toMinor(n);
}

function getOwnedStaff(ownerId, staffId) {
  const s = db.staff.get(staffId);
  if (!s || s.ownerId !== ownerId) throw new HttpError(404, "Staff profile not found.");
  if (!s.active) throw new HttpError(400, "Staff profile is inactive.");
  return s;
}

/* ---------------------------------------------------------------------
 * Auth middleware
 * ------------------------------------------------------------------- */
async function authenticate(req, res, next) {
  try {
    const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const user = token ? await db.getUserFromToken(token) : null;
    if (!user) return res.status(401).json({ message: "Please sign in." });
    req.user = user;
    next();
  } catch (e) { next(e); }
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: "Not allowed." });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------- */
const router = express.Router();
router.use(express.json({ limit: "100kb" }));

/* ===== GUEST ===== */
router.post("/payments/init", wrap(async (req, res) => {
  const { bookingId, kind = "full", payToken, customer } = req.body || {};
  if (!bookingId) throw new HttpError(400, "bookingId is required.");
  if (!["full", "deposit", "balance"].includes(kind)) throw new HttpError(400, "Invalid payment kind.");
  if (!(await db.verifyPayToken(bookingId, payToken))) throw new HttpError(403, "This payment link is not valid.");

  const booking = await db.getBooking(bookingId);
  if (!booking) throw new HttpError(404, "Booking not found.");
  if (booking.currency !== CURRENCY) throw new HttpError(400, "This property settles in " + booking.currency + "; only " + CURRENCY + " is enabled.");

  const amountMinor = amountFor(booking, kind);
  if (amountMinor <= 0) throw new HttpError(400, "Nothing to pay for this booking.");

  const c = customer || {};
  if (!c.email || !c.name) throw new HttpError(400, "Guest name and email are required.");
  const guest = await db.upsertGuest({
    name: String(c.name).trim(), email: String(c.email).trim(), phone: c.phone_number || c.phone || "", country: c.country || "",
  });

  const tx_ref = ref("TX");
  db.payments.set(tx_ref, {
    tx_ref, bookingId, ownerId: booking.ownerId, guestId: guest.id, guestEmail: guest.email, kind,
    amountMinor, currency: booking.currency, status: "pending", createdAt: new Date().toISOString(),
  });

  res.json({
    tx_ref, amount: fromMinor(amountMinor), currency: booking.currency,
    customer: { name: guest.name, email: guest.email, phone_number: guest.phone },
    description: (kind === "deposit" ? "Deposit – " : "Payment – ") + booking.propertyName,
    meta: { kind, guestId: guest.id },
  });
}));

router.post("/payments/verify", wrap(async (req, res) => {
  const { tx_ref } = req.body || {};
  if (!tx_ref) throw new HttpError(400, "tx_ref is required.");
  const r = await reconcile(tx_ref);
  res.json({
    status: r.status, message: r.message, tx_ref,
    bookingId: r.payment && r.payment.bookingId,
    amount: r.payment && fromMinor(r.payment.amountMinor), currency: r.payment && r.payment.currency,
  });
}));

router.post("/payments/status", wrap(async (req, res) => {
  const p = db.payments.get((req.body || {}).tx_ref);
  if (!p) throw new HttpError(404, "Not found.");
  res.json({ status: p.status, bookingId: p.bookingId, amount: fromMinor(p.amountMinor), currency: p.currency });
}));

router.put("/guests/me", authenticate, requireRole("guest"), wrap(async (req, res) => {
  const { name, phone, country } = req.body || {};
  const g = await db.upsertGuest({ email: req.user.email, name, phone, country });
  res.json({ id: g.id, name: g.name, email: g.email, phone: g.phone, country: g.country });
}));

router.get("/guests/me/payments", authenticate, requireRole("guest"), wrap(async (req, res) => {
  const list = [...db.payments.values()].filter((p) => p.guestEmail === String(req.user.email).toLowerCase());
  res.json(list.map((p) => ({ tx_ref: p.tx_ref, bookingId: p.bookingId, status: p.status, amount: fromMinor(p.amountMinor), currency: p.currency, paid_at: p.paid_at || null })));
}));

/* ===== OWNER ===== */
const owner = [authenticate, requireRole("owner")];

router.get("/owners/me", ...owner, wrap(async (req, res) => {
  const o = db.owners.get(req.user.id);
  res.json(o ? { ...o, payout: maskDestination(o.payout) } : { id: req.user.id });
}));

router.put("/owners/me", ...owner, wrap(async (req, res) => {
  const b = req.body || {};
  const prev = db.owners.get(req.user.id) || { id: req.user.id, createdAt: new Date().toISOString() };
  const next = {
    ...prev, businessName: String(b.businessName || prev.businessName || "").trim(),
    name: String(b.name || prev.name || "").trim(), email: b.email || prev.email, phone: b.phone || prev.phone,
    payout: b.payout ? cleanDestination(b.payout) : prev.payout, // where the owner withdraws to
    updatedAt: new Date().toISOString(),
  };
  db.owners.set(req.user.id, next);
  res.json({ ...next, payout: maskDestination(next.payout) });
}));

router.get("/owners/me/balance", ...owner, wrap(async (req, res) => {
  const acct = ownerAcct(req.user.id);
  res.json({
    currency: CURRENCY, balance: fromMinor(db.balance(acct)), commissionPercent: FEE_PERCENT,
    recent: db.ledger.filter((e) => e.acct === acct).slice(-50).reverse().map((e) => ({ at: e.at, amount: fromMinor(e.minor), note: e.note, bookingId: e.bookingId || null })),
  });
}));

/* -- staff profiles -- */
router.get("/owners/me/staff", ...owner, wrap(async (req, res) => {
  res.json([...db.staff.values()].filter((s) => s.ownerId === req.user.id).map(publicStaff));
}));

router.post("/owners/me/staff", ...owner, wrap(async (req, res) => {
  const s = buildStaff(req.body || {}, req.user.id, null);
  db.staff.set(s.id, s);
  res.status(201).json(publicStaff(s));
}));

router.put("/owners/me/staff/:id", ...owner, wrap(async (req, res) => {
  const existing = db.staff.get(req.params.id);
  if (!existing || existing.ownerId !== req.user.id) throw new HttpError(404, "Staff profile not found.");
  const s = buildStaff({ ...req.body, kind: existing.kind }, req.user.id, existing);
  db.staff.set(s.id, s);
  res.json(publicStaff(s));
}));

router.delete("/owners/me/staff/:id", ...owner, wrap(async (req, res) => {
  const s = db.staff.get(req.params.id);
  if (!s || s.ownerId !== req.user.id) throw new HttpError(404, "Staff profile not found.");
  s.active = false; // deactivate, keep payout history
  res.json({ ok: true });
}));

/* -- pay one staff profile (person or group) -- */
router.post("/owners/me/payouts", ...owner, wrap(async (req, res) => {
  // TODO: require step-up auth (OTP / PIN) here before moving money.
  const { staffId, amount, payType = "other", note = "" } = req.body || {};
  if (!PAY_TYPES.includes(payType)) throw new HttpError(400, "Invalid payType.");
  const staff = getOwnedStaff(req.user.id, staffId);
  const narration = ("Loomkey " + payType + (note ? ": " + note : "")).slice(0, 100);
  const records = await runTransfers({
    account: ownerAcct(req.user.id), ownerId: req.user.id, kind: "staff:" + payType, title: "Pay " + staff.name,
    lines: linesForStaff(staff, parseAmount(amount), narration),
  });
  res.status(202).json(records.map(publicPayout));
}));

/* -- payroll run: many staff in one go -- */
router.post("/owners/me/payouts/bulk", ...owner, wrap(async (req, res) => {
  const items = (req.body || {}).items;
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "items[] is required.");
  const lines = [];
  for (const it of items) {
    if (!PAY_TYPES.includes(it.payType || "salary")) throw new HttpError(400, "Invalid payType.");
    const staff = getOwnedStaff(req.user.id, it.staffId);
    lines.push(...linesForStaff(staff, parseAmount(it.amount), ("Loomkey " + (it.payType || "salary") + (it.note ? ": " + it.note : "")).slice(0, 100)));
  }
  const records = await runTransfers({ account: ownerAcct(req.user.id), ownerId: req.user.id, kind: "staff:payroll", title: (req.body.title || "Payroll"), lines });
  res.status(202).json(records.map(publicPayout));
}));

router.get("/owners/me/payouts", ...owner, wrap(async (req, res) => {
  res.json([...db.payouts.values()].filter((p) => p.ownerId === req.user.id).slice(-100).reverse().map(publicPayout));
}));

/* -- owner withdraws to their own M-Pesa / bank -- */
router.post("/owners/me/withdraw", ...owner, wrap(async (req, res) => {
  const o = db.owners.get(req.user.id);
  if (!o || !o.payout) throw new HttpError(400, "Add your payout details first.");
  const records = await runTransfers({
    account: ownerAcct(req.user.id), ownerId: req.user.id, kind: "owner:withdrawal", title: "Owner withdrawal",
    lines: [{ destination: o.payout, amountMinor: parseAmount((req.body || {}).amount), narration: "Loomkey owner withdrawal", payee: { type: "owner", id: req.user.id, name: o.businessName || o.name } }],
  });
  res.status(202).json(records.map(publicPayout));
}));

/* ===== ADMIN / PLATFORM (the 10%) ===== */
const admin = [authenticate, requireRole("admin")];

router.get("/admin/platform", ...admin, wrap(async (_req, res) => {
  res.json({
    currency: CURRENCY, commissionPercent: FEE_PERCENT, balance: fromMinor(db.balance(PLATFORM_ACCT)),
    payout: { primary: maskDestination(PLATFORM_PAYOUT.primary && cleanDestination(PLATFORM_PAYOUT.primary)),
              secondary: maskDestination(PLATFORM_PAYOUT.secondary && cleanDestination(PLATFORM_PAYOUT.secondary)) },
  });
}));

/** Moves the accumulated commission to the platform's OWN M-Pesa/bank (primary, then secondary). */
async function sweepPlatformCommission() {
  const amountMinor = db.balance(PLATFORM_ACCT);
  if (amountMinor < MIN_SWEEP_MINOR) return { swept: false, reason: "Below minimum sweep amount." };
  const targets = ["primary", "secondary"].filter((k) => PLATFORM_PAYOUT[k]).map((k) => cleanDestination(PLATFORM_PAYOUT[k]));
  if (!targets.length) throw new HttpError(500, "PLATFORM_PAYOUT is not configured.");
  let lastErr;
  for (const destination of targets) {
    try {
      const rec = await runTransfers({
        account: PLATFORM_ACCT, kind: "platform:sweep", title: "Loomkey commission",
        lines: [{ destination, amountMinor, narration: "Loomkey commission", payee: { type: "platform", id: "platform", name: "Loomkey" } }],
      });
      return { swept: true, payouts: rec.map(publicPayout) };
    } catch (e) { lastErr = e; } // runTransfers already refunded; try the next account
  }
  throw lastErr;
}

router.post("/admin/platform/sweep", ...admin, wrap(async (_req, res) => res.status(202).json(await sweepPlatformCommission())));

/* ===== WEBHOOK (source of truth for late/offline payments + transfer results) ===== */
router.post("/payments/webhook", (req, res) => {
  const sig = req.get("verif-hash") || "";
  const a = Buffer.from(sig), b = Buffer.from(SECRET_HASH || "");
  if (!SECRET_HASH || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast, process after

  (async () => {
    const ev = req.body || {}, data = ev.data || {};
    if (ev.event === "charge.completed" && data.tx_ref) await reconcile(data.tx_ref);
    else if (ev.event === "transfer.completed" && data.reference) await settleTransfer(data.reference, data.status);
  })().catch((err) => console.error("webhook error:", err));
});

/* ===== error handler ===== */
router.use((err, _req, res, _next) => {
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ message: err.status ? err.message : "Something went wrong." });
});

module.exports = router;
module.exports.setOnPayment = setOnPayment;
module.exports.sweepPlatformCommission = sweepPlatformCommission; // call from a daily cron if you want auto-sweep
module.exports._internal = { computeSplit, splitByShares, normalizeKePhone, cleanDestination, transferTarget, parseAmount, reconcile, settleTransfer, db, buildStaff, linesForStaff };

/* Mount:
 *   const app = require("express")();
 *   app.use("/api", require("./loomkey-flutterwave-server"));
 *   app.listen(3000);
 */
