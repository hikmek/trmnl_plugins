# Plugin #3 - Bus Departures near Gråbo (Västtrafik)

TRMNL private plugin (Polling strategy) showing two live departure boards:

1. **Mjörn, Lerum** - all departures from this stop (local shuttle, line 525
   towards Lerum / Sjövik).
2. **Mjörnbotorget → Göteborg** - departures towards Göteborg from the stop
   that actually serves Mjörnbotorget square in Gråbo, which is
   **"Gråbo busstation"** (~130m away; there's no stop literally named
   "Mjörnbotorget"). Filtered to **line X3**, the only line from there that
   runs via Göteborg (it stops at Polhemsplatsen, ~10 min walk from Nils
   Ericson Terminalen) on its way further south to Kullavik/Särö.

- Data source: [Västtrafik "Planera Resa" API v4](https://developer.vasttrafik.se/)
- Requires a **free** Västtrafik developer account + API credentials
  (unlike the weather/lunch plugins, this one needs an API key).

## How it works

1. `.github/workflows/build-pages.yml` runs `fetch.mjs` every 30 minutes
   (same shared workflow as the other plugins).
2. `fetch.mjs` requests a fresh OAuth2 access token (client_credentials
   grant) using the `VASTTRAFIK_AUTH_KEY` secret, then calls the
   `/stop-areas/{gid}/departures` endpoint for both stops.
3. Writes `public/bus-grabo/data.json` with upcoming departures, including
   real-time delay info.
4. GitHub Pages publishes it at:
   `https://hikmek.github.io/trmnl_plugins/bus-grabo/data.json`
5. Your TRMNL device (Private Plugin, Polling strategy) fetches that JSON
   and renders it with `template.liquid`.

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
- Markup: paste the contents of `template.liquid`

## Data schema (`data.json`)

```jsonc
{
  "plugin": "bus-grabo",
  "generated_at": "2026-09-08T17:16:09.528Z",
  "mjorn": {
    "stop_name": "Mjörn, Lerum",
    "departures": [
      {
        "line": "525",
        "destination": "Lerum",
        "platform": "A",
        "planned_time": "19:27",
        "estimated_time": "19:27",
        "minutes_until": 11,
        "delay_minutes": 0,
        "is_cancelled": false
      }
      // ...
    ]
  },
  "mjornbotorget_to_goteborg": {
    "stop_name": "Mjörnbotorget (Gråbo busstation)",
    "via_note": "Line X3 stops at Polhemsplatsen, Göteborg (~10 min walk to Nils Ericson Terminalen)",
    "line_filter": "X3",
    "departures": [
      { "line": "X3", "destination": "Särö", "platform": "D", "planned_time": "19:42", "estimated_time": "19:42", "minutes_until": 26, "delay_minutes": 0, "is_cancelled": false }
      // ...
    ]
  }
}
```

## Local test

```powershell
$env:VASTTRAFIK_AUTH_KEY = "your-base64-key"
node plugins/bus-grabo/fetch.mjs
Remove-Item Env:\VASTTRAFIK_AUTH_KEY
```

## Known limitations / maintenance

- **Stop IDs are hardcoded** (`MJORN_GID`, `GRABO_GID` constants in
  `fetch.mjs`). They're Västtrafik-internal IDs and stable, but if a stop is
  ever renamed/rebuilt, re-look-up via:
  `GET /pr/v4/locations/by-text?q=<name>` (Bearer token required).
- **Line X3 is hardcoded** as "the line that goes to Göteborg from Gråbo".
  If Västtrafik changes the route network in the future, verify with a
  direct journey search:
  `GET /pr/v4/journeys?originGid=<GRABO_GID>&destinationGid=9021014004940000&onlyDirectConnections=true`
  (destination gid is Nils Ericson Terminalen, Göteborg).
- The Västtrafik access token is valid 24h, but since this runs fresh in
  GitHub Actions each time, a new token is requested on every run - no
  caching/refresh logic needed.
- Departures more than a few hours out aren't very useful for a live board;
  `DEPARTURE_LIMIT` (8) keeps the list short and relevant.
