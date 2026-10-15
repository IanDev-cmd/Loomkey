const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const webpush = require("web-push");
const QRCode = require("qrcode");

const dataDir = path.join(__dirname, "..", "data");
const vapidFile = path.join(dataDir, "vapid.json");
const subFile = path.join(dataDir, "push-subscriptions.json");
const httpsPort = Number(process.env.HTTPS_PORT || 4318);

function lanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const family = net.family === 4 || net.family === "IPv4";
      if (family && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

function publicOrigin() {
  const configured = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  return "https://" + lanAddress() + ":" + httpsPort;
}

function loadVapid() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(vapidFile)) return JSON.parse(fs.readFileSync(vapidFile, "utf8"));
  const keys = webpush.generateVAPIDKeys();
  const saved = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: "mailto:owner@loomkey.test",
  };
  fs.writeFileSync(vapidFile, JSON.stringify(saved, null, 2));
  return saved;
}

const vapid = loadVapid();
webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

function readSubs() {
  if (!fs.existsSync(subFile)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(subFile, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function writeSubs(list) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(subFile, JSON.stringify(list, null, 2));
}

async function notifyAll(payload) {
  const message = JSON.stringify({
    title: payload.title || "Loomkey",
    body: payload.body || "",
    url: payload.url || "/listings",
    tag: payload.tag || "loomkey",
  });
  const next = [];
  for (const sub of readSubs()) {
    try {
      await webpush.sendNotification(sub, message);
      next.push(sub);
    } catch (err) {
      const gone = err && (err.statusCode === 404 || err.statusCode === 410);
      if (!gone) next.push(sub);
    }
  }
  writeSubs(next);
  return next.length;
}

function allowedPath(value) {
  if (value === "/install" || value === "/listings" || value === "/billing") return value;
  if (/^\/pay\/[A-Za-z0-9_-]{1,40}$/.test(value || "")) return value;
  return null;
}

const router = express.Router();
router.use(express.json({ limit: "40kb" }));

router.get("/public-key", (_req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

router.post("/subscribe", async (req, res) => {
  const sub = req.body || {};
  if (!sub.endpoint || !sub.keys) return res.status(400).json({ message: "A push subscription is required." });
  const list = readSubs().filter((item) => item.endpoint !== sub.endpoint);
  list.push(sub);
  writeSubs(list);
  res.json({ ok: true });
  notifyAll({
    title: "Loomkey notifications",
    body: "Push is on. This one is in the phone shade and the in-app popup.",
    url: "/listings",
    tag: "welcome",
  }).catch((err) => console.error("push welcome:", err.message));
});

router.post("/send", async (req, res) => {
  const body = req.body || {};
  const count = await notifyAll({
    title: body.title || "Loomkey",
    body: body.body || "New Loomkey update.",
    url: allowedPath(body.url) || "/listings",
    tag: body.tag || "manual",
  });
  res.json({ delivered: count });
});

const links = express.Router();

links.get("/links", (_req, res) => {
  const origin = publicOrigin();
  res.json({
    origin,
    installUrl: origin + "/install",
    payUrl: origin + "/pay/BK-1042",
  });
});

links.get("/qr.svg", async (req, res) => {
  const target = allowedPath(req.query.path);
  if (!target) return res.status(400).type("text/plain").send("Unsupported QR path.");
  const svg = await QRCode.toString(publicOrigin() + target, {
    type: "svg",
    margin: 1,
    width: 220,
    color: { dark: "#064e32", light: "#ffffff" },
  });
  res.type("image/svg+xml").send(svg);
});

function phoneLinks() {
  const origin = publicOrigin();
  return { origin, installUrl: origin + "/install", payUrl: origin + "/pay/BK-1042" };
}

module.exports = { router, links, notifyAll, phoneLinks, httpsPort, lanAddress };
