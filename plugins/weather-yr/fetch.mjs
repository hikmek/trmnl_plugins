// TRMNL Plugin #1: Weather (yr.no / MET Norway)
// Fetches a forecast for Alsjön (Alsjö kärrväg 7, Lerum, Sweden) and writes a
// small JSON file that GitHub Pages serves. TRMNL polls that JSON URL and
// renders it using the Liquid template in template.liquid.
//
// Data source: MET Norway Locationforecast 2.0 (api.met.no), free, no API key,
// but requires an identifying User-Agent per their terms of service:
// https://api.met.no/doc/TermsOfService

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "../../lib/http.mjs";
import { formatUpdatedDisplay } from "../../lib/format.mjs";
import { shouldSkipFetch } from "../../lib/throttle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCATION = {
  name: "Alsjön (Alsjö kärrväg 7)",
  municipality: "Lerum, Sverige",
  lat: 57.8626,
  lon: 12.3025,
};

const TIMEZONE = "Europe/Stockholm";
const FORECAST_DAYS = 5; // today + next 4 days
const OUTPUT_PATH = path.join(__dirname, "..", "..", "public", "weather-yr", "data.json");

const USER_AGENT = "trmnl-plugins-hikmek/1.0 github.com/hikmek/trmnl_plugins";
const ICON_BASE_URL = "https://hikmek.github.io/trmnl_plugins/weather-yr/icons";

// --- Multi-source current temperature -------------------------------------
// current.temperature is the AVERAGE of whichever of these sources
// actually respond (yr.no's own reading is always included - it's already
// fetched for the icon/wind/humidity data below). Each extra source is
// independently non-fatal: if it fails or times out, it's just left out of
// the average rather than blocking the whole plugin (same pattern as
// lunch-lerum's hemmamat fetch).
//
// SMHI note: their old "pmp3g" point-forecast API (the one almost every
// SMHI integration/tutorial online references) was deprecated 2026-03-31.
// This uses their replacement "snow1g" API, but also defensively parses
// the old pmp3g response shape (a `parameters` array per timeSeries entry)
// in case a cached/alternate endpoint still returns it - see
// fetchSmhiTemperature() below.
//
// klart.se has no documented public API (it's a consumer app/site), so
// Open-Meteo (free, no key, well-documented) is used as the third source
// instead.
async function fetchSmhiTemperature(lat, lon) {
  try {
    const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json`;
    const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } }, { retries: 2 });
    if (!res.ok) throw new Error(`SMHI request failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    const entry = json.timeSeries?.[0];
    if (!entry) return null;
    // New (snow1g) shape: entry.data.air_temperature
    if (entry.data && typeof entry.data.air_temperature === "number") {
      return entry.data.air_temperature;
    }
    // Defensive fallback for the old (pmp3g) shape: entry.parameters is an
    // array of { name, values }.
    const param = entry.parameters?.find((p) => p.name === "t");
    if (param && typeof param.values?.[0] === "number") {
      return param.values[0];
    }
    return null;
  } catch (err) {
    console.error(`Could not fetch SMHI temperature - skipping: ${err.message}`);
    return null;
  }
}

async function fetchOpenMeteoTemperature(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=Europe%2FStockholm`;
    const res = await fetchWithRetry(url, {}, { retries: 2 });
    if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    const t = json.current?.temperature_2m;
    return typeof t === "number" ? t : null;
  } catch (err) {
    console.error(`Could not fetch Open-Meteo temperature - skipping: ${err.message}`);
    return null;
  }
}

// --- Pixelated clothing proposal --------------------------------------------
// Picks one outfit icon from the (averaged) current temperature, plus an
// extra rain-gear icon when rain is expected regardless of temperature.
const CLOTHING_BANDS = [
  { min: 20, slug: "shorts-tshirt", text: "T-shirt & shorts" },
  { min: 12, slug: "tshirt-jacket", text: "T-shirt & tunn jacka" },
  { min: 5, slug: "jacket", text: "Jacka" },
  { min: 0, slug: "warm-jacket", text: "Varm jacka & mössa" },
  { min: -Infinity, slug: "winter-coat", text: "Vinterjacka, mössa & vantar" },
];

function clothingForTemperature(tempC) {
  return CLOTHING_BANDS.find((b) => tempC >= b.min) || CLOTHING_BANDS[CLOTHING_BANDS.length - 1];
}

function clothingIconUrl(slug) {
  return `${ICON_BASE_URL}/clothing-${slug}.png`;
}

// Rain gear is proposed both when yr.no already has a nonzero precipitation
// amount for the coming hour AND as a fallback when the symbol code itself
// says rain/sleet/thunder (the precipitation_amount field is sometimes 0
// even on a "rain" symbol if the shower hasn't started within the next
// timestep yet).
function expectsRain(symbolCode, precipMm) {
  if (typeof precipMm === "number" && precipMm > 0) return true;
  if (!symbolCode) return false;
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "").replace(/^(light|heavy|lights)/, "");
  return /rain|sleet|thunder/.test(base);
}

// Buckets a yr.no symbol_code (e.g. "lightrainshowersandthunder_day") into
// one of the pixel-art icons generated by generate-icons.mjs.
function iconForCode(code) {
  if (!code) return "cloudy";
  const base = code
    .replace(/_(day|night|polartwilight)$/, "")
    .replace(/^(light|heavy|lights)/, "");
  if (/thunder/.test(base)) return "thunder";
  if (/snow/.test(base)) return "snow";
  if (/sleet|rain/.test(base)) return "rain";
  if (/fog/.test(base)) return "fog";
  if (/^partlycloudy/.test(base)) return "partly-cloudy";
  if (/^cloudy/.test(base)) return "cloudy";
  if (/^(clearsky|fair)/.test(base)) return "sun";
  return "cloudy";
}

function iconUrl(code) {
  return `${ICON_BASE_URL}/${iconForCode(code)}.png`;
}

async function loadSymbolMap() {
  const raw = await import("node:fs/promises").then((fs) =>
    fs.readFile(path.join(__dirname, "symbol_map.json"), "utf8")
  );
  return JSON.parse(raw);
}

function localDateKey(isoTime) {
  // en-CA gives YYYY-MM-DD which sorts/groups nicely.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoTime));
}

function localHour(isoTime) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(isoTime))
  );
}

function dayName(dateKey, todayKey) {
  if (dateKey === todayKey) return "Idag";
  const d = new Date(`${dateKey}T12:00:00`);
  const sv = new Intl.DateTimeFormat("sv-SE", { weekday: "short" }).format(d);
  // sv-SE gives lowercase abbreviations (e.g. "mån", "tis") - capitalize
  return sv.charAt(0).toUpperCase() + sv.slice(1);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function fetchForecast() {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${LOCATION.lat}&lon=${LOCATION.lon}`;
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`yr.no request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function pickSymbol(entry) {
  const d = entry.data;
  return (
    d.next_1_hours?.summary?.symbol_code ||
    d.next_6_hours?.summary?.symbol_code ||
    d.next_12_hours?.summary?.symbol_code ||
    null
  );
}

function pickPrecip(entry) {
  const d = entry.data;
  return (
    d.next_1_hours?.details?.precipitation_amount ??
    d.next_6_hours?.details?.precipitation_amount ??
    null
  );
}

const LIVE_DATA_URL = "https://hikmek.github.io/trmnl_plugins/weather-yr/data.json";
const MIN_INTERVAL_MINUTES = 25; // target ~30 min; a bit under to absorb GitHub Actions schedule jitter

async function main() {
  if (await shouldSkipFetch(LIVE_DATA_URL, MIN_INTERVAL_MINUTES)) {
    console.log(`Skipping weather-yr fetch - last update was less than ${MIN_INTERVAL_MINUTES} min ago`);
    return;
  }

  const symbolMap = await loadSymbolMap();
  const readable = (code) =>
    (code && symbolMap[code]) || (code ? code.replace(/_/g, " ") : "Okänt");

  const json = await fetchForecast();
  const timeseries = json.properties.timeseries;

  const todayKey = localDateKey(new Date().toISOString());

  // --- current conditions: first timeseries entry ---
  const nowEntry = timeseries[0];
  const nowDetails = nowEntry.data.instant.details;
  const nowSymbol = pickSymbol(nowEntry);
  const nowPrecip = pickPrecip(nowEntry);

  // --- average current temperature across yr.no + SMHI + Open-Meteo -----
  // yr.no's reading is always included (already fetched above); the other
  // two are fetched in parallel and are each independently optional - if
  // one fails, the average just uses however many succeeded.
  const [smhiTemp, openMeteoTemp] = await Promise.all([
    fetchSmhiTemperature(LOCATION.lat, LOCATION.lon),
    fetchOpenMeteoTemperature(LOCATION.lat, LOCATION.lon),
  ]);

  const temperatureReadings = [
    { source: "yr.no", value: nowDetails.air_temperature },
    { source: "smhi", value: smhiTemp },
    { source: "open-meteo", value: openMeteoTemp },
  ].filter((r) => typeof r.value === "number" && Number.isFinite(r.value));

  const averagedTemperature = round1(
    temperatureReadings.reduce((sum, r) => sum + r.value, 0) / temperatureReadings.length
  );

  const clothing = clothingForTemperature(averagedTemperature);
  const needsRainGear = expectsRain(nowSymbol, nowPrecip);

  const current = {
    temperature: averagedTemperature,
    temperature_sources: Object.fromEntries(temperatureReadings.map((r) => [r.source, round1(r.value)])),
    condition_code: nowSymbol,
    condition_text: readable(nowSymbol),
    icon: iconForCode(nowSymbol),
    icon_url: iconUrl(nowSymbol),
    wind_speed: round1(nowDetails.wind_speed),
    humidity: Math.round(nowDetails.relative_humidity),
    precipitation_next_hour: nowPrecip,
    clothing_icon: clothing.slug,
    clothing_icon_url: clothingIconUrl(clothing.slug),
    clothing_text: clothing.text,
    needs_rain_gear: needsRainGear,
    rain_gear_icon_url: `${ICON_BASE_URL}/clothing-umbrella.png`,
  };

  // --- group entries by local calendar day ---
  const byDay = new Map();
  for (const entry of timeseries) {
    const key = localDateKey(entry.time);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
  }

  const dayKeys = [...byDay.keys()].sort().slice(0, FORECAST_DAYS);

  const forecast = dayKeys.map((key) => {
    const entries = byDay.get(key);
    const temps = entries
      .map((e) => e.data.instant.details.air_temperature)
      .filter((t) => typeof t === "number");
    const high = round1(Math.max(...temps));
    const low = round1(Math.min(...temps));

    // Representative symbol: entry closest to local noon (among entries that
    // actually have a symbol). Far-future days only have 6-hourly UTC steps
    // (00/06/12/18), which rarely land exactly on local noon, so pick the
    // nearest one rather than requiring an exact match.
    const withSymbol = entries.filter((e) => pickSymbol(e));
    const candidates = withSymbol.length ? withSymbol : entries;
    let repEntry = candidates[0];
    let bestDiff = Math.abs(localHour(repEntry.time) - 12);
    for (const e of candidates) {
      const diff = Math.abs(localHour(e.time) - 12);
      if (diff < bestDiff) {
        bestDiff = diff;
        repEntry = e;
      }
    }
    const symbol = pickSymbol(repEntry);

    const precipTotal = entries.reduce((sum, e) => {
      const p = pickPrecip(e);
      return sum + (typeof p === "number" ? p : 0);
    }, 0);

    return {
      date: key,
      day_name: dayName(key, todayKey),
      high,
      low,
      condition_code: symbol,
      condition_text: readable(symbol),
      icon: iconForCode(symbol),
      icon_url: iconUrl(symbol),
      precipitation_mm: round1(precipTotal),
    };
  });

  const today = forecast.find((d) => d.date === todayKey) || forecast[0];
  const nowMs = Date.now();

  const output = {
    plugin: "weather-yr",
    generated_at: new Date().toISOString(),
    updated_display: formatUpdatedDisplay(nowMs, TIMEZONE),
    location: LOCATION,
    current,
    today: { high: today.high, low: today.low },
    forecast,
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
