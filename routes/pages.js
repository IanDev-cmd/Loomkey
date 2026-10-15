const path = require("path");
const { pages } = require("../nomenclature/routes");

const PUBLIC = path.join(__dirname, "..", "public");

function mountPages(app) {
  for (const page of pages) {
    if (page.redirectsTo) {
      app.get(page.path, (_req, res) => res.redirect(page.redirectsTo));
      continue;
    }
    if (page.name === "guestPay") {
      app.get(page.path, (_req, res) => {
        res.sendFile(path.join(PUBLIC, page.file));
      });
      continue;
    }
    app.get(page.path, (_req, res) => {
      res.sendFile(path.join(PUBLIC, page.file));
    });
  }
}

module.exports = { mountPages };
