# Plugin #2 - School Lunch + Hemmamat (Lerums kommun)

TRMNL private plugin (Polling strategy) showing today's school lunch
(grundskola/gymnasium) for Lerums kommun, plus the next few school days -
and, on weekends (when there's no school lunch), the family's own
"Hemmamat" home-cooked menu instead.

- Skolmat data source: [lerum.se lunch menu page](https://lerum.se/utbildning-och-barnomsorg/gemensamt-for-forskolor-och-skolor-i-lerums-kommun/maltider/matsedel-grundskola-och-gymnasium-hostterminen-2026) (Höstterminen 2026).
  No API - the page is scraped directly (plain server-rendered HTML, no JS
  needed).
- Hemmamat data source: a shared [Google Sheet](https://docs.google.com/spreadsheets/d/1z0fEGn4A9hKnX-EZ9GycGjbZV_k0jb1_8mA-BRJrUqY/edit?gid=0#gid=0)
  (one row per ISO week number, Lördag/Söndag × Lunch/Middag columns).
  **Must be shared as "Anyone with the link" → Viewer** - `fetch.mjs` reads
  it via the public `gviz/tq` CSV export endpoint, no API key/login
  involved, same no-credentials approach as every other plugin here.

## How it works

1. `.github/workflows/build-pages.yml` runs `fetch.mjs` on every workflow
   run, but `fetch.mjs` self-throttles via `shouldSkipDailyFetch()` in
   `lib/throttle.mjs`: it only skips the actual scrape if the
   **already-published `today.date` matches today's real Europe/Stockholm
   calendar date**. This is calendar-day-aware, not just "N hours since
   last fetch" - so as soon as the date rolls over past midnight, the very
   next workflow run (usually within ~5-15 min) fetches fresh data
   immediately, instead of potentially serving yesterday's menu for a long
   stretch into the new day.
2. `fetch.mjs` downloads the lerum.se page, parses each day's heading
   (`<h3 class="subheading3">Weekday D Month [note]</h3>`) and its list of
   `<li>Dagens Lunch ...</li>` / `<li>Dagens Gröna ...</li>` items.
3. It figures out "today" using the **Europe/Stockholm** calendar date. If
   today is Lördag or Söndag (school never publishes weekend menus), it
   also fetches the hemmamat sheet, computes today's **ISO 8601 week
   number** (Sweden's usual week numbering - matches the sheet's "vecka"
   column), and looks up that week's row.
4. It writes `public/lunch-lerum/data.json` with today's menu (+ hemmamat,
   on weekends) and a short skolmat look-ahead.
5. GitHub Pages publishes it at:
   `https://hikmek.github.io/trmnl_plugins/lunch-lerum/data.json`
6. Your TRMNL device (Private Plugin, Polling strategy) fetches that JSON
   and renders it with `template.liquid`.

## One-time setup

Pages/Actions are already configured for this repo (shared with plugin #1).
On [usetrmnl.com](https://usetrmnl.com), create another **Private Plugin**:

- Strategy: **Polling**
- Polling URL: `https://hikmek.github.io/trmnl_plugins/lunch-lerum/data.json`
- Polling Verb: `GET`
- Refresh rate: once a day is plenty (matches the backend's ~23h cadence)
- Markup: paste the contents of `template.liquid`

## Data schema (`data.json`)

```jsonc
{
  "plugin": "lunch-lerum",
  "source_url": "https://lerum.se/...",
  "term": "Höstterminen 2026",
  "generated_at": "2026-09-08T16:53:59.043Z",
  "updated_display": "Data uppdaterad onsdag 10 september", // Swedish weekday + date, shown bottom-right
  "today": {
    "date": "2026-09-08",
    "weekday": "Tisdag",
    "note": null,          // e.g. "Höstlov", "Studiedag", "Terminsstart" - null on normal days
    "lunch": "Panerad fisk med remouladsås och kokt potatis",
    "lunch_icon_url": null, // set only if the dish text matches a known keyword (see below)
    "vegetarian": null,    // null if only one option was published that day
    "vegetarian_icon_url": null,
    "hemmamat": null       // set only on Lördag/Söndag when the sheet has a row for this week - see below
  },
  "upcoming": [
    // next 4 school days found on the page after today, same shape as `today`
    // (always weekdays - hemmamat is always null here, the lookahead doesn't span weekends)
  ]
}
```

If a weekday isn't found on the page at all (outside the term, or a gap in
what's published), `today.note` becomes `"No menu published for this
date"` and `lunch`/`vegetarian` are `null`. On an actual weekend, `today.note`
is instead `"HELG !! = ingen skolmat"` and `today.hemmamat` is filled in
(when the sheet has that week's row):

```jsonc
"hemmamat": {
  "vecka": 37,             // ISO week number, matches the sheet's "vecka" column
  "lunch": "soppa på spik",  // that day's (Lördag or Söndag, whichever today is) Lunch column
  "middag": "spädgris"       // ...and Middag column
}
```

`hemmamat` stays `null` on weekends too if the sheet has no row yet for the
current ISO week, or if the sheet request fails - it never blocks skolmat
data from publishing.

## Pixel-art food icons

`generate-icons.mjs` procedurally draws 16 small black/white pixel-art
icons (no external images, no licensing concerns) into `icons/*.png`:
13 food-type icons (`pasta`, `meatballs`, `fish`, `chicken`, `sausage`,
`rice`, `soup`, `taco`, `stew`, `pie`, `pancake`, `meatloaf`, `casserole`),
2 "who chose" icons (`chef` - a toque/chef's hat, for "Kockens val";
`people` - two person silhouettes, for "Gästens val"), and `generic` (a
plain empty bowl) as the ultimate fallback. These are static assets
committed to git and copied into `public/lunch-lerum/icons/` by the
shared workflow (same pattern as banksy's gallery / weather-yr's icons).

`fetch.mjs` matches the `lunch`/`vegetarian` dish text against a
priority-ordered keyword list (`FOOD_ICON_KEYWORDS`, first match wins -
more specific food categories are checked first, then "kockens"/"gästens"
near the end, so e.g. "Kockens val av pastarätt" still shows pasta, but
the truly generic "Kockens val" shows the chef hat) and sets
`lunch_icon_url` / `vegetarian_icon_url` accordingly. **Every actual dish
always gets an icon**: if no keyword matches, `iconForDish()` falls back
to `"generic"` rather than `null` (a `null` icon URL only happens when
there's no dish at all that day). Across the full autumn term menu (78
unique dishes), 73 get a specific icon and only 5 fall back to generic.

`template.liquid` and `template.quadrant.liquid` show the icon **below**
the dish text, centered, in both the "today" section and the upcoming
table.

To add more dishes/categories: add a `{ pattern: /keyword/i, icon: "name" }`
entry to `FOOD_ICON_KEYWORDS` in `fetch.mjs` (remember: order matters,
more specific first), draw a matching shape function in
`generate-icons.mjs` (reuse the `bowl()` + `withBowl()` helpers - a
topping function just needs to return a boolean grid for the area above
the bowl rim), then re-run:

```powershell
node plugins/lunch-lerum/generate-icons.mjs
```

## Local test

```powershell
node plugins/lunch-lerum/fetch.mjs
```

## Known limitations / maintenance

- **This is tied to one specific school term's page** (`SOURCE_URL` +
  `TERM_YEAR` constants in `fetch.mjs`). When Lerums kommun publishes a new
  term's menu at a new URL (e.g. Vårterminen 2027), update those two
  constants.
- The parser depends on the exact HTML structure of lerum.se's CMS
  (SiteVision) - specifically the `subheading3` heading class and
  `env-text-list normal` list class. If the municipality redesigns the page,
  `parseDays()` in `fetch.mjs` may need adjusting.
- Some days on the source page have no `Dagens Lunch` and/or no
  `Dagens Gröna` item (either not yet published, or a note-only day like a
  holiday) - these come through as `null` and the template shows "-" / a
  fallback message.
- **Hemmamat needs its sheet's row filled in ahead of time**: whoever
  maintains the sheet adds a new "vecka" row before that weekend arrives.
  If a weekend's row is missing, `hemmamat` is just `null` and the Full
  view shows "- (helgmeny, visas lördag-söndag)" - no error, just no data
  yet.
- If the sheet's sharing is ever changed back to "Restricted", the
  `gviz/tq` request starts failing (logged, non-fatal) and hemmamat quietly
  goes back to always-null until sharing is fixed.
