/* ============================================================
   data.js — motio static data: Novato map config, hazard
   categories, and seed reports placed on real problem corridors
   (grounded in the NOVATO_HAZARD_ZONES boxes in civic.js).
   Pure lat/lng everywhere — there is no stylized projection.
   ============================================================ */

/* ---- Novato map framing ---- */
const NOVATO_CENTER = { lat: 38.1074, lng: -122.5697 };
const NOVATO_VIEW = { minLat: 38.010, maxLat: 38.200, minLng: -122.730, maxLng: -122.420 };
const DEFAULT_ZOOM = 13;

/* Single OSM street basemap (permissive CORS -> offline-cacheable). */
const TILE_LAYER = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
};

/* ---- Capture categories ----
   The four auto-loggable classifier outcomes (pothole, manhole,
   rut, branch) plus two manual-capture civic categories (oil,
   dumping). Each maps to a municipal route via CATEGORY_ROUTING. */
const CATEGORIES = {
  pothole: { label: "Pothole",           icon: "🕳️", color: "var(--cat-pothole)", hint: "Roadway surface damage" },
  manhole: { label: "Manhole defect",    icon: "⭕", color: "var(--cat-manhole)", hint: "Sunken / broken cover" },
  rut:     { label: "Trail rut",         icon: "🚵", color: "var(--cat-rut)",     hint: "Erosion / washout / mud" },
  branch:  { label: "Low branch",        icon: "🌿", color: "var(--cat-branch)",  hint: "Overhanging limb / blockage" },
  oil:     { label: "Oil / stormwater",  icon: "🛢️", color: "var(--cat-oil)",     hint: "Leak or drain pollution" },
  dumping: { label: "Illegal dumping",   icon: "🗑️", color: "var(--cat-dumping)", hint: "Dumped material" },
};

/* ---- Seed reports ----
   Real Novato corridors, mixed verified/unverified. Two Grant Ave
   pothole reports sit ~30 m apart to exercise clustering. */
const SEED_HAZARDS = [
  { id: "s1",  cat: "pothole", lat: 38.1074, lng: -122.5697, sev: 3, status: "verified",   votes: 6, note: "Pavement break in the Grant Ave bike-lane gap near Reichert Ave" },
  { id: "s1b", cat: "pothole", lat: 38.1076, lng: -122.5694, sev: 3, status: "verified",   votes: 2, note: "Same Grant Ave pothole — second report" },
  { id: "s2",  cat: "pothole", lat: 38.1005, lng: -122.5760, sev: 4, status: "unverified", votes: 1, note: "Edge drop-off in the Novato Blvd rehab zone near Diablo Ave" },
  { id: "s3",  cat: "rut",     lat: 38.1355, lng: -122.5870, sev: 5, status: "verified",   votes: 9, note: "Slide debris narrowing the US-101 parallel path (Redwood Blvd corridor)" },
  { id: "s4",  cat: "rut",     lat: 38.1120, lng: -122.5390, sev: 4, status: "verified",   votes: 5, note: "Deep mud ruts on Pinheiro Fire Road — poor drainage flat" },
  { id: "s5",  cat: "branch",  lat: 38.0700, lng: -122.5760, sev: 2, status: "unverified", votes: 1, note: "Low oak limb over Indian Valley Fire Road" },
  { id: "s6",  cat: "rut",     lat: 38.1130, lng: -122.6480, sev: 3, status: "verified",   votes: 4, note: "Lake-edge trail erosion gully at Stafford Lake" },
  { id: "s7",  cat: "pothole", lat: 38.0760, lng: -122.5560, sev: 3, status: "verified",   votes: 3, note: "Failing storm-drain patch near Lamont Ave (Rowland corridor)" },
  { id: "s8",  cat: "manhole", lat: 38.1068, lng: -122.5720, sev: 3, status: "unverified", votes: 1, note: "Sunken manhole collar, downtown Grant Ave" },
  { id: "s9",  cat: "oil",     lat: 38.0980, lng: -122.5700, sev: 2, status: "unverified", votes: 1, note: "Oil sheen at gutter drain, Novato Blvd" },
].map(h => ({ ...h, createdAt: Date.now() - Math.random() * 6e8 }));
