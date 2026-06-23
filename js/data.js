/* ============================================================
   data.js — Categories, seed hazards, medals, and the Marin
   geographic bounding box used to project GPS -> map coords.
   Everything is plain globals (no modules) so the app runs
   straight from file:// with zero build step.
   ============================================================ */

// Marin County-ish bounding box (lng/lat). Used to map real GPS
// readings into the stylized 0..100 map space and back.
const GEO_BOUNDS = {
  minLng: -122.62, maxLng: -122.45,
  minLat: 37.93,  maxLat: 38.06,
};

// Hazard categories with color, icon and friendly label.
const CATEGORIES = {
  pothole:  { label: "Pothole",        icon: "🕳️", color: "var(--cat-pothole)",  hint: "City street damage" },
  rut:      { label: "Trail rut",      icon: "🚵", color: "var(--cat-rut)",      hint: "Deep dirt rut / washout" },
  debris:   { label: "Fallen debris",  icon: "🪵", color: "var(--cat-debris)",   hint: "Branch / blockage" },
  wildlife: { label: "Wildlife",       icon: "🦌", color: "var(--cat-wildlife)", hint: "Animal sighting" },
  flood:    { label: "Flooding",       icon: "🌊", color: "var(--cat-flood)",    hint: "Water / washout" },
  other:    { label: "Other",          icon: "⚠️", color: "var(--cat-other)",    hint: "General hazard" },
};

// Convert a stylized x/y (0..100) back to a plausible lat/lng so
// exports and email drafts carry believable coordinates.
function xyToGeo(x, y) {
  const lng = GEO_BOUNDS.minLng + (x / 100) * (GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng);
  const lat = GEO_BOUNDS.maxLat - (y / 100) * (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat);
  return { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
}
function geoToXY(lat, lng) {
  const x = ((lng - GEO_BOUNDS.minLng) / (GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng)) * 100;
  const y = ((GEO_BOUNDS.maxLat - lat) / (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat)) * 100;
  return { x: clamp(x, 4, 96), y: clamp(y, 6, 94) };
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Seed pins. Mix of verified + unverified, urban + trail.
const SEED_HAZARDS = [
  { id: "h1", cat: "pothole",  x: 32, y: 38, sev: 4, status: "verified",   votes: 7, note: "Sunken edge near 4th St crosswalk", zone: "urban" },
  // h1b is the SAME pothole reported by a second user -> should cluster with h1.
  { id: "h1b", cat: "pothole", x: 33, y: 38.6, sev: 4, status: "verified", votes: 3, note: "Same crosswalk pothole, second report", zone: "urban" },
  { id: "h2", cat: "pothole",  x: 38, y: 42, sev: 3, status: "verified",   votes: 4, note: "Small potholes near transit stop", zone: "urban" },
  { id: "h3", cat: "rut",      x: 68, y: 64, sev: 5, status: "verified",   votes: 9, note: "Deep washout on fire road switchback", zone: "trail" },
  // h3b duplicates the washout from another rider.
  { id: "h3b", cat: "rut",     x: 68.6, y: 64.5, sev: 5, status: "verified", votes: 2, note: "Washout — also reported here", zone: "trail" },
  { id: "h4", cat: "debris",   x: 74, y: 55, sev: 2, status: "unverified", votes: 1, note: "Fallen oak limb across singletrack", zone: "trail" },
  { id: "h5", cat: "wildlife", x: 58, y: 72, sev: 2, status: "verified",   votes: 3, note: "Deer crossing at dusk", zone: "trail" },
  { id: "h6", cat: "flood",    x: 47, y: 50, sev: 4, status: "unverified", votes: 2, note: "Creek over the path after rain", zone: "trail" },
  { id: "h7", cat: "pothole",  x: 28, y: 30, sev: 3, status: "unverified", votes: 1, note: "New pothole, unconfirmed", zone: "urban" },
  { id: "h8", cat: "debris",   x: 41, y: 33, sev: 1, status: "verified",   votes: 5, note: "Knocked-over barrier", zone: "urban" },
  { id: "h9", cat: "rut",      x: 80, y: 70, sev: 3, status: "verified",   votes: 6, note: "Erosion gully widening", zone: "trail" },
].map(h => ({ ...h, ...xyToGeo(h.x, h.y), createdAt: Date.now() - Math.random() * 6e8 }));

// Pre-seeded review queue (auto-logged pulses + a widget photo).
const SEED_QUEUE = [
  { id: "q1", type: "pulse", cat: "pothole", x: 30, y: 36, sev: 3, createdAt: Date.now() - 3.2e6, note: "Auto-logged: vertical impact 2.8g" },
  { id: "q2", type: "photo", cat: "debris",  x: 72, y: 58, sev: 2, createdAt: Date.now() - 8.6e6, note: "Quick-capture widget photo" },
  { id: "q3", type: "pulse", cat: "rut",     x: 66, y: 62, sev: 4, createdAt: Date.now() - 1.1e7, note: "Auto-logged: lateral impact 3.4g" },
].map(q => ({ ...q, ...xyToGeo(q.x, q.y) }));

// Achievement medals with their unlock test.
const MEDALS = [
  { id: "first",   icon: "🌱", name: "First Report",  desc: "Log 1 hazard",        test: s => s.profile.mapped >= 1 },
  { id: "verify5", icon: "✅", name: "Trail Checker",  desc: "Verify 5 reports",    test: s => s.profile.verified >= 5 },
  { id: "map10",   icon: "🗺️", name: "Path Mapper",    desc: "Map 10 hazards",      test: s => s.profile.mapped >= 10 },
  { id: "green",   icon: "🌍", name: "Carbon Saver",   desc: "Offset 5kg CO₂",      test: s => s.profile.carbon >= 5 },
  { id: "email",   icon: "✉️", name: "Civic Voice",    desc: "Send 1 city email",   test: s => s.profile.emails >= 1 },
  { id: "otter",   icon: "🦦", name: "River Friend",   desc: "Reach 50 contributions", test: s => s.profile.mapped + s.profile.verified >= 50 },
];

// Weather overlays the user can cycle through (demo data).
const WEATHER_STATES = [
  { id: "clear", icon: "☀️", label: "Clear", note: "No active warnings." },
  { id: "flood", icon: "🌊", label: "Flash-flood watch", note: "Low creek crossings may be impassable." },
  { id: "wind",  icon: "💨", label: "High wind advisory", note: "Watch for falling branches on trails." },
  { id: "fire",  icon: "🔥", label: "Fire weather", note: "Elevated wildfire risk in open space." },
];

// Friendly mascot lines (Marin river otter).
const OTTER_LINES = [
  "Nice work mapping that one!",
  "The trails thank you 🦦",
  "Another hazard tamed!",
  "You're making Marin safer.",
];
