const path = require("path");
const { pages } = require("../nomenclature/routes");

const PUBLIC = path.join(__dirname, "..", "public");

function mountPages(app) {
  for (const page of pages) {
    if (page.path === "/") {
      app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC, "landing.html")));
      continue;
    }
    if (page.redirectsTo) {
      app.get(page.path, (_req, res) => res.redirect(page.redirectsTo));
      continue;
    }
    app.get(page.path, (_req, res) => {
      res.sendFile(path.join(PUBLIC, "index.html"));
    });
  }
}

module.exports = { mountPages };
