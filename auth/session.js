/**
 * Demo sessions so Billing can call the payments module.
 * Replace with real JWT validation before any shared deployment.
 * Tokens are explicit dev credentials, not secrets of a live account.
 */
const USERS = {
  "dev-owner": {
    id: "owner_1",
    role: "owner",
    email: "owner@loomkey.test",
    name: "Amina Kariuki",
  },
  "dev-admin": {
    id: "admin_1",
    role: "admin",
    email: "ops@loomkey.test",
    name: "Loomkey Ops",
  },
  "dev-guest": {
    id: "guest_1",
    role: "guest",
    email: "lena@example.com",
    name: "Lena Hoffmann",
  },
};

function userFromToken(token) {
  if (!token) return null;
  return USERS[token] || null;
}

function bearer(req) {
  return (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

module.exports = { USERS, userFromToken, bearer };
