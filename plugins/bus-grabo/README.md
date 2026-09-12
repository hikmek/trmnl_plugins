# Plugin #3 - Bus Departures near Gråbo (Västtrafik)

TRMNL private plugin (Polling strategy) tracking a single physical route -
**line X3, Sjövik → Mjörn → Gråbo → Göteborg** - showing:

1. **Next bus from Mjörn towards Gråbo** - a single countdown, not a list.
   Mjörn is also served by local shuttle **line 525** towards Lerum/Sjövik
   (the opposite direction - it never reaches Gråbo), so this board filters
   to line X3 *and* excludes anything whose destination names Sjövik, to
   keep only the Gråbo-bound direction.
2. **Next bus from Gråbo busshållplats towards Göteborg** - same idea, at
   the stop that actually serves Mjörnbotorget square in Gråbo, which is
   **"Gråbo busstation"** (~130m away; there's no stop literally named
   "Mjörnbotorget"). Filtered to line X3, the only line from there that
   runs via Göteborg (it stops at Polhemsplatsen, ~10 min walk from Nils
   Ericson Terminalen) on its way further south to Kullavik/Särö.
3. **Live position map** - where that same X3 bus currently is along the
   Sjövik–Mjörn–Gråbo stretch, using real GPS (see below).

- Data source: [Västtrafik "Planera Resa" API v4](https://developer.vasttrafik.se/)
- Requires a **free** Västtrafik developer account + API credentials
  (unlike the weather/lunch plugins, this one needs an API key).

## Post-mortem: "no departures" after the position-map update

The single-next-bus rename + live position map (this plugin's second
major version) shipped with a real bug: `fetch.mjs` started importing
`sharp` (for the position-map PNG) at *fetch time*, but the shared
workflow (`.github/workflows/build-pages.yml`) never ran `npm install`/
`npm ci` - none of the other plugins' `fetch.mjs` scripts need any npm
package at runtime (only the icon-generator scripts, which are run by
hand, ever imported `sharp` before). So every run threw
`Cannot find package 'sharp'` immediately - but because every fetch step
uses `continue-on-error: true` (by design, so one plugin's outage doesn't
block the others), the step still showed green, no new `data.json` was
written, and the "Fall back to last published data" step just re-curled
the previous (pre-update, old-schema) `data.json` every cycle. End result:
Actions looked 100% healthy while silently serving stale data with the
old field names - which the new template then rendered as "Ingen avgång
just nu" for both boards, since it was reading fields
(`mjorn_to_grabo.has_departure` etc.) that didn't exist in that stale
JSON. Fixed by adding an `npm ci` step before the fetch steps - see that
step's comment in the workflow file. If a future plugin update adds
another npm dependency, remember this same install step now covers it too
(no per-plugin install needed).

## How it works

1. `.github/workflows/build-pages.yml` runs `fetch.mjs` every 30 minutes
   (same shared workflow as the other plugins).
2. `fetch.mjs` requests a fresh OAuth2 access token (client_credentials
   grant) using the `VASTTRAFIK_AUTH_KEY` secret, then:
   - calls `/stop-areas/{gid}/departures` for both stops and picks the
     single next X3 departure at each (see `nextDeparture()`);
   - resolves Sjövik/Mjörn/Gråbo to coordinates via `/locations/by-text`
     and calls `/positions` once (bounding box + `lineDesignations=X3`) for
     every X3 vehicle GPS fix currently in that area (see `resolveRoute()`);
   - matches *each* departure to its own live fix by `detailsReference`
     (see `describeDeparturePosition()`), producing a `bus_name` + human
     `bus_location` string per departure - not just one overall position;
   - projects each matched fix onto the Sjövik→Mjörn→Gråbo line to get a
     0..1 "how far along the route" progress, and renders every matched
     departure's position as its own marker on one small PNG
     (`position-map.png`) - see `renderPositionMap()`.
3. Writes `public/bus-grabo/data.json` and `public/bus-grabo/position-map.png`.
4. GitHub Pages publishes both at `https://hikmek.github.io/trmnl_plugins/bus-grabo/`.
5. Your TRMNL device (Private Plugin, Polling strategy) fetches the JSON
   and renders it with `template.liquid` (Full) / `template.quadrant.liquid`
   (Mashup pane - text only, no map image, see that file's comment).

## The live position map, and why it's real GPS (not a schedule guess)

The first thing checked here was Trafiklab's public GTFS-Realtime mirror
(`vehiclepositions.pb`), since that's the standard place to get live bus
GPS in Sweden - but Trafiklab's own coverage table explicitly lists
**Västtrafik as static-schedule-data-only** there, no real-time positions.
That looked like a dead end for "where is the bus right now".

However, Västtrafik's *own* "Planera Resa" v4 API - the same one already
used here for departures, with the same `VASTTRAFIK_AUTH_KEY` credentials -
has an undocumented-on-the-portal-but-present-in-the-API `GET /positions`
endpoint: pass a lat/long bounding box and (optionally) `lineDesignations`,
get back real-time `{ latitude, longitude, name, line, direction, detailsReference }`
for every matching vehicle currently running. That's genuine GPS, not an
estimate from the timetable - confirmed via the API's own OpenAPI/swagger
model docs. `resolveRoute()` calls it with a box drawn tightly around
Sjövik/Mjörn/Gråbo (padded ~2km) and `lineDesignations: ["X3"]`, so it
should only ever pick up vehicles relevant to this route (or none, if no
X3 is currently running that stretch, e.g. off-hours).

Each departure is then matched to its own fix in that result set by
`detailsReference` (`describeDeparturePosition()`) - the same field name
Västtrafik uses for "the reference to the service journey" on the
departures endpoint and "journey reference" on the positions endpoint,
which is exactly the kind of shared id meant to link the two. **This
specific assumption hasn't been confirmed against a live response** (no
Västtrafik credentials were available in the sandbox this was built in) -
if `bus_location` always comes back "Position okänd" after deploying this,
that match is the first thing to check (log a raw `/positions` result and
a raw departure's `detailsReference` side by side).

**Known gap:** the map currently only plots the 3 confirmed endpoints
(Sjövik / Mjörn / Gråbo) - the user's original ask was for "the 5 stops
from Sjövik before Mjörn". Those exact intermediate stop names couldn't be
verified from the sandbox this was built in (no live Västtrafik credentials
available there, and public route-order sources for this specific stretch
were inconsistent). If you give the 5 names in order, they drop straight
into `ROUTE_STOP_QUERIES` in `fetch.mjs` (each is resolved to coordinates
automatically via `/locations/by-text` - no manual lat/long lookup needed)
and `renderPositionMap()`'s marker loop extends to plot all of them.

**Also unverified (first live run will tell):** the exact field names in
`/positions`'s response, and whether Mjörn-direction filtering by "doesn't
mention Sjövik in the destination text" correctly isolates the Gråbo-bound
X3 departures. Check the Actions log / a manual `node fetch.mjs` run after
first deploying this - if `bus_position.available` is always `false` or
`mjorn_to_grabo` never finds a departure, that's the place to look first.

## One-time setup

### 1. Get Västtrafik API credentials (if not already done)

1. Sign up (free) at https://developer.vasttrafik.se/
2. Create an application, subscribe it to **"Planera Resa" v4**
3. Copy the **Authentication Key** (a base64 string, e.g.
   `bXlDbGllbnRJZDpteUNsaWVudFNlY3JldA==`) - this is your
   `client_id:client_secret` combined

### 2. Add it as a GitHub Actions secret

```powershell
gh secret set VASTTRAFIK_AUTH_KEY --repo hikmek/trmnl_plugins
```
(paste the key when prompted - it's write-only, nobody can read it back
afterwards, including via the GitHub UI/API)

### 3. Set up the TRMNL Private Plugin

On [usetrmnl.com](https://usetrmnl.com), create another **Private Plugin**:

- Strategy: **Polling**
- Polling URL: `https://hikmek.github.io/trmnl_plugins/bus-grabo/data.json`
- Polling Verb: `GET`
- Refresh rate: 5-15 min (bus departures change faster than weather/lunch -
  consider lowering the workflow's cron interval too if you want tighter
  real-time accuracy)
- Markup (Full tab): paste `template.liquid`
- Markup (Quadrant tab): paste `template.quadrant.liquid`

## Markup style: plain lines, not a table

Both templates deliberately avoid TRMNL's `table` component and use one
`<div class="label">` per line instead - for headers and countdowns alike.
TRMNL maps the "label" component to a single pixel font (NicoClean /
TRMNL16, whichever bundle is active) at one fixed size on real e-ink
devices, so reusing it everywhere guarantees identical, pixelated text
throughout instead of mixing table header/cell fonts with value fonts of
different sizes. The one exception is the position-map `<img>` in
`template.liquid`, which per weather-yr's hard-won lesson (see that
plugin's README) must be a single lone `<img>` - never a flex sibling of
another `<img>` - so it gets its own row, separate from the text rows.

## Data schema (`data.json`)

```jsonc
{
  "plugin": "bus-grabo",
  "generated_at": "2026-09-12T19:16:09.528Z",
  "updated_display": "Data uppdaterad kl 21:16 idag",
  "mjorn_to_grabo": {
    "label": "Nästa buss från Mjörn mot Gråbo kommer om",
    "stop_name": "Mjörn, Lerum",
    "line": "X3",
    "has_departure": true,
    "minutes_until": 11,
    "estimated_time": "19:27",
    "delay_minutes": 0,
    "is_cancelled": false,
    "destination": "Göteborg",
    "bus_name": "X3 mot Särö",              // from /positions' "name" field, or null if no live fix matched
    "bus_location": "Mellan Sjövik och Mjörn (31%)"
  },
  "grabo_to_goteborg": {
    "label": "Nästa buss från Gråbo busshållplats mot Göteborg kommer om",
    "stop_name": "Mjörnbotorget (Gråbo busstation)",
    "line": "X3",
    "via_note": "Line X3 stops at Polhemsplatsen, Göteborg (~10 min walk to Nils Ericson Terminalen)",
    "has_departure": true,
    "minutes_until": 26,
    "estimated_time": "19:42",
    "delay_minutes": 0,
    "is_cancelled": false,
    "destination": "Särö",
    "bus_name": null,
    "bus_location": "Position okänd (bussen är inte på väg än)."
  },
  "bus_position": {
    "available": true,          // true if at least one of the two departures above has a live fix
    "mjorn_fraction": 0.42,     // where Mjörn sits along the Sjövik(0)->Gråbo(1) line, for drawing the map
    "map_image_url": "https://hikmek.github.io/trmnl_plugins/bus-grabo/position-map.png?v=1757700000000"
  }
}
```

`bus_location` (per departure) is always a human-readable string, never
null while `has_departure` is true - it explains what happened even when
there's no usable fix: `"Position okänd (bussen är inte på väg än)."` (no
live fix matched that `detailsReference` yet), `"Utanför Sjövik-Gråbo just
nu."` (matched, but implausibly far from the route - GPS noise or a
mismatch), or `"Position kunde inte beräknas."` (the route/positions
lookup itself failed - see `resolveRoute()`'s try/catch in `main()`). The
map image always renders regardless - worst case, just the three stops
with no bus markers.

## Local test

```powershell
$env:VASTTRAFIK_AUTH_KEY = "your-base64-key"
node plugins/bus-grabo/fetch.mjs
Remove-Item Env:\VASTTRAFIK_AUTH_KEY
```

This is also the fastest way to check the two "unverified" items noted
above - the script logs the full `data.json` contents to the console.

## Known limitations / maintenance

- **Stop IDs are hardcoded** (`MJORN_GID`, `GRABO_GID` constants in
  `fetch.mjs`). They're Västtrafik-internal IDs and stable, but if a stop is
  ever renamed/rebuilt, re-look-up via:
  `GET /pr/v4/locations/by-text?q=<name>` (Bearer token required). The
  three route-map points (`ROUTE_STOP_QUERIES`) are resolved by *name* at
  every fetch instead, so they don't need re-hardcoding if a stop moves.
- **Line X3 is hardcoded** as "the line that runs Sjövik → Mjörn → Gråbo →
  Göteborg". If Västtrafik changes the route network in the future, verify
  with a direct journey search:
  `GET /pr/v4/journeys?originGid=<GRABO_GID>&destinationGid=9021014004940000&onlyDirectConnections=true`
  (destination gid is Nils Ericson Terminalen, Göteborg).
- **`/positions` and `/locations/by-text` are undocumented on Västtrafik's
  public developer portal pages** (found via the v4 API's own OpenAPI
  schema instead) - if Västtrafik ever changes their shape without notice,
  `resolveRoute()` is called inside a try/catch in `main()` that falls back
  to a plain stops-only map (no bus markers, `bus_location: "Position
  kunde inte beräknas."`) rather than failing the whole fetch, so
  departures keep working even if the position feature breaks.
- **Any npm dependency `fetch.mjs` imports must actually get installed in
  CI** - see the "Post-mortem" section above. The workflow's `npm ci` step
  covers this repo-wide now, but it's worth remembering if this plugin (or
  a new one) ever adds another package.
- The Västtrafik access token is valid 24h, but since this runs fresh in
  GitHub Actions each time, a new token is requested on every run - no
  caching/refresh logic needed.
- `MJORN_QUERY_LIMIT` / `GRABO_QUERY_LIMIT` (20) control how many raw
  departures are fetched per stop before filtering down to the single next
  X3 one - Mjörn especially needs a generous limit since it's dominated by
  the more frequent local line 525.
