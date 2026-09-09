// TRMNL Plugin #3: Bus departures near Gråbo (Västtrafik)
//
// Two departure boards:
//   1. "Mjörn, Lerum" stop-area - all departures (local shuttle line 525).
//   2. "Mjörnbotorget" (served by "Gråbo busstation", ~130m away) filtered
//      to line X3, which is the only line from Gråbo that runs via
//      Göteborg (Polhemsplatsen, ~10 min walk from Nils Ericson Terminalen)
//      on its way further south to Kullavik/Särö.
//
// Requires a Västtrafik API "Authentication Key" (base64 client_id:secret)
// from https://developer.vasttrafik.se/ (free), subscribed to "Planera
// Resa" v4, passed in via the VASTTRAFIK_AUTH_KEY environment variable /
// GitHub Actions secret. A fresh OAuth2 access token is requested on every
// run (client_credentials grant) - no token persistence needed.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "../../lib/http.mjs";
import { formatUpdatedDisplay } from "../../lib/format.mjs";
import { shouldSkipFetch } from "../../lib/throttle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = "https://ext-api.vasttrafik.se/pr/v4";
const TOKEN_URL = "https://ext-api.vasttrafik.se/token";

const MJORN_GID = "9021014017430000"; // "Mjörn, Lerum" stop-area
const GRABO_GID = "9021014017320000"; // "Gråbo busstation, Lerum" stop-area - serves Mjörnbotorget
const GOTEBORG_LINE_FILTER = "X3"; // the only line from Gråbo busstation that runs via Göteborg

const DEPARTURE_LIMIT = 8;
const OUTPUT_PATH = path.join(__dirname, "..", "..", "public", "bus-grabo", "data.json");

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
  };
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

  const mjornRaw = await getDepartures(token, MJORN_GID, DEPARTURE_LIMIT);
  const graboRaw = await getDepartures(token, GRABO_GID, 20);

  const mjorn = mjornRaw
    .map((d) => formatDeparture(d, nowMs))
    .filter((d) => d.minutes_until >= 0);

  const toGoteborg = graboRaw
    .filter((d) => d.serviceJourney?.line?.shortName === GOTEBORG_LINE_FILTER)
    .map((d) => formatDeparture(d, nowMs))
    .filter((d) => d.minutes_until >= 0)
    .slice(0, DEPARTURE_LIMIT);

  const output = {
    plugin: "bus-grabo",
    generated_at: new Date().toISOString(),
    updated_display: formatUpdatedDisplay(nowMs),
    mjorn: {
      stop_name: "Mjörn, Lerum",
      departures: mjorn,
    },
    mjornbotorget_to_goteborg: {
      stop_name: "Mjörnbotorget (Gråbo busstation)",
      via_note: "Line X3 stops at Polhemsplatsen, Göteborg (~10 min walk to Nils Ericson Terminalen)",
      line_filter: GOTEBORG_LINE_FILTER,
      departures: toGoteborg,
    },
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
