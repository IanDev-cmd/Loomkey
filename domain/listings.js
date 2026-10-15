/**
 * Listing is the console entity (a room on a stay).
 * The payments module still says "property" on a booking and on staff.propertyIds.
 */
const LISTINGS = [
  {
    id: "listing_1312",
    name: "Room 1312",
    status: "active",
    stars: 4,
    address: { line: "Richmond Place 1312, Charlotte, New York" },
    devices: { door: "locked", energyKwh: 412, noiseDb: 23 },
    guest: { name: "Lena Hoffmann", origin: "Berlin, Germany" },
    stay: { checkIn: "12 Nov 2018", checkOut: "15 Nov 2018", guestCount: 3 },
    codes: { access: "3482", owner: "7190", cleaner: "2256" },
  },
  {
    id: "listing_6",
    name: "Room 6",
    status: "active",
    stars: 5,
    address: { line: "6 Fremont Street, Loyalton State, Boston" },
    devices: { door: "locked", energyKwh: 592, noiseDb: 59 },
    guest: { name: "Ethan Stone", origin: "Warsaw, Poland" },
    stay: { checkIn: "22 Nov 2018", checkOut: "26 Nov 2018", guestCount: 7 },
    codes: { access: "5762", owner: "1859", cleaner: "4565" },
  },
  {
    id: "listing_84",
    name: "Room 84",
    status: "active",
    stars: 3,
    address: { line: "84 Vista Street, Encinitas, Washington" },
    devices: { door: "locked", energyKwh: 623, noiseDb: 53 },
    guest: { name: "Marcus Webb", origin: "Austin, USA" },
    stay: { checkIn: "18 Nov 2018", checkOut: "21 Nov 2018", guestCount: 2 },
    codes: { access: "9031", owner: "6247", cleaner: "1783" },
  },
  {
    id: "listing_12",
    name: "Room 12",
    status: "inactive",
    stars: 2,
    address: { line: "12 Harbor Lane, Mombasa" },
    devices: { door: "locked", energyKwh: 0, noiseDb: 0 },
    guest: null,
    stay: null,
    codes: { access: "1104", owner: "8821", cleaner: "3390" },
  },
];

function list(status) {
  if (!status) return LISTINGS;
  return LISTINGS.filter((item) => item.status === status);
}

function get(id) {
  return LISTINGS.find((item) => item.id === id) || null;
}

module.exports = { LISTINGS, list, get };
