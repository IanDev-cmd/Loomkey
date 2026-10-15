/**
 * Canonical Loomkey vocabulary.
 * Console words come from the listings comp.
 * Ledger words come from the Flutterwave module.
 * They are not interchangeable.
 */
module.exports = {
  product: "Loomkey",

  /** Who can sign in. `staff` is a payee profile, not a login. */
  actors: ["guest", "owner", "admin"],

  /** Payee profile owned by an owner. Not a console user. */
  staffKinds: ["individual", "group"],

  staffRoles: [
    "cleaner",
    "technician",
    "manager",
    "co-host",
    "caretaker",
    "laundry",
    "security",
    "gardener",
    "driver",
    "other",
  ],

  /** Why an owner is paying a staff profile. */
  payTypes: ["salary", "per_task", "bonus", "advance", "reimbursement", "other"],

  /** How a guest pays one booking. Amount is chosen on the server. */
  paymentKinds: ["full", "deposit", "balance"],

  /** Where money leaves Flutterwave. Kenya M-Pesa or a bank account. */
  payoutTypes: ["mpesa", "bank"],

  /** Settlement currency. The console plan price is a different currency. */
  settlement: {
    currency: "KES",
    platformFeePercent: 10,
    ownerSharePercent: 90,
    minSweepMajor: 100,
  },

  /**
   * Console subscription shown on the listings artboard.
   * No collection route exists for this. It is not the 10% commission.
   */
  plans: [
    { id: "free", label: "Free plan", price: null, currency: null, interval: null },
    { id: "pro", label: "Pro", price: 50, currency: "USD", interval: "month" },
  ],

  /**
   * Console navigation. `provider` and `user` are screen names only.
   * They are not staff, guest, or owner.
   */
  nav: [
    { id: "listings", label: "Listings", path: "/listings" },
    { id: "dashboard", label: "Dashboard", path: "/dashboard" },
    { id: "providers", label: "Providers", path: "/providers" },
    { id: "users", label: "Users", path: "/users" },
    { id: "billing", label: "Billing", path: "/billing" },
    { id: "settings", label: "Settings", path: "/settings" },
  ],

  /** Listing device + code words used on the detail panel. */
  listing: {
    statuses: ["active", "inactive"],
    devices: ["door", "energy", "noise"],
    doorStates: ["locked", "unlocked"],
    codes: ["access", "owner", "cleaner"],
    panelTabs: ["codes", "devices", "bookings"],
  },

  /**
   * Artboard field names → canonical names.
   * The listings page still renders the artboard names.
   */
  listingFieldMap: {
    addr: "address.line",
    kwh: "devices.energyKwh",
    db: "devices.noiseDb",
    "codes.a": "codes.access",
    "codes.o": "codes.owner",
    "codes.c": "codes.cleaner",
    "guest.n": "guest.name",
    "guest.l": "guest.origin",
    ci: "stay.checkIn",
    co: "stay.checkOut",
    gs: "stay.guestCount",
  },

  /** Reference prefixes written by the ledger (`LMK-TX-…`). */
  refPrefixes: {
    payment: "TX",
    payout: "PO",
    ledger: "LED",
  },
};
