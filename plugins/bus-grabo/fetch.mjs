// TRMNL Plugin #3: Bus departures near Gråbo (Västtrafik)
//
// LINE CORRECTION (found via the debug_all_x3 diagnostic - see git log):
// this plugin previously assumed a single physical route on line X3 ran
// Sjövik -> Mjörn -> Gråbo -> Göteborg, and filtered BOTH boards to X3.
// That was wrong. Line X3 never stops at Mjörn at all (confirmed live -
// debug_all_x3.mjorn came back completely empty, every single run,
// regardless of direction filtering). The line that actually runs
// Sjövik -> Mjörn -> Gråbo -> Lerum is the LOCAL SHUTTLE, **line 525**
// (endpoints Brobacka and Lerum, per Västtrafik's own line 525 timetable
// and OSM's route relation) - the exact line this plugin previously
// described as "never reaches Gråbo", which was the actual bug. X3 is a
// separate, unrelated express line that only covers Gråbo -> Göteborg (and
// on to Kullavik/Särö) - it doesn't touch Sjövik or Mjörn.
//
// So the two boards below are two DIFFERENT lines and NOT the same
// physical bus - they only meet at Gråbo, where a rider would actually
// change buses:
//   1. "Mjörn, Lerum" stop-area, filtered to line 525, keeping only the
//      Gråbo-bound direction (destination NOT Sjövik/Brobacka - those
//      head the other way, away from Gråbo).
//   2. "Gråbo busstation" stop-area (serves Mjörnbotorget square, ~130m
//      away - there's no stop literally named "Mjörnbotorget"), filtered
//      to line X3 towards Göteborg (it stops at Polhemsplatsen, ~10 min
//      walk from Nils Ericson Terminalen, on its way further south to
//      Kullavik/Särö).
//
// Also computes, for EACH of the two departures above, a live "where is
// this specific bus right now" position along the Sjövik -> Mjörn -> Gråbo
// stretch, using Västtrafik's own real-time vehicle-position endpoint
// (GET /positions?lowerLeftLat=...&lineDesignations=525,X3 - a
// bounding-box query, undocumented in the public developer portal pages
// but present in the v4 API's OpenAPI schema and backed by the same OAuth
// credentials as everything else here). This is genuine GPS, not a
// schedule estimate - confirmed via the API's own swagger model docs
// (JourneyPositionApiModel: latitude/longitude/name/line/direction/
// detailsReference), unlike Trafiklab's public GTFS-Realtime mirror,
// which explicitly does NOT carry real-time vehicle positions for
// Västtrafik (static schedule data only, per Trafiklab's own coverage
// table) - that mirror was the first thing checked and is a dead end for
// this operator; the operator's own "Planera Resa" v4 API is the one that
// actually has it. Each departure is matched to its own live fix by
// `detailsReference` (see describeDeparturePosition()) - both lines are
// requested from /positions in one call since the two boards' buses can
// both be in the same small bounding box near Gråbo at once.
//
// The three route points (Sjövik busstation, Mjörn, Gråbo busstation) are
// resolved to lat/long at fetch time via GET /locations/by-text, rather
// than hardcoded - keeps this correct automatically if Västtrafik ever
// moves a stop, and avoids hand-copying coordinates from a map. The bus's
// live position is then projected onto the 2-segment Sjövik-Mjörn-Gråbo
// polyline to get a 0..1 "how far along the route" progress fraction,
// which is drawn as a small progress-bar PNG (position-map.png) - see
// renderPositionMap(). That image follows the exact same rules the
// weather-yr plugin's icons needed the hard way (see its README): a plain
// 8-bit RGB PNG (not palette/1-bit), and it's a single lone <img> in the
// template, never a flex sibling of another <img>.
//
// NOTE on the 5 intermediate stops between Sjövik and Mjörn: the user's
// original request mentioned "the 5 stops from Sjövik before Mjörn" for
// the map. Those exact intermediate stop names could not be verified from
// this environment (no live Västtrafik credentials available outside
// GitHub Actions, and public route-order sources for this specific stretch
// were inconsistent/unreliable). Rather than guess and risk showing wrong
// stop names on a device you look at daily, the map currently only plots
// the 3 confirmed endpoints (Sjövik / Mjörn / Gråbo) plus the bus's real
// position between them. If you tell me the 5 intermediate stop names (in
// order), they're straightforward to add as extra markers along the same
// line - see ROUTE_STOP_QUERIES below.
//
// Requires a Västtrafik API "Authentication Key" (base64 client_id:secret)
// from https://developer.vasttrafik.se/ (free), subscribed to "Planera
// Resa" v4, passed in via the VASTTRAFIK_AUTH_KEY environment variable /
// GitHub Actions secret. A fresh OAuth2 access token is requested on every
// run (client_credentials grant) - no token persistence needed.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fetchWithRetry } from "../../lib/http.mjs";
import { formatUpdatedDisplay } from "../../lib/format.mjs";
import { shouldSkipFetch } from "../../lib/throttle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = "https://ext-api.vasttrafik.se/pr/v4";
const TOKEN_URL = "https://ext-api.vasttrafik.se/token";

const MJORN_GID = "9021014017430000"; // "Mjörn, Lerum" stop-area
const GRABO_GID = "9021014017320000"; // "Gråbo busstation, Lerum" stop-area - serves Mjörnbotorget
const MJORN_LINE = "525"; // Sjövik -> Mjörn -> Gråbo -> Lerum (see the LINE CORRECTION note above - NOT X3)
const GRABO_LINE = "X3"; // Gråbo -> Göteborg -> Kullavik/Särö - a different, unrelated line from MJORN_LINE

// Extra stop-area queries for a richer map, once known (see NOTE above) -
// insert names in order between "Sjövik busstation, Lerum" and
// "Mjörn, Lerum" in ROUTE_STOP_QUERIES further down.
const ROUTE_STOP_QUERIES = ["Sjövik busstation, Lerum", "Mjörn, Lerum", "Gråbo busstation, Lerum"];

const MJORN_QUERY_LIMIT = 20; // line 525 runs both directions through Mjörn - ask for enough
// raw results that the next Gråbo-bound one isn't missed further down the list.
const GRABO_QUERY_LIMIT = 20;
const MAX_ROUTE_DEVIATION_METERS = 1500; // beyond this, treat the bus as "not on this stretch right now"

const OUTPUT_DIR = path.join(__dirname, "..", "..", "public", "bus-grabo");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "data.json");
const MAP_IMAGE_FILENAME = "position-map.png";
const MAP_IMAGE_PATH = path.join(OUTPUT_DIR, MAP_IMAGE_FILENAME);
const MAP_IMAGE_PUBLIC_URL = `https://hikmek.github.io/trmnl_plugins/bus-grabo/${MAP_IMAGE_FILENAME}`;

// --- Pixel-art bus icons ---
//
// 30 pre-generated vintage-styled silhouettes (see generate-bus-icons.mjs -
// this list must match its BUS_VARIANTS keys exactly, since the filenames
// are derived from them: icons/bus-<name>.png). One is picked at random for
// each board on every fetch (guaranteed different from each other so the
// two boards never show the same icon), same rotation idea as banksy's
// gallery pick. Same cache-busting convention as weather-yr's ICON_VERSION.
const ICON_BASE_URL = "https://hikmek.github.io/trmnl_plugins/bus-grabo/icons";
const ICON_VERSION = (process.env.GITHUB_SHA || new Date().toISOString().slice(0, 10)).slice(0, 8);
const BUS_ICON_NAMES = [
  "brobacka-1930", "sjovik-1930", "gothenburg-1930", "chicago-1930", "london-1930",
  "paris-1930", "berlin-1930",
  "lerum-1950", "grabo-1950", "london-1950", "moscow-1950", "tokyo-1950",
  "havana-1950", "rio-1950", "cairo-1950", "mumbai-1950", "sydney-1950",
  "gothenburg-1960", "stockholm-1960", "wolfsburg-1960", "detroit-1960", "new-york-1960",
  "amsterdam-1960", "oslo-1960", "helsinki-1960", "seoul-1960", "nairobi-1960",
  "lagos-1960", "mexico-city-1960", "grabo-express-1960",
];

function busIconUrl(name) {
  return `${ICON_BASE_URL}/bus-${name}.png?v=${ICON_VERSION}`;
}

// Picks 2 names from BUS_ICON_NAMES, guaranteed distinct from each other -
// [mjornIconName, graboIconName].
function pickTwoDistinctIcons() {
  const a = BUS_ICON_NAMES[Math.floor(Math.random() * BUS_ICON_NAMES.length)];
  let b = a;
  while (b === a) {
    b = BUS_ICON_NAMES[Math.floor(Math.random() * BUS_ICON_NAMES.length)];
  }
  return [a, b];
}

async function getAccessToken() {
  const authKey = process.env.VASTTRAFIK_AUTH_KEY;
  if (!authKey) {
    throw new Error("VASTTRAFIK_AUTH_KEY environment variable is not set");
  }
  const res = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Västtrafik token request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function getDepartures(token, stopAreaGid, limit) {
  const url = `${API_BASE}/stop-areas/${stopAreaGid}/departures?limit=${limit}`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Västtrafik departures request failed (${stopAreaGid}): ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.results || [];
}

// GET /locations/by-text - resolves a place name to Västtrafik's own
// coordinates for it, so the route line's endpoints stay correct without
// hand-copied lat/long constants.
async function resolveLocation(token, query) {
  const url = `${API_BASE}/locations/by-text?q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Västtrafik location lookup failed ("${query}"): ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const hit = json.results?.[0];
  if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") {
    throw new Error(`No coordinates found for "${query}"`);
  }
  return { name: hit.name, lat: hit.latitude, lon: hit.longitude };
}

// GET /positions - real-time vehicle GPS within a bounding box. Response
// is documented as a bare JourneyPositionApiModel[]; fall back to
// `.results` defensively in case it's ever wrapped.
async function getPositions(token, { minLat, minLon, maxLat, maxLon, lineDesignations }) {
  const params = new URLSearchParams({
    lowerLeftLat: String(minLat),
    lowerLeftLong: String(minLon),
    upperRightLat: String(maxLat),
    upperRightLong: String(maxLon),
  });
  for (const line of lineDesignations) params.append("lineDesignations", line);
  const url = `${API_BASE}/positions?${params.toString()}`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Västtrafik positions request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : json.results || [];
}

function minutesUntil(iso, nowMs) {
  return Math.round((new Date(iso).getTime() - nowMs) / 60000);
}

function hhmm(iso) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// "9 sep 22:57" - used for the "senast sedd" (last seen) timestamp, which
// (unlike a scheduled departure time) could in principle be from an earlier
// day if a bus hasn't reported a fresh GPS fix in a while, so the date is
// worth keeping visible rather than just the time.
function dateAndTime(iso) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDeparture(raw, nowMs) {
  const planned = raw.plannedTime;
  const estimated = raw.estimatedTime || raw.plannedTime;
  const delayMinutes = Math.round(
    (new Date(estimated).getTime() - new Date(planned).getTime()) / 60000
  );

  return {
    line: raw.serviceJourney?.line?.shortName ?? "?",
    destination: raw.serviceJourney?.directionDetails?.shortDirection ?? raw.serviceJourney?.direction ?? "?",
    platform: raw.stopPoint?.platform ?? null,
    planned_time: hhmm(planned),
    estimated_time: hhmm(estimated),
    minutes_until: minutesUntil(estimated, nowMs),
    delay_minutes: delayMinutes,
    is_cancelled: !!raw.isCancelled,
    // Links this departure to a live GPS fix from GET /positions (same
    // field name on both endpoints - see resolvePositionsForDepartures()).
    details_reference: raw.detailsReference ?? null,
  };
}

// Line 525 runs both directions through Mjörn: Brobacka/Sjövik-bound (away
// from Gråbo) and Gråbo/Lerum-bound (through Gråbo). Exclude anything whose
// destination text names either of the away-from-Gråbo endpoints to keep
// only the Gråbo-bound direction.
const AWAY_FROM_GRABO_DESTINATIONS = ["sjövik", "sjovik", "brobacka"];
function isTowardsGrabo(raw) {
  const dest = (raw.serviceJourney?.directionDetails?.shortDirection ?? raw.serviceJourney?.direction ?? "").toLowerCase();
  return !AWAY_FROM_GRABO_DESTINATIONS.some((away) => dest.includes(away));
}

// Returns up to `count` upcoming matches, soonest first - used to show both
// the immediate ETD and the following scheduled departure (the two boards
// run roughly hourly, so [0] and [1] are typically "this hour" / "next
// hour"). nextDeparture() below is the old single-result shape, kept as a
// thin wrapper since most callers only need the next one.
function nextDepartures(rawDepartures, nowMs, { line, requireTowardsGrabo }, count = 1) {
  return rawDepartures
    .filter((d) => d.serviceJourney?.line?.shortName === line)
    .filter((d) => !requireTowardsGrabo || isTowardsGrabo(d))
    .map((d) => formatDeparture(d, nowMs))
    .filter((d) => d.minutes_until >= 0)
    .sort((a, b) => a.minutes_until - b.minutes_until)
    .slice(0, count);
}

function nextDeparture(rawDepartures, nowMs, opts) {
  return nextDepartures(rawDepartures, nowMs, opts, 1)[0] ?? null;
}

// Diagnostic: every raw departure at a stop (any line, unfiltered by
// direction), so a future "no departure"/wrong-direction surprise can be
// checked directly against real data instead of guessed at - this is
// exactly what caught the line-number bug documented at the top of this
// file (debug_all_x3.mjorn was always empty because X3 never stops there;
// this generalized version would have shown the real line 525 departures
// immediately instead of needing a live user report first).
function debugRawDepartures(rawDepartures, nowMs, limit = 10) {
  return rawDepartures.slice(0, limit).map((d) => {
    const f = formatDeparture(d, nowMs);
    return { line: f.line, destination: f.destination, planned_time: f.planned_time, minutes_until: f.minutes_until };
  });
}

// --- Route geometry: haversine distance + point-to-polyline projection ---

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function segmentLengthsMeters(routePoints) {
  const lengths = [];
  for (let i = 0; i < routePoints.length - 1; i++) {
    lengths.push(haversineMeters(routePoints[i], routePoints[i + 1]));
  }
  return lengths;
}

// Local equirectangular projection (fine for a route only a few km long) of
// point p onto segment a->b. Returns the fraction 0..1 along the segment
// and the perpendicular distance from p to the segment, in meters.
function projectOntoSegment(p, a, b) {
  const latRef = toRad((a.lat + b.lat) / 2);
  const kx = 111320 * Math.cos(latRef);
  const ky = 110540;

  const bx = (b.lon - a.lon) * kx;
  const by = (b.lat - a.lat) * ky;
  const px = (p.lon - a.lon) * kx;
  const py = (p.lat - a.lat) * ky;

  const abLenSq = bx * bx + by * by || 1;
  let t = (px * bx + py * by) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const dx = px - t * bx;
  const dy = py - t * by;
  return { fraction: t, distMeters: Math.sqrt(dx * dx + dy * dy) };
}

function fractionAtStop(routePoints, index) {
  const lengths = segmentLengthsMeters(routePoints);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let cumulative = 0;
  for (let i = 0; i < index; i++) cumulative += lengths[i];
  return cumulative / total;
}

function computeRouteProgress(routePoints, busPoint) {
  const lengths = segmentLengthsMeters(routePoints);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;

  let best = null;
  let cumulative = 0;
  for (let i = 0; i < routePoints.length - 1; i++) {
    const { fraction, distMeters } = projectOntoSegment(busPoint, routePoints[i], routePoints[i + 1]);
    if (!best || distMeters < best.distMeters) {
      best = { distMeters, progress: (cumulative + fraction * lengths[i]) / total };
    }
    cumulative += lengths[i];
  }
  return best;
}

// --- Live position lookup + per-departure matching ---
//
// Resolves the route once (Sjövik/Mjörn/Gråbo coordinates + every X3
// vehicle GPS fix currently in that bounding box), then each departure is
// matched to its own live fix by `detailsReference` - the same field name
// Västtrafik uses on both the departures endpoint (there: "the reference
// to the service journey") and the positions endpoint (there: "journey
// reference"), which is exactly the kind of shared identifier meant to
// link the two. This hasn't been confirmed against a live response from
// this environment (no credentials here - see the top-of-file note), so
// if `bus_location` never resolves after deploying this, check first
// whether `detailsReference` on a /positions result actually equals the
// one from /departures for the same trip.
async function resolveRoute(token) {
  const routePoints = [];
  for (const query of ROUTE_STOP_QUERIES) {
    routePoints.push(await resolveLocation(token, query));
  }
  // Mjörn is always index 1 in the base 3-point route (Sjövik/Mjörn/Gråbo);
  // if intermediate stops are ever added to ROUTE_STOP_QUERIES between
  // Sjövik and Mjörn (see the module-level NOTE), update this index too.
  const mjornFraction = fractionAtStop(routePoints, 1);

  const lats = routePoints.map((p) => p.lat);
  const lons = routePoints.map((p) => p.lon);
  const pad = 0.02; // ~2km buffer around the route so a bus just past either end is still caught

  const positions = await getPositions(token, {
    minLat: Math.min(...lats) - pad,
    maxLat: Math.max(...lats) + pad,
    minLon: Math.min(...lons) - pad,
    maxLon: Math.max(...lons) + pad,
    lineDesignations: [MJORN_LINE, GRABO_LINE], // both boards' buses can be in this box at once (they meet at Gråbo)
  });

  return { routePoints, mjornFraction, positions };
}

// Finds the live GPS fix for one specific departure (by detailsReference)
// and turns it into a human status line + 0..1 route progress, or a clear
// "not found"/"off route" explanation instead of silently showing nothing.
function describeDeparturePosition(route, departure) {
  if (!departure) return null;
  if (!route) {
    return { bus_name: null, location_text: "Position kunde inte beräknas.", progress: null };
  }
  if (!departure.details_reference) {
    return { bus_name: null, location_text: "Ingen positionsreferens för avgången.", progress: null };
  }

  const position = route.positions.find((p) => p.detailsReference === departure.details_reference);
  if (!position || typeof position.latitude !== "number" || typeof position.longitude !== "number") {
    return { bus_name: null, location_text: "Position okänd (bussen är inte på väg än).", progress: null };
  }

  const busName = position.name || position.line?.shortName || null;
  const { progress, distMeters } = computeRouteProgress(route.routePoints, {
    lat: position.latitude,
    lon: position.longitude,
  });

  if (distMeters > MAX_ROUTE_DEVIATION_METERS) {
    return { bus_name: busName, location_text: "Utanför Sjövik-Gråbo just nu.", progress: null };
  }

  const location_text =
    progress < route.mjornFraction
      ? `Mellan Sjövik och Mjörn (${Math.round(progress * 100)}%)`
      : `Mellan Mjörn och Gråbo (${Math.round(progress * 100)}%)`;

  return { bus_name: busName, location_text, progress };
}

// Best-effort extraction of "which line is this GPS fix for" from a
// /positions result - tried in a few different possible shapes since this
// is unverified against a live response (see resolveRoute()'s comment).
function positionLineDesignation(position) {
  if (!position) return null;
  if (typeof position.line === "string") return position.line;
  if (position.line && typeof position.line === "object") {
    return position.line.shortName ?? position.line.designation ?? position.line.name ?? null;
  }
  return null;
}

// Finds ANY live GPS fix for the given line, regardless of direction/route
// variant - unlike describeDeparturePosition() above (which requires an
// exact detailsReference match to one specific scheduled departure), this
// is used only for the "senast sedd" (last seen) fields, where the user
// explicitly wants a sighting even of a bus heading the "wrong" way (e.g.
// line 525 towards Brobacka/Sjövik instead of Gråbo) rather than showing
// "no position" just because it isn't the exact trip we're counting down.
function findAnyPositionForLine(positions, line) {
  return (
    positions.find((p) => {
      const designation = positionLineDesignation(p);
      if (designation != null && String(designation) === line) return true;
      // Fall back to the free-text name field, in case the line number
      // only shows up there (e.g. "525 mot Lerum") rather than in a
      // dedicated line field - same shape-uncertainty caveat as above.
      return typeof p.name === "string" && new RegExp(`(^|\\D)${line}(\\D|$)`).test(p.name);
    }) ?? null
  );
}

// Same human-status-line logic as describeDeparturePosition(), but keyed by
// line rather than by one specific departure - see findAnyPositionForLine().
function describeAnyLinePosition(route, line) {
  if (!route) return null;
  const position = findAnyPositionForLine(route.positions, line);
  if (!position || typeof position.latitude !== "number" || typeof position.longitude !== "number") {
    return null;
  }

  const busName = position.name || positionLineDesignation(position) || null;
  const { progress, distMeters } = computeRouteProgress(route.routePoints, {
    lat: position.latitude,
    lon: position.longitude,
  });

  if (distMeters > MAX_ROUTE_DEVIATION_METERS) {
    return { bus_name: busName, location_text: "Utanför Sjövik-Gråbo just nu.", progress: null };
  }

  const location_text =
    progress < route.mjornFraction
      ? `Mellan Sjövik och Mjörn (${Math.round(progress * 100)}%)`
      : `Mellan Mjörn och Gråbo (${Math.round(progress * 100)}%)`;

  return { bus_name: busName, location_text, progress };
}

// --- "Last seen" position (bottom-of-board section) ---
//
// The board above only shows a position when it can match the very NEXT
// scheduled departure to a live GPS fix right now (describeDeparturePosition
// above) - which is often null (bus not out yet, or between trips). The
// user wants a "denna buss sågs senast vid: <position> <time>" line that is
// ALWAYS populated, so this persists the most recent real sighting across
// fetches: reuses the same (already GPS-matched) result whenever this run
// found one, and otherwise carries forward whatever was published last time
// (fetched via fetchPreviousData() below) rather than going blank. Once a
// single sighting has ever been recorded, this field never reverts to
// "unknown" again - only ever replaced by a newer sighting.
//
// The caller passes whichever position result is best available - the
// exact-departure match from describeDeparturePosition() when it found
// one, otherwise the broader any-direction/any-route match from
// describeAnyLinePosition() (see main()) - so "last seen" is populated by
// ANY live sighting of that line's bus, not just one tied to the specific
// upcoming scheduled trip. See describeDeparturePosition()'s comment for
// the detailsReference-matching caveat, which applies to that first source.
function buildLastSeen(positionResult, previousLastSeen, nowIso) {
  if (positionResult && positionResult.bus_name) {
    return {
      bus_name: positionResult.bus_name,
      location_text: positionResult.location_text,
      seen_at: nowIso,
      seen_at_display: dateAndTime(nowIso),
    };
  }
  if (previousLastSeen && previousLastSeen.seen_at) {
    return previousLastSeen; // carry forward unchanged - still the most recent real sighting we have
  }
  return {
    bus_name: null,
    location_text: "Ingen position registrerad ännu.",
    seen_at: null,
    seen_at_display: "–",
  };
}

// Best-effort fetch of the currently-published data.json, used only to seed
// buildLastSeen()'s "carry forward" case above. Returns null on any failure
// (network error, first-ever deploy with nothing published yet, etc.) -
// buildLastSeen() already handles a null previous value gracefully.
async function fetchPreviousData(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Position-map PNG rendering ---
//
// IMPORTANT: plain 8-bit RGB output via a raw pixel buffer, same as
// weather-yr's generate-icons.mjs (see that file's renderIcon() comment) -
// NOT a palette/1-bit PNG, which TRMNL's rendering pipeline silently drops.
// This image must also stay a single lone <img> in the template - never a
// flex sibling of another <img> - per weather-yr's README.

const MAP_WIDTH = 480;
const MAP_HEIGHT = 56;
const MAP_MARGIN_X = 16;

function makeCanvas(width, height, bg) {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = bg[0];
    buf[i * 3 + 1] = bg[1];
    buf[i * 3 + 2] = bg[2];
  }
  return buf;
}

function setPixel(buf, width, height, x, y, color) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const i = (y * width + x) * 3;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
}

function fillRect(buf, width, height, x0, y0, x1, y1, color) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      setPixel(buf, width, height, x, y, color);
    }
  }
}

function fillCircle(buf, width, height, cx, cy, r, color) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) setPixel(buf, width, height, cx + x, cy + y, color);
    }
  }
}

// busFractions: array of 0..1 progress values (one per departure that has a
// live fix) - deduplicated/nulls-filtered by the caller. Each gets its own
// marker above the track; when two departures share the same physical bus,
// their fractions will coincide and the markers overlap (fine - it's the
// same bus).
async function renderPositionMap({ mjornFraction, busFractions }) {
  const white = [255, 255, 255];
  const black = [20, 20, 20];
  const gray = [150, 150, 150];
  const trackY = 38;
  const usableWidth = MAP_WIDTH - MAP_MARGIN_X * 2;

  const buf = makeCanvas(MAP_WIDTH, MAP_HEIGHT, white);

  fillRect(buf, MAP_WIDTH, MAP_HEIGHT, MAP_MARGIN_X, trackY - 2, MAP_WIDTH - MAP_MARGIN_X, trackY + 2, gray);

  // Sjövik (0), Mjörn (mjornFraction), Gråbo (1)
  for (const f of [0, mjornFraction, 1]) {
    const x = MAP_MARGIN_X + f * usableWidth;
    fillCircle(buf, MAP_WIDTH, MAP_HEIGHT, x, trackY, 6, black);
  }

  for (const busFraction of busFractions || []) {
    if (busFraction === null || !Number.isFinite(busFraction)) continue;
    const x = MAP_MARGIN_X + Math.max(0, Math.min(1, busFraction)) * usableWidth;
    fillRect(buf, MAP_WIDTH, MAP_HEIGHT, x - 1, 12, x + 1, trackY - 6, black); // connector tick
    fillCircle(buf, MAP_WIDTH, MAP_HEIGHT, x, 12, 9, black); // bus marker, drawn above the track
  }

  return sharp(buf, { raw: { width: MAP_WIDTH, height: MAP_HEIGHT, channels: 3 } }).png().toBuffer();
}

const LIVE_DATA_URL = "https://hikmek.github.io/trmnl_plugins/bus-grabo/data.json";
const MIN_INTERVAL_MINUTES = 8; // target ~10 min; a bit under to absorb GitHub Actions schedule jitter

async function main() {
  if (await shouldSkipFetch(LIVE_DATA_URL, MIN_INTERVAL_MINUTES)) {
    console.log(`Skipping bus-grabo fetch - last update was less than ${MIN_INTERVAL_MINUTES} min ago`);
    return;
  }

  const token = await getAccessToken();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Fetched once up front, used only to seed the "last seen" carry-forward
  // logic (buildLastSeen()) - a network failure here just means the
  // last-seen fields fall back to "no previous sighting" for this run
  // rather than crashing the whole fetch.
  const previousData = await fetchPreviousData(LIVE_DATA_URL);

  const [mjornRaw, graboRaw] = await Promise.all([
    getDepartures(token, MJORN_GID, MJORN_QUERY_LIMIT),
    getDepartures(token, GRABO_GID, GRABO_QUERY_LIMIT),
  ]);

  // [0] = ETD (the immediate next departure), [1] = the following scheduled
  // departure - both boards run roughly hourly, so this is "this hour" /
  // "next hour" in practice (see the user's requested ETD + next-departure
  // display format).
  const mjornUpcoming = nextDepartures(mjornRaw, nowMs, { line: MJORN_LINE, requireTowardsGrabo: true }, 2);
  const graboUpcoming = nextDepartures(graboRaw, nowMs, { line: GRABO_LINE, requireTowardsGrabo: false }, 2);
  const mjornNext = mjornUpcoming[0] ?? null;
  const graboNext = graboUpcoming[0] ?? null;
  const debugMjorn = debugRawDepartures(mjornRaw, nowMs);
  const debugGrabo = debugRawDepartures(graboRaw, nowMs);

  const [mjornIcon, graboIcon] = pickTwoDistinctIcons();

  // Route + live positions: resolved once, then matched per-departure below.
  // Wrapped here (not inside resolveRoute itself) so a failure still lets us
  // fall back to a sane mjornFraction for drawing the static map.
  let route = null;
  let mjornFraction = 0.5;
  try {
    route = await resolveRoute(token);
    mjornFraction = route.mjornFraction;
  } catch (err) {
    console.error("Route/position lookup failed - map will show stops only:", err);
  }

  const mjornPosition = describeDeparturePosition(route, mjornNext);
  const graboPosition = describeDeparturePosition(route, graboNext);

  // "Last seen" prefers the exact-departure match above, but falls back to
  // ANY live fix for that line - wrong direction, a different route
  // variant, whatever - rather than showing "no position" just because it
  // isn't the one specific trip mjornNext/graboNext refers to. See
  // describeAnyLinePosition()'s comment.
  const mjornAnyPosition = describeAnyLinePosition(route, MJORN_LINE);
  const graboAnyPosition = describeAnyLinePosition(route, GRABO_LINE);
  const mjornSeenNow = mjornPosition?.bus_name ? mjornPosition : mjornAnyPosition;
  const graboSeenNow = graboPosition?.bus_name ? graboPosition : graboAnyPosition;

  const mjornLastSeen = buildLastSeen(mjornSeenNow, previousData?.mjorn_to_grabo?.last_seen, nowIso);
  const graboLastSeen = buildLastSeen(graboSeenNow, previousData?.grabo_to_goteborg?.last_seen, nowIso);

  const mapPng = await renderPositionMap({
    mjornFraction,
    busFractions: [mjornPosition?.progress ?? null, graboPosition?.progress ?? null],
  });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(MAP_IMAGE_PATH, mapPng);

  const output = {
    plugin: "bus-grabo",
    generated_at: new Date().toISOString(),
    updated_display: formatUpdatedDisplay(nowMs),
    mjorn_to_grabo: {
      label: "Nästa buss från Mjörn mot Gråbo kommer om",
      stop_name: "Mjörn, Lerum",
      line: MJORN_LINE,
      icon_url: busIconUrl(mjornIcon),
      has_departure: !!mjornNext,
      minutes_until: mjornNext?.minutes_until ?? null,
      estimated_time: mjornNext?.estimated_time ?? null,
      // The following scheduled departure after the ETD above (both boards
      // run roughly hourly - see nextDepartures()). null if there isn't a
      // second one in the fetched window.
      next_departure_time: mjornUpcoming[1]?.estimated_time ?? null,
      delay_minutes: mjornNext?.delay_minutes ?? 0,
      is_cancelled: mjornNext?.is_cancelled ?? false,
      destination: mjornNext?.destination ?? null,
      bus_name: mjornPosition?.bus_name ?? null,
      bus_location: mjornNext ? mjornPosition?.location_text ?? "Position okänd." : null,
      // Always populated once any sighting has ever been made - see
      // buildLastSeen(). Bottom-of-board "denna buss sågs senast vid" line.
      last_seen: mjornLastSeen,
    },
    grabo_to_goteborg: {
      label: "Nästa buss från Gråbo busshållplats mot Göteborg kommer om",
      stop_name: "Mjörnbotorget (Gråbo busstation)",
      line: GRABO_LINE,
      via_note: "Line X3 stops at Polhemsplatsen, Göteborg (~10 min walk to Nils Ericson Terminalen)",
      icon_url: busIconUrl(graboIcon),
      has_departure: !!graboNext,
      minutes_until: graboNext?.minutes_until ?? null,
      estimated_time: graboNext?.estimated_time ?? null,
      next_departure_time: graboUpcoming[1]?.estimated_time ?? null,
      delay_minutes: graboNext?.delay_minutes ?? 0,
      is_cancelled: graboNext?.is_cancelled ?? false,
      destination: graboNext?.destination ?? null,
      bus_name: graboPosition?.bus_name ?? null,
      bus_location: graboNext ? graboPosition?.location_text ?? "Position okänd." : null,
      last_seen: graboLastSeen,
    },
    bus_position: {
      available: !!(mjornPosition?.progress != null || graboPosition?.progress != null),
      mjorn_fraction: mjornFraction,
      map_image_url: `${MAP_IMAGE_PUBLIC_URL}?v=${nowMs}`,
    },
    // Diagnostic only - see debugRawDepartures()'s comment. Not used by either template.
    debug_raw_departures: { mjorn: debugMjorn, grabo: debugGrabo },
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Wrote ${MAP_IMAGE_PATH}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
