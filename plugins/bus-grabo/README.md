# Plugin #3 - Bus Departures near Gråbo (Västtrafik)

TRMNL private plugin (Polling strategy) showing:

1. **Next bus from Mjörn towards Gråbo** - a single countdown, not a list.
   This is **line 525** (Brobacka → Sjövik → Mjörn → Gråbo → Lerum), filtered
   to exclude the away-from-Gråbo direction (destination Sjövik/Brobacka),
   keeping only the Gråbo/Lerum-bound trips.
2. **Next bus from Gråbo busshållplats towards Göteborg** - a *different,
   unrelated* line, **X3** (Gråbo → Göteborg → Kullavik/Särö), at the stop
   that actually serves Mjörnbotorget square in Gråbo, which is
   **"Gråbo busstation"** (~130m away; there's no stop literally named
   "Mjörnbotorget").
3. **Live position map** - where each of those two buses currently is,
   using real GPS (see below). The two boards are **not the same physical
   bus** - line 525 terminates in Lerum and line X3 starts fresh at Gråbo,
   they only meet at the Gråbo stop where a rider would change buses.

- Data source: [Västtrafik "Planera Resa" API v4](https://developer.vasttrafik.se/)
- Requires a **free** Västtrafik developer account + API credentials
  (unlike the weather/lunch plugins, this one needs an API key).

## Line correction: it's 525, not X3, that connects Mjörn to Gråbo

Earlier versions of this plugin assumed a single physical route on line X3
ran Sjövik → Mjörn → Gråbo → Göteborg, and described line 525 (which
actually stops at Mjörn) as "the local shuttle that never reaches Gråbo -
not what's shown here". That was backwards. Confirmed via Västtrafik's own
line 525 timetable and its OSM route relation ("Buss 525: Brobacka - Sjövik
- Gråbo - Lerum"): **line 525 is the one that runs Sjövik → Mjörn → Gråbo →
Lerum**. Line X3 never stops at Mjörn at all - it's a separate express line
that only covers Gråbo → Göteborg (and on to Kullavik/Särö).

This was caught via a live user report ("Västtrafik shows a departure at
22:57, the plugin says no info") plus the `debug_raw_departures` diagnostic
field added the previous version: `debug_all_x3.mjorn` (as it was called
then) came back completely empty on every single run, because it was
listing X3 departures at a stop X3 never serves - the very definition of
filtering for the wrong line. `nextDeparture()` and `resolveRoute()`'s
`/positions` call now use `MJORN_LINE = "525"` for the Mjörn board and
`GRABO_LINE = "X3"` for the Gråbo board, kept as two separate constants
specifically so they can never silently drift back to being "the same
line" again.

## Post-mortem: "no departures" after the position-map update

(Kept for history - already fixed, unrelated to the line-number bug above.)
The single-next-bus rename + live position map (this plugin's second major
version) shipped with a real bug: `fetch.mjs` started importing `sharp`
(for the position-map PNG) at *fetch time*, but the shared workflow
(`.github/workflows/build-pages.yml`) never ran `npm install`/`npm ci` -
none of the other plugins' `fetch.mjs` scripts need any npm package at
runtime. So every run threw `Cannot find package 'sharp'` immediately -
but because every fetch step uses `continue-on-error: true` (by design, so
one plugin's outage doesn't block the others), the step still showed
green, no new `data.json` was written, and the "Fall back to last
published data" step just re-curled the previous (stale) `data.json` every
cycle. Fixed by adding an `npm ci` step before the fetch steps.

## How it works

1. `.github/workflows/build-pages.yml` runs `fetch.mjs` every ~10 minutes
   (throttled internally - see `lib/throttle.mjs`; the shared workflow
   itself runs every 5 minutes for the banksy plugin's sake).
2. `fetch.mjs` requests a fresh OAuth2 access token (client_credentials
   grant) using the `VASTTRAFIK_AUTH_KEY` secret, then:
   - calls `/stop-areas/{gid}/departures` for both stops and picks the
     single next relevant departure at each - line 525 (Gråbo-bound) at
     Mjörn, line X3 at Gråbo (see `nextDeparture()`);
   - resolves Sjövik/Mjörn/Gråbo to coordinates via `/locations/by-text`
     and calls `/positions` once (bounding box + `lineDesignations=525,X3`)
     for every matching vehicle GPS fix currently in that area (see
     `resolveRoute()`);
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
   (Mashup pane - same countdown + bus-info lines, no map image, see that
   file's comment).

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
Sjövik/Mjörn/Gråbo (padded ~2km) and `lineDesignations: ["525", "X3"]`
(both lines, since either board's bus could be in that box at once), so it
should only ever pick up vehicles relevant to these two boards.

Each departure is then matched to its own fix in that result set by
`detailsReference` (`describeDeparturePosition()`) - the same field name
Västtrafik uses for "the reference to the service journey" on the
departures endpoint and "journey reference" on the positions endpoint,
which is exactly the kind of shared id meant to link the two. **This
specific assumption hasn't been confirmed against a live response** (no
Västtrafik credentials were available in the sandbox this was built in) -
if `bus_location` always comes back "Position okänd" even for a departure
that's clearly already en route, that match is the first thing to check
(log a raw `/positions` result and a raw departure's `detailsReference`
side by side).

**Known gap:** the map currently only plots the 3 confirmed endpoints
(Sjövik / Mjörn / Gråbo) - an earlier request also asked for "the 5 stops
from Sjövik before Mjörn". Those exact intermediate stop names couldn't be
verified from the sandbox this was built in. If you give the 5 names in
order, they drop straight into `ROUTE_STOP_QUERIES` in `fetch.mjs` (each is
resolved to coordinates automatically via `/locations/by-text` - no manual
lat/long lookup needed) and `renderPositionMap()`'s marker loop extends to
plot all of them.

## Debugging "Ingen avgång" (no departure) or a wrong/missing line

If `mjorn_to_grabo.has_departure` (or `grabo_to_goteborg`'s) is `false`, or
shows the wrong line entirely, when you're sure a bus should be coming,
there are a few different possible causes:

1. **Genuinely nothing scheduled soon in that direction** - regional/local
   routes like these often thin out or stop entirely late evening/weekends;
   the next one might just be a while away or not until the next service
   day. Not a bug - check Västtrafik's own journey planner for the same
   stop/time to confirm.
2. **The line number is wrong** - this already happened once (see "Line
   correction" above: X3 was used where 525 was needed). If a board never
   finds a departure no matter the time of day, suspect this first.
3. **The direction filter (`isTowardsGrabo()`) is wrong** - it excludes
   destinations naming Sjövik/Brobacka to keep only the Gråbo-bound
   direction. If Västtrafik's actual headsigns don't work that way (e.g.
   showing a via-line name instead of the true endpoint), this filter
   could silently exclude (or include) the wrong trips.

To tell these apart without guessing, `data.json` includes a
`debug_raw_departures` field - `{ mjorn: [...], grabo: [...] }`, each item
`{ line, destination, planned_time, minutes_until }` for the next 10 raw
departures at that stop, **any line, completely unfiltered by direction**
(see `debugRawDepartures()` in `fetch.mjs`). Neither template reads it -
it's purely for checking, next time `data.json` refreshes, what's actually
scheduled at that stop right now. This is exactly what would have caught
the line-number bug immediately (line 525's real departures would have
been sitting right there in the raw list, under the wrong line name filter)
instead of needing a live user report first - keep this field around, it's
cheap and has already paid for itself once.

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
- Markup (Quadrant tab): paste `template.quadrant.liquid` - includes a
  compact bus-name/position line under each countdown too, not just the
  Full view

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
  "generated_at": "2026-09-12T20:16:09.528Z",
  "updated_display": "Data uppdaterad kl 22:16 idag",
  "mjorn_to_grabo": {
    "label": "Nästa buss från Mjörn mot Gråbo kommer om",
    "stop_name": "Mjörn, Lerum",
    "line": "525",
    "has_departure": true,
    "minutes_until": 11,
    "estimated_time": "22:27",
    "delay_minutes": 0,
    "is_cancelled": false,
    "destination": "Lerum",
    "bus_name": "525 mot Lerum",             // from /positions' "name" field, or null if no live fix matched
    "bus_location": "Mellan Sjövik och Mjörn (31%)"
  },
  "grabo_to_goteborg": {
    "label": "Nästa buss från Gråbo busshållplats mot Göteborg kommer om",
    "stop_name": "Mjörnbotorget (Gråbo busstation)",
    "line": "X3",
    "via_note": "Line X3 stops at Polhemsplatsen, Göteborg (~10 min walk to Nils Ericson Terminalen)",
    "has_departure": true,
    "minutes_until": 26,
    "estimated_time": "22:42",
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
  },
  "debug_raw_departures": {
    "mjorn": [ { "line": "525", "destination": "Lerum", "planned_time": "22:27", "minutes_until": 11 } /* ... up to 10 */ ],
    "grabo": [ { "line": "X3", "destination": "Särö", "planned_time": "22:42", "minutes_until": 26 } /* ... up to 10 */ ]
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

This is also the fastest way to check the unverified `detailsReference`
matching noted above - the script logs the full `data.json` contents,
`debug_raw_departures` included, to the console.

## Known limitations / maintenance

- **Stop IDs are hardcoded** (`MJORN_GID`, `GRABO_GID` constants in
  `fetch.mjs`). They're Västtrafik-internal IDs and stable, but if a stop is
  ever renamed/rebuilt, re-look-up via:
  `GET /pr/v4/locations/by-text?q=<name>` (Bearer token required). The
  three route-map points (`ROUTE_STOP_QUERIES`) are resolved by *name* at
  every fetch instead, so they don't need re-hardcoding if a stop moves.
- **`MJORN_LINE` ("525") and `GRABO_LINE` ("X3") are hardcoded and
  deliberately kept as two separate constants** (see "Line correction"
  above - they used to both be "X3", which was wrong). If Västtrafik
  changes the route network in the future, re-verify each independently
  against `debug_raw_departures` rather than assuming they're still the
  same line as each other.
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
  relevant one - Mjörn especially needs a generous limit since line 525
  runs both directions through it.
