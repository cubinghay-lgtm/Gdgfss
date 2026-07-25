/* ============================================================
   civic.js — Novato municipal routing + hazard zones.

   Data supplied by project stakeholders (actioncontact.js and
   hazardlocations.js), converted from RTF into clean JS globals.
   Everything here is plain script-tag globals: no modules, no
   build step, runs from file:// or any static server.

   Exposes:
     NOVATO_MUNICIPAL_DIRECTORY  — routing emails / subject
                                   templates / CA liability text
     NOVATO_EMERGENCY            — 911 + after-hours PW line
     NOVATO_HAZARD_ZONES         — 7 documented risk bounding boxes
     CATEGORY_ROUTING            — hazard category -> routing key
     zonesForPoint / zoneForPoint— point-in-zone lookups
     zoneSensorFactor            — dynamic sensor threshold factor
     buildCivicEmail             — mailto-ready municipal draft
   ============================================================ */

/* ---------------- Municipal directory (verbatim data) ---------------- */

const NOVATO_MUNICIPAL_DIRECTORY = {
  disclaimer:
    "motio is a voluntary, non-emergency reporting utility and does not monitor, verify, dispatch, or guarantee response to any report; users must not enter hazardous areas, approach spills or downed trees, or otherwise place themselves in danger. To the fullest extent permitted by California law, motio and its operators assume no liability for injury, loss, damages, delayed response, inaccurate routing, or any user's attempt to clear, repair, contain, or otherwise manually address a reported hazard.",
  routing: {
    pothole: {
      targetEmail: "pw@novato.org",
      subjectTemplate:
        "Infrastructure Alert: [Issue Type] at [Street Address / Nearest Cross Streets] — Novato, CA",
      contactFormEndpoint:
        "https://novato.vueworks.com/CitizenRequestPortal/"
    },
    trail_or_open_space_hazard: {
      targetEmail: "pw@novato.org",
      subjectTemplate:
        "Parks/Open Space Alert: [Fallen Tree / Trail Erosion / Blockage] at [Trail Name / Access Point / Coordinates]",
      contactFormEndpoint:
        "https://novato.vueworks.com/CitizenRequestPortal/"
    },
    oil_leak_or_waterway_pollution: {
      targetEmail: "mlarizadeh@novato.gov",
      subjectTemplate:
        "Stormwater Pollution Report: [Oil / Debris / Dumping] at [Exact Location / Nearest Drain or Waterway]",
      contactFormEndpoint:
        "https://mcstoppp.org/reporting-form/"
    },
    illegal_dumping: {
      targetEmail: "",
      subjectTemplate:
        "Illegal Dumping Report: [Material / Hazard] at [Exact Location / Nearest Cross Streets]",
      contactFormEndpoint:
        "https://www.marincounty.gov/how-do-i/fixitmarin"
    }
  }
};

/* Emergencies never route through email. Novato directs life-threatening
   situations to 911 and after-hours Public Works emergencies (e.g. a downed
   tree blocking a street) to the 24-hour line below. */
const NOVATO_EMERGENCY = {
  emergency:  { label: "Life-threatening emergency", tel: "911" },
  afterHours: { label: "After-hours Public Works (downed trees, urgent road hazards)", tel: "415-897-4361" },
};

/* ---------------- Hazard zones (verbatim data) ----------------
   Coarse bounding boxes for documented Novato problem corridors.
   Used to (a) notify users on entry and (b) dynamically adjust
   sensor-fusion impact thresholds. Boxes are intentionally coarse;
   tighten to polyline geometries if segment-level flagging is
   ever needed. */

const NOVATO_HAZARD_ZONES = {
  "zone_1": {
    title: "Rush Creek Open Space Preserve — Pinheiro Fire Road & Bahia Trail low-drainage flats (Atherton/Binford trailhead)",
    latMin: 38.1000, latMax: 38.1450,
    lngMin: -122.5600, lngMax: -122.5200,
    riskType: "Landslip / Muddy Erosion / Poor Drainage"
  },
  "zone_2": {
    title: "Indian Valley Open Space Preserve — Indian Valley Fire Road hillside trails (Ignacio Blvd / College of Marin trailhead)",
    latMin: 38.0500, latMax: 38.0900,
    lngMin: -122.5950, lngMax: -122.5450,
    riskType: "Erosion / Landslip"
  },
  "zone_3": {
    title: "Stafford Lake County Park & western Novato Boulevard rural approach (Stafford Lake Bike Park / lake-edge trails)",
    latMin: 38.0950, latMax: 38.1350,
    lngMin: -122.6650, lngMax: -122.6350,
    riskType: "Erosion / Pavement Deterioration"
  },
  "zone_4": {
    title: "Redwood Boulevard landslide corridor — Buck Center Drive to San Antonio Road (US-101 parallel bike path)",
    latMin: 38.1250, latMax: 38.1500,
    lngMin: -122.6050, lngMax: -122.5600,
    riskType: "Landslide / Bike Path Closure"
  },
  "zone_5": {
    title: "Novato Boulevard corridor — Diablo Avenue to San Marin Drive (widening/bike-lane gap & active pavement rehab zone)",
    latMin: 38.0940, latMax: 38.1100,
    lngMin: -122.5900, lngMax: -122.5650,
    riskType: "Pavement Erosion / Missing Bike Lanes"
  },
  "zone_6": {
    title: "Grant Avenue downtown — Redwood Boulevard to Novato Boulevard (bike-lane gap / commuter ped-cyclist conflict)",
    latMin: 38.1030, latMax: 38.1130,
    lngMin: -122.5800, lngMax: -122.5620,
    riskType: "Crowd Bottleneck / Missing Bike Lane"
  },
  "zone_7": {
    title: "South Novato / Redwood Boulevard — Vintage Oaks to Rowland Boulevard retail commuter corridor (storm-drain & pothole repairs near Lamont Avenue)",
    latMin: 38.0600, latMax: 38.0900,
    lngMin: -122.5750, lngMax: -122.5450,
    riskType: "Pavement Erosion / Crowd Bottleneck"
  }
};

/* ---------------- Zone lookups ---------------- */

// All zones containing a point (boxes can overlap, e.g. zones 5 & 6 downtown).
function zonesForPoint(lat, lng) {
  const hits = [];
  for (const [id, z] of Object.entries(NOVATO_HAZARD_ZONES)) {
    if (lat >= z.latMin && lat <= z.latMax && lng >= z.lngMin && lng <= z.lngMax) {
      hits.push({ id, ...z });
    }
  }
  return hits;
}

// Primary zone: the smallest (most specific) box containing the point.
function zoneForPoint(lat, lng) {
  const hits = zonesForPoint(lat, lng);
  if (!hits.length) return null;
  hits.sort((a, b) =>
    ((a.latMax - a.latMin) * (a.lngMax - a.lngMin)) -
    ((b.latMax - b.latMin) * (b.lngMax - b.lngMin)));
  return hits[0];
}

/* Dynamic sensor threshold factor per zone risk profile.
   < 1 lowers the impact bar (more sensitive) where surface damage is
   documented and expected; 1 = neutral. Bottleneck-type zones are about
   awareness (proximity/voice), not accelerometer sensitivity. */
function zoneSensorFactor(zone) {
  if (!zone) return 1;
  const r = zone.riskType.toLowerCase();
  if (r.includes("landslide") || r.includes("landslip")) return 0.82;
  if (r.includes("erosion") || r.includes("pavement") || r.includes("drainage")) return 0.88;
  return 0.95; // bottleneck / missing-bike-lane corridors
}

/* ---------------- Category -> municipal route ----------------
   The four primary categories map onto Novato's official routes.
   A few subtypes override to a more specific department (e.g. an
   oil sheen goes to stormwater, not Public Works). */

const CATEGORY_ROUTING = {
  pothole: "pothole",                    // Public Works service request
  branch:  "trail_or_open_space_hazard", // Parks / Open Space
  trash:   "illegal_dumping",            // FixItMarin
  other:   "pothole",                    // default to Public Works
};
const SUBTYPE_ROUTING = {
  chipseal_oil:   "oil_leak_or_waterway_pollution",
  standing_water: "oil_leak_or_waterway_pollution",
  mud_wash:       "trail_or_open_space_hazard",
  washout_gully:  "trail_or_open_space_hazard",
};

/* Title-Case department names for the Report Directory (spec). */
const DEPARTMENT_NAMES = {
  pothole:                        "Novato Public Works",
  trail_or_open_space_hazard:     "Novato Parks & Open Space",
  oil_leak_or_waterway_pollution: "Marin County Stormwater (MCSTOPPP)",
  illegal_dumping:                "FixItMarin",
};

function routeForHazard(hazard) {
  return SUBTYPE_ROUTING[hazard.subtype] || CATEGORY_ROUTING[hazard.cat] || "pothole";
}

/* ---------------- Civic email drafter ----------------
   Returns { routeKey, department, to, subject, body, formUrl, mailto|null }.
   The reporter's name + report timestamp are included ONLY when the
   profile is Public (spec); a Private reporter stays anonymous. */
function buildCivicEmail(hazard, categoryLabel, opts) {
  opts = opts || {};
  const routeKey = routeForHazard(hazard);
  const route = NOVATO_MUNICIPAL_DIRECTORY.routing[routeKey];
  const zone = zoneForPoint(hazard.lat, hazard.lng);
  const coords = `${hazard.lat.toFixed(5)}, ${hazard.lng.toFixed(5)}`;
  const locText = zone ? `${coords} (${zone.title})` : `${coords} — Novato, CA`;

  const subject = route.subjectTemplate
    .replace("[Issue Type]", categoryLabel)
    .replace("[Fallen Tree / Trail Erosion / Blockage]", categoryLabel)
    .replace("[Oil / Debris / Dumping]", categoryLabel)
    .replace("[Material / Hazard]", categoryLabel)
    .replace("[Street Address / Nearest Cross Streets]", coords)
    .replace("[Trail Name / Access Point / Coordinates]", coords)
    .replace("[Exact Location / Nearest Drain or Waterway]", coords)
    .replace("[Exact Location / Nearest Cross Streets]", coords);

  const lines = [
    `  • Type: ${categoryLabel}`,
    `  • Severity: ${hazard.sev}/5`,
    `  • Location: ${locText}`,
    `  • Map: https://www.openstreetmap.org/?mlat=${hazard.lat}&mlon=${hazard.lng}#map=18/${hazard.lat}/${hazard.lng}`,
    `  • Notes: ${hazard.note || "(none)"}`,
  ];
  // Public reporters attach identity + timestamp; private reporters do not.
  if (opts.isPublic) {
    lines.push(`  • Reported by: ${opts.reporterName || "A Novato resident"}`);
    lines.push(`  • Reported at: ${new Date(hazard.createdAt || Date.now()).toLocaleString("en-US")}`);
  }
  const signoff = opts.isPublic ? (opts.reporterName || "A Novato resident") : "A Novato resident (anonymous)";

  const body =
`To whom it may concern,

I am reporting a non-emergency ${categoryLabel.toLowerCase()} hazard in Novato.

${lines.join("\n")}

Reported through motio, a voluntary community safety tool.
${NOVATO_MUNICIPAL_DIRECTORY.disclaimer}

Thank you,
${signoff}`;

  const mailto = route.targetEmail
    ? `mailto:${route.targetEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  return { routeKey, department: DEPARTMENT_NAMES[routeKey], to: route.targetEmail, subject, body, formUrl: route.contactFormEndpoint, mailto };
}
