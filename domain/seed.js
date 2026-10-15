/**
 * Opens the in-memory ledger with one owner, one cleaner, and a balance
 * so the Billing page can load without Flutterwave keys.
 * Transfers still require FLW_SECRET_KEY.
 */
function seed(payments) {
  const { db, buildStaff } = payments._internal;

  db.owners.set("owner_1", {
    id: "owner_1",
    businessName: "Kariuki Stays",
    name: "Amina Kariuki",
    email: "owner@loomkey.test",
    phone: "0712000000",
    payout: null,
    createdAt: new Date().toISOString(),
  });

  const cleaner = buildStaff(
    {
      kind: "individual",
      name: "Jane Wanjiru",
      role: "cleaner",
      propertyIds: ["listing_1312", "listing_6"],
      payRate: { type: "per_task", amount: 800 },
      payout: { type: "mpesa", phone: "0712345678", name: "Jane Wanjiru" },
    },
    "owner_1",
    null
  );
  db.staff.set(cleaner.id, cleaner);

  const crew = buildStaff(
    {
      kind: "group",
      name: "Sunrise Cleaners",
      role: "cleaner",
      propertyIds: ["listing_84"],
      members: [
        { name: "Jane Wanjiru", sharePercent: 60, payout: { type: "mpesa", phone: "0712345678", name: "Jane Wanjiru" } },
        { name: "Peter Otieno", sharePercent: 40, payout: { type: "mpesa", phone: "0722000111", name: "Peter Otieno" } },
      ],
    },
    "owner_1",
    null
  );
  db.staff.set(crew.id, crew);

  return db.credit("owner:owner_1", 12500000, { note: "Opening balance" });
}

module.exports = { seed };
