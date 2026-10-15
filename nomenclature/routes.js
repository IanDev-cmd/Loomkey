/**
 * Route contract.
 * Page paths match the console nav.
 * API paths match loomkey-flutterwave.js (apiBase + path).
 */
const catalog = require("./catalog");

const pages = [
  { method: "GET", path: "/", name: "home", redirectsTo: "/listings" },
  ...catalog.nav.map((item) => ({
    method: "GET",
    path: item.path,
    name: item.id,
    file: item.id + ".html",
  })),
  { method: "GET", path: "/pay/:bookingId", name: "guestPay", file: "pay.html", actor: "guest" },
];

const api = [
  { method: "GET", path: "/api/meta", name: "meta", actor: "public", module: "app" },
  { method: "GET", path: "/api/session", name: "session", actor: "any", module: "app" },
  { method: "GET", path: "/api/listings", name: "listListings", actor: "public", module: "listings" },
  { method: "GET", path: "/api/listings/:id", name: "getListing", actor: "public", module: "listings" },

  { method: "POST", path: "/api/payments/init", name: "initPayment", actor: "guest", module: "payments" },
  { method: "POST", path: "/api/payments/verify", name: "verifyPayment", actor: "guest", module: "payments" },
  { method: "POST", path: "/api/payments/status", name: "paymentStatus", actor: "guest", module: "payments" },
  { method: "POST", path: "/api/payments/webhook", name: "webhook", actor: "flutterwave", module: "payments" },
  { method: "PUT", path: "/api/guests/me", name: "saveGuest", actor: "guest", module: "payments" },
  { method: "GET", path: "/api/guests/me/payments", name: "guestPayments", actor: "guest", module: "payments" },

  { method: "GET", path: "/api/owners/me", name: "ownerProfile", actor: "owner", module: "payments" },
  { method: "PUT", path: "/api/owners/me", name: "saveOwner", actor: "owner", module: "payments" },
  { method: "GET", path: "/api/owners/me/balance", name: "ownerBalance", actor: "owner", module: "payments" },
  { method: "GET", path: "/api/owners/me/staff", name: "listStaff", actor: "owner", module: "payments" },
  { method: "POST", path: "/api/owners/me/staff", name: "createStaff", actor: "owner", module: "payments" },
  { method: "PUT", path: "/api/owners/me/staff/:id", name: "updateStaff", actor: "owner", module: "payments" },
  { method: "DELETE", path: "/api/owners/me/staff/:id", name: "removeStaff", actor: "owner", module: "payments" },
  { method: "POST", path: "/api/owners/me/payouts", name: "payStaff", actor: "owner", module: "payments" },
  { method: "POST", path: "/api/owners/me/payouts/bulk", name: "payroll", actor: "owner", module: "payments" },
  { method: "GET", path: "/api/owners/me/payouts", name: "listPayouts", actor: "owner", module: "payments" },
  { method: "POST", path: "/api/owners/me/withdraw", name: "withdraw", actor: "owner", module: "payments" },

  { method: "GET", path: "/api/admin/platform", name: "platform", actor: "admin", module: "payments" },
  { method: "POST", path: "/api/admin/platform/sweep", name: "sweep", actor: "admin", module: "payments" },
];

/** Client calls in public/js/loomkey-flutterwave.js, without the /api prefix. */
const clientCalls = [
  ["POST", "/payments/init"],
  ["POST", "/payments/verify"],
  ["POST", "/payments/status"],
  ["PUT", "/guests/me"],
  ["GET", "/guests/me/payments"],
  ["GET", "/owners/me"],
  ["PUT", "/owners/me"],
  ["GET", "/owners/me/balance"],
  ["GET", "/owners/me/staff"],
  ["POST", "/owners/me/staff"],
  ["PUT", "/owners/me/staff/:id"],
  ["DELETE", "/owners/me/staff/:id"],
  ["POST", "/owners/me/payouts"],
  ["POST", "/owners/me/payouts/bulk"],
  ["GET", "/owners/me/payouts"],
  ["POST", "/owners/me/withdraw"],
  ["GET", "/admin/platform"],
  ["POST", "/admin/platform/sweep"],
];

function paymentRoutes(router) {
  const found = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
    for (const method of methods) found.push(method.toUpperCase() + " " + layer.route.path);
  }
  return found;
}

function assertPaymentContract(router) {
  const found = new Set(paymentRoutes(router));
  const missing = clientCalls.filter(([method, path]) => !found.has(method + " " + path));
  if (missing.length) {
    throw new Error(
      "Flutterwave client calls with no server route: " +
        missing.map(([m, p]) => m + " " + p).join(", ")
    );
  }
}

module.exports = { pages, api, clientCalls, paymentRoutes, assertPaymentContract };
