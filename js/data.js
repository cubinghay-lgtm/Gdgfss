/* ============================================================
   data.js — motio static data: Novato map framing, the four
   primary hazard categories, the subtype registry the classifier
   draws its "general term" from, and seed reports.
   Pure lat/lng everywhere.
   ============================================================ */

/* ---- Novato map framing ---- */
const NOVATO_CENTER = { lat: 38.1074, lng: -122.5697 };
const NOVATO_VIEW = { minLat: 38.010, maxLat: 38.200, minLng: -122.730, maxLng: -122.420 };
const DEFAULT_ZOOM = 13;

const TILE_LAYER = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; OpenStreetMap",
  maxZoom: 19,
};

/* ---- Backend imagery/elevation proxy (Google key stays server-side) ---- */
const IMAGERY_ENDPOINT = "https://qmlihmsgqassteijijvm.supabase.co/functions/v1/imagery";

/* ---- The four primary categories (spec) ----
   Title-Case labels, one representative emoji, a flat color.
   The classifier always resolves to one of these four general
   terms; the finer subtype is stored alongside but never shown
   as the pin's identity unless the rider edits it. */
const CATEGORIES = {
  branch:  { label: "Fallen Branch", icon: "🌿", color: "var(--cat-branch)" },
  pothole: { label: "Pothole",       icon: "🕳️", color: "var(--cat-pothole)" },
  trash:   { label: "Trash",         icon: "🗑️", color: "var(--cat-trash)" },
  other:   { label: "Other",         icon: "⚠️", color: "var(--cat-other)" },
};
const CATEGORY_ORDER = ["branch", "pothole", "trash", "other"];

/* ---- Subtype registry (20: common + uncommon / e-bike) ----
   The engine picks the subtype it thinks best fits, then reports
   the parent category as the stable general term. Riders refine
   via the pencil. `common:false` entries are the out-of-the-box
   cases road/e-bike riders actually hit. */
const SUBTYPES = [
  // common
  { id: "pothole",       label: "Pothole / pavement break",     cat: "pothole", common: true },
  { id: "fallen_limb",   label: "Fallen branch or limb",        cat: "branch",  common: true },
  { id: "broken_glass",  label: "Broken glass field",           cat: "trash",   common: true },
  { id: "dumping",       label: "Trash / illegal dumping",      cat: "trash",   common: true },
  { id: "loose_gravel",  label: "Loose gravel patch",           cat: "other",   common: true },
  { id: "standing_water",label: "Standing water / flooding",    cat: "other",   common: true },
  { id: "mud_wash",      label: "Mud slick / drainage wash",    cat: "other",   common: true },
  { id: "cracked_pave",  label: "Cracked / root-heaved pavement", cat: "pothole", common: true },
  { id: "roadkill",      label: "Roadkill",                     cat: "other",   common: true },
  { id: "wet_leaves",    label: "Wet-leaf slime",               cat: "other",   common: true },
  // uncommon / e-bike / out-of-the-box
  { id: "wet_grate",     label: "Wet metal grate (wheel trap)", cat: "pothole", common: false },
  { id: "curb_drop",     label: "Storm-drain edge drop",        cat: "pothole", common: false },
  { id: "chipseal_oil",  label: "Fresh chip-seal oil + stone",  cat: "other",   common: false },
  { id: "helmet_branch", label: "Low branch at helmet height",  cat: "branch",  common: false },
  { id: "trail_wire",    label: "Wire / rope across trail",     cat: "other",   common: false },
  { id: "abandoned_ride",label: "Abandoned scooter / bike",     cat: "trash",   common: false },
  { id: "sand_drift",    label: "Sand drift at a corner",       cat: "other",   common: false },
  { id: "thorns",        label: "Goat-head thorn zone",         cat: "other",   common: false },
  { id: "washout_gully", label: "Washout gully on a descent",   cat: "other",   common: false },
  { id: "glare_defect",  label: "Glare-masked surface defect",  cat: "pothole", common: false },
];
const SUBTYPE_BY_ID = Object.fromEntries(SUBTYPES.map(s => [s.id, s]));
function subtypeLabel(id) { return SUBTYPE_BY_ID[id] ? SUBTYPE_BY_ID[id].label : ""; }

/* ---- Seed reports on real Novato corridors (mixed confidence) ---- */
const SEED_HAZARDS = [
  { id: "s1",  cat: "pothole", subtype: "pothole",      lat: 38.1074, lng: -122.5697, sev: 3, status: "verified",   votes: 4, note: "Pavement break in the Grant Ave bike-lane gap" },
  { id: "s1b", cat: "pothole", subtype: "cracked_pave", lat: 38.1076, lng: -122.5694, sev: 3, status: "verified",   votes: 2, note: "Cracked pavement, same block" },
  { id: "s2",  cat: "pothole", subtype: "curb_drop",    lat: 38.1005, lng: -122.5760, sev: 4, status: "unverified", votes: 1, note: "Storm-drain edge drop on Novato Blvd" },
  { id: "s3",  cat: "other",   subtype: "washout_gully",lat: 38.1355, lng: -122.5870, sev: 5, status: "verified",   votes: 6, note: "Washout narrowing the US-101 parallel path" },
  { id: "s4",  cat: "other",   subtype: "mud_wash",     lat: 38.1120, lng: -122.5390, sev: 4, status: "verified",   votes: 3, note: "Mud slick on Pinheiro Fire Road" },
  { id: "s5",  cat: "branch",  subtype: "helmet_branch",lat: 38.0700, lng: -122.5760, sev: 2, status: "unverified", votes: 1, note: "Low limb over Indian Valley Fire Road" },
  { id: "s6",  cat: "other",   subtype: "loose_gravel", lat: 38.1130, lng: -122.6480, sev: 3, status: "verified",   votes: 3, note: "Loose gravel at Stafford Lake trail edge" },
  { id: "s7",  cat: "trash",   subtype: "dumping",      lat: 38.0760, lng: -122.5560, sev: 2, status: "unverified", votes: 1, note: "Dumped debris near Lamont Ave" },
  { id: "s8",  cat: "branch",  subtype: "fallen_limb",  lat: 38.1068, lng: -122.5720, sev: 2, status: "verified",   votes: 3, note: "Fallen branch across the downtown path" },
].map(h => ({ ...h, createdAt: Date.now() - Math.random() * 6e8 }));
