// TRMNL Plugin #3: Bus departures near Gråbo (Västtrafik)
//
// Tracks a single physical route: line X3, Sjövik -> Mjörn -> Gråbo ->
// Göteborg. Two single-line "next bus" countdowns are two vantage points
// on that same route:
//   1. "Mjörn, Lerum" stop-area, filtered to line X3 towards Gråbo/Göteborg
//      (Mjörn is also served by local shuttle line 525 towards Lerum/
//      Sjövik - that line is NOT what's shown here, it never reaches Gråbo).
//   2. "Gråbo busstation" stop-area (serves Mjörnbotorget square, ~130m
//      away - there's no stop literally named "Mjörnbotorget"), filtered
//      to line X3 towards Göteborg (it stops at Polhemsplatsen, ~10 min
//      walk from Nils Ericson Terminalen, on its way further south to
//      Kullavik/Särö).
//
// Also computes, for EACH of the two departures above, a live "where is
// this specific bus right now" position along the Sjövik -> Mjörn -> Gråbo
// stretch, using Västtrafik's own real-time vehicle-position endpoint
// (GET /positions?lowerLeftLat=...&lineDesignations=X3 - a bounding-box
// query, undocumented in the public developer portal pages but present in
// the v4 API's OpenAPI schema and backed by the same OAuth credentials as
// everything else here). This is genuine GPS, not a schedule estimate -
// confirmed via the API's own swagger model docs (JourneyPositionApiModel:
// latitude/longitude/name/line/direction/detailsReference), unlike
// Trafiklab's public GTFS-Realtime mirror, which explicitly does NOT carry
// real-time vehicle positions for Västtrafik (static schedule data only,
// per Trafiklab's own coverage table) - that mirror was the first thing
// checked and is a dead end for this operator; the operator's own "Planera
// Resa" v4 API is the one that actually has it. Each departure is matched
// to its own live fix by `detailsReference` (see describeDeparturePosition()).
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
const LINE_FILTER = "X3"; // the only line that runs Sjövik -> Mjörn -> Gråbo -> Göteborg

// Extra stop-area queries for a richer map, once known (see NOTE above) -
// insert names in order between "Sjövik busstation, Lerum" and
// "Mjörn, Lerum" in ROUTE_STOP_QUERIES further down.
const ROUTE_STOP_QUERIES = ["Sjövik busstation, Lerum", "Mjörn, Lerum", "Gråbo busstation, Lerum"];

const MJORN_QUERY_LIMIT = 20; // Mjörn's board is dominated by frequent local line 525 - ask for
// more results than the old flat DEPARTURE_LIMIT so an X3 departure isn't missed further down the list.
const GRABO_QUERY_LIMIT = 20;
const MAX_ROUTE_DEVIATION_METERS = 1500; // beyond this, treat the bus as "not on this stretch right now"

const OUTPUT_DIR = path.join(__dirname, "..", "..", "public", "bus-grabo");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "data.json");
const MAP_IMAGE_FILENAME = "position-map.png";
const MAP_IMAGE_PATH = path.join(OUTPUT_DIR, MAP_IMAGE_FILENAME);
const MAP_IMAGE_PUBLIC_URL = `https://hikmek.github.io/trmnl_plugins/bus-grabo/${MAP_IMAGE_FILENAME}`;

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

// Mjörn is served by both line X3 (towards Gråbo/Göteborg) and local
// shuttle line 525 (towards Lerum/Sjövik - the opposite direction, never
// reaches Gråbo). Line-filtering to X3 already excludes 525, but X3 itself
// passes Mjörn in both directions (inbound from Göteborg towards Sjövik
// too) - exclude anything whose destination text names Sjövik to keep only
// the Gråbo-bound direction.
function isTowardsGrabo(raw) {
  const dest = (raw.serviceJourney?.directionDetails?.shortDirection ?? raw.serviceJourney?.direction ?? "").toLowerCase();
  return !dest.includes("sjövik") && !dest.includes("sjovik");
}

function nextDeparture(rawDepartures, nowMs, { requireTowardsGrabo }) {
  return (
    rawDepartures
      .filter((d) => d.serviceJourney?.line?.shortName === LINE_FILTER)
      .filter((d) => !requireTowardsGrabo || isTowardsGrabo(d))
      .map((d) => formatDeparture(d, nowMs))
      .filter((d) => d.minutes_until >= 0)
      .sort((a, b) => a.minutes_until - b.minutes_until)[0] ?? null
  );
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
    lineDesignations: [LINE_FILTER],
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

  const [mjornRaw, graboRaw] = await Promise.all([
    getDepartures(token, MJORN_GID, MJORN_QUERY_LIMIT),
    getDepartures(token, GRABO_GID, GRABO_QUERY_LIMIT),
  ]);

  const mjornNext = nextDeparture(mjornRaw, nowMs, { requireTowardsGrabo: true });
  const graboNext = nextDeparture(graboRaw, nowMs, { requireTowardsGrabo: false });

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
      line: LINE_FILTER,
      has_departure: !!mjornNext,
      minutes_until: mjornNext?.minutes_until ?? null,
      estimated_time: mjornNext?.estimated_time ?? null,
      delay_minutes: mjornNext?.delay_minutes ?? 0,
      is_cancelled: mjornNext?.is_cancelled ?? false,
      destination: mjornNext?.destination ?? null,
      bus_name: mjornPosition?.bus_name ?? null,
      bus_location: mjornNext ? mjornPosition?.location_text ?? "Position okänd." : null,
    },
    grabo_to_goteborg: {
      label: "Nästa buss från Gråbo busshållplats mot Göteborg kommer om",
      stop_name: "Mjörnbotorget (Gråbo busstation)",
      line: LINE_FILTER,
      via_note: "Line X3 stops at Polhemsplatsen, Göteborg (~10 min walk to Nils Ericson Terminalen)",
      has_departure: !!graboNext,
      minutes_until: graboNext?.minutes_until ?? null,
      estimated_time: graboNext?.estimated_time ?? null,
      delay_minutes: graboNext?.delay_minutes ?? 0,
      is_cancelled: graboNext?.is_cancelled ?? false,
      destination: graboNext?.destination ?? null,
      bus_name: graboPosition?.bus_name ?? null,
      bus_location: graboNext ? graboPosition?.location_text ?? "Position okänd." : null,
    },
    bus_position: {
      available: !!(mjornPosition?.progress != null || graboPosition?.progress != null),
      mjorn_fraction: mjornFraction,
      map_image_url: `${MAP_IMAGE_PUBLIC_URL}?v=${nowMs}`,
    },
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
