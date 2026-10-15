const fs = require("fs");
const https = require("https");
const path = require("path");
const express = require("express");
const selfsigned = require("selfsigned");
const payments = require("./payments/loomkey-flutterwave-server");
const { assertPaymentContract } = require("./nomenclature/routes");
const { mountPages } = require("./routes/pages");
const { mountApi } = require("./routes/api");
const { seed } = require("./domain/seed");
const push = require("./pwa/push");

assertPaymentContract(payments);
seed(payments);

payments.setOnPayment((payment) => {
  const amount = payment.amountMinor != null ? (payment.amountMinor / 100).toFixed(2) : "";
  return push.notifyAll({
    title: "Payment received",
    body: "Booking " + payment.bookingId + (amount ? " · " + amount + " " + (payment.currency || "KES") : "") + " is paid.",
    url: "/billing",
    tag: "pay-" + payment.bookingId,
  });
});

const app = express();
const port = Number(process.env.PORT || 4317);
const publicDir = path.join(__dirname, "public");

app.disable("x-powered-by");
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "loomkey" });
});
app.use((req, res, next) => {
  if (req.path === "/sw.js" || req.path === "/manifest.webmanifest") res.set("Cache-Control", "no-cache");
  next();
});
app.get("/install", (_req, res) => res.sendFile(path.join(publicDir, "install.html")));
app.use("/api/push", push.router);
app.use("/api/pwa", push.links);
mountApi(app);
app.use("/api", payments);
app.use(express.static(publicDir));
mountPages(app);

app.use((req, res) => {
  res.status(404).type("text/plain").send("Not found: " + req.method + " " + req.path);
});

function listen() {
  app.listen(port, () => {
    const links = push.phoneLinks();
    console.log("Loomkey listening on http://localhost:" + port);
    console.log("Phone install (HTTPS) " + links.installUrl);
  });
}

async function listenHttps() {
  const certFile = path.join(__dirname, "data", "cert.pem");
  const keyFile = path.join(__dirname, "data", "key.pem");
  let cert;
  let key;
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    cert = fs.readFileSync(certFile);
    key = fs.readFileSync(keyFile);
  } else {
    const ip = push.lanAddress();
    const pems = await selfsigned.generate([{ name: "commonName", value: "loomkey.local" }], {
      keySize: 2048,
      algorithm: "sha256",
      notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 2, value: "loomkey.local" },
            { type: 7, ip: "127.0.0.1" },
            { type: 7, ip },
          ],
        },
      ],
    });
    fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fs.writeFileSync(certFile, pems.cert);
    fs.writeFileSync(keyFile, pems.private);
    cert = pems.cert;
    key = pems.private;
  }
  https.createServer({ cert, key }, app).listen(push.httpsPort, () => {
    console.log("Loomkey HTTPS on https://localhost:" + push.httpsPort);
  });
}

listen();
listenHttps().catch((err) => console.error("HTTPS did not start:", err.message));
