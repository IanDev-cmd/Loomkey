const catalog = require("../nomenclature/catalog");
const { userFromToken, bearer } = require("../auth/session");
const listings = require("../domain/listings");

function mountApi(app) {
  app.get("/config.js", (_req, res) => {
    res.type("application/javascript").send(
      "window.LOOMKEY_CONFIG=" +
        JSON.stringify({
          apiBase: "/api",
          publicKey: process.env.FLW_PUBLIC_KEY || "",
          currency: catalog.settlement.currency,
        }) +
        ";"
    );
  });

  app.get("/api/meta", (_req, res) => {
    res.json({
      product: catalog.product,
      actors: catalog.actors,
      staffKinds: catalog.staffKinds,
      staffRoles: catalog.staffRoles,
      payTypes: catalog.payTypes,
      paymentKinds: catalog.paymentKinds,
      payoutTypes: catalog.payoutTypes,
      settlement: catalog.settlement,
      plans: catalog.plans,
      nav: catalog.nav,
      listing: catalog.listing,
    });
  });

  app.get("/api/session", (req, res) => {
    const user = userFromToken(bearer(req));
    if (!user) return res.status(401).json({ message: "Please sign in." });
    res.json({ id: user.id, role: user.role, name: user.name, email: user.email });
  });

  app.get("/api/listings", (req, res) => {
    const status = req.query.status === "active" || req.query.status === "inactive" ? req.query.status : "";
    res.json(listings.list(status));
  });

  app.get("/api/listings/:id", (req, res) => {
    const item = listings.get(req.params.id);
    if (!item) return res.status(404).json({ message: "Listing not found." });
    res.json(item);
  });
}

module.exports = { mountApi };
