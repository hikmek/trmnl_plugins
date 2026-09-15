# Plugin #2 - "Matn" (School Lunch + Hemmamat + Dagens kock)

TRMNL private plugin (Polling strategy), displayed on-device as **Matn**
(bottom-left corner of both views). Three independent sections share this
one plugin/data feed, laid out as three columns side by side in the Full
view (Quadrant only has room for skolmatn + dagens kock - see below):

1. **Skolmatn** (left column) - the school's **vegetarian** option only
   (`today.vegetarian`) for Lerums kommun. On Lördag/Söndag there's never a
   school menu at all, so this column shows **"HELGn = Ingen skolmatn"**
   instead.
2. **Hemmamatn** (center column) - the family's own home-cooked weekend
   menu, sourced from a shared Google Sheet. Shows **both** Lördag and
   Söndag (Lunch + Middag each) for the current ISO week - every day, not
   just on the weekend itself, since a weekday's current ISO week already
   covers its upcoming weekend.
3. **Dagens kock** (right column) - unrelated in content to the other two:
   today's random pick from the broforce plugin's portrait roster, shown
   with a "Dagens kock:" label, picture, name, and a short **Swedish**
   description underneath, in both Full and Quadrant views.

- Skolmat data source: [lerum.se lunch menu page](https://lerum.se/utbildning-och-barnomsorg/gemensamt-for-forskolor-och-skolor-i-lerums-kommun/maltider/matsedel-grundskola-och-gymnasium-hostterminen-2026) (Höstterminen 2026).
  No API - the page is scraped directly (plain server-rendered HTML, no JS
  needed).
- Hemmamat data source: a shared [Google Sheet](https://docs.google.com/spreadsheets/d/1z0fEGn4A9hKnX-EZ9GycGjbZV_k0jb1_8mA-BRJrUqY/edit?gid=0#gid=0)
  (one row per ISO week number, Lördag/Söndag × Lunch/Middag columns).
  **Must be shared as "Anyone with the link" → Viewer** - `fetch.mjs` reads
  it via the public `gviz/tq` CSV export endpoint, no API key/login
  involved, same no-credentials approach as every other plugin here. Fetched
  **every day** (not just on weekends), keyed by the current ISO week.
- Dagens kock data source: `../broforce/portraits/manifest.json` - read
  straight off disk (both plugins live in this same repo checkout), no
  network call. See [plugin #5's README](../broforce/README.md) for what's
  in that roster. The manifest's `description` field is English (shared
  with broforce's own Full view); `fetch.mjs` translates it to Swedish via
  a `DAGENS_KOCK_DESCRIPTIONS_SV` lookup keyed by slug, kept in
  lunch-lerum's own `fetch.mjs` so broforce's own display is untouched.

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
3. It figures out "today" using the **Europe/Stockholm** calendar date and
   sets `today.is_weekend` accordingly. Every day (not just weekends), it
   also computes the current **ISO 8601 week number** (Sweden's usual week
   numbering - matches the sheet's "vecka" column) and fetches the
   hemmamat sheet's row for that week, so `today.hemmamat` always has
   whatever's currently in the sheet for Lördag and Söndag.
4. It also picks one random entry from the broforce roster for "Dagens
   kock" - same mechanism as broforce/fetch.mjs's own Bro-of-the-day pick,
   just done independently here (not necessarily the same Bro broforce
   itself shows that day).
5. It writes `public/lunch-lerum/data.json` with today's menu, the current
   week's hemmamat (every day), and dagens_kock (every day), plus a short
   skolmat look-ahead.
6. GitHub Pages publishes it at:
   `https://hikmek.github.io/trmnl_plugins/lunch-lerum/data.json`
7. Your TRMNL device (Private Plugin, Polling strategy) fetches that JSON
   and renders it with `template.liquid` (Full - 3 columns: Skolmatn /
   Hemmamatn / Dagens kockn) / `template.quadrant.liquid` (Quadrant -
   today's skolmat or vegetarian dish, or hemmamat on weekends, plus
   Dagens kock on the right).

All of the above only actually runs once the Europe/Stockholm calendar
date changes (step 1's throttle) - so **all three sections (skolmat,
hemmamat, dagens kock) update together, right after midnight**, not on
some independent schedule per section.

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
    "is_weekend": false,   // true only on Lördag/Söndag
    "note": null,          // e.g. "Höstlov", "Studiedag", "Terminsstart" - null on normal days
    "lunch": "Panerad fisk med remouladsås och kokt potatis",
    "lunch_icon_urls": ["fish"], // every matching keyword, not just the first - can be several (see below)
    "vegetarian": null,    // null if only one option was published that day
    "vegetarian_icon_urls": [],
    "hemmamat": {          // current ISO week's row from the sheet - fetched every day, not just weekends
      "vecka": 37,                // ISO week number, matches the sheet's "vecka" column
      "lordag": { "lunch": "soppa på spik", "middag": "spädgris" },
      "sondag": { "lunch": "pannkakor", "middag": "kalops" }
    },
    "dagens_kock": {       // today's random pick from the broforce roster - every day, not just weekends
      "slug": "brominator",
      "name": "Brominator",
      "description": "T-800 från Terminator-filmerna", // Swedish - translated from broforce's English manifest, see DAGENS_KOCK_DESCRIPTIONS_SV
      "image_url": "https://hikmek.github.io/trmnl_plugins/broforce/portraits/brominator.png"
    }
  },
  "upcoming": [
    // next 4 school days found on the page after today, same shape as `today`
    // (always weekdays - hemmamat/dagens_kock are not computed for these, only for `today`)
  ]
}
```

If a weekday isn't found on the page at all (outside the term, or a gap in
what's published), `today.note` becomes `"No menu published for this
date"` and `lunch`/`vegetarian` are `null`. On an actual weekend,
`today.is_weekend` is `true` and `today.note` is instead
`"HELGn = Ingen skolmatn"` - `today.hemmamat` is filled in the same way as
on weekdays (it doesn't depend on `is_weekend`).

`hemmamat` is `null` (instead of the object shown above) if the sheet has
no row yet for the current ISO week, or if the sheet request fails - it
never blocks skolmat data from publishing.

## Pixel-art food icons

`generate-icons.mjs` procedurally draws 17 pixel-art icons at a 32x32 grid
(finer/more granular than the old 16x16 grid - no external images, no
licensing concerns) into `icons/*.png`: 14 food-type icons (`pasta`,
`meatballs`, `fish`, `salmon`, `chicken`, `sausage`, `rice`, `soup`,
`taco`, `pie`, `pancake`, `meatloaf`, `casserole`, `pot` - a stew/curry/
gulasch pot with a lid and steam lines, replacing the old single `stew`
icon), 2 "who chose" icons (`chef` - a toque/chef's hat, for "Kockens
val"; `people` - two person silhouettes, for "Gästens val"), and
`generic` (a plain empty bowl) as the ultimate fallback. `salmon` reuses
`fish`'s silhouette plus three diagonal subtractive stripe cutouts (not
an additive overlay - additive details drawn inside an already-solid
black shape render identically to the base icon, a bug found the hard
way in weather-yr's clothing icons; subtracting pixels from the solid
fill is what actually shows up). These are static assets committed to
git and copied into `public/lunch-lerum/icons/` by the shared workflow
(same pattern as banksy's gallery / weather-yr's icons).

**A dish can show several icons together now.** `fetch.mjs`'s
`iconsForDish()` walks the keyword list (`FOOD_ICON_KEYWORDS`) and
collects **every** matching keyword (deduped, capped at
`MAX_ICONS_PER_DISH = 4`), not just the first - e.g. "Fiskgryta med lax
och sej" matches `lax` → salmon, `fisk|sej|torsk` → fish, and
`gryta|curry|gulasch|chili` → pot, so it shows all three icons side by
side. `lunch_icon_urls` / `vegetarian_icon_urls` are now **arrays** (was
a single `lunch_icon_url` / `vegetarian_icon_url` string) built by
`iconUrls()`. **Every actual dish always gets at least one icon**: if no
keyword matches, `iconsForDish()` falls back to `["generic"]` rather than
an empty array (an empty array only happens when there's no dish at all
that day).

Each icon `<img>` is rendered inside its own plain `<table>`/`<td>` cell
(not TRMNL's styled table component, and not a bare flex row of `<img>`
siblings) - a bare row of `<img>` tags gets squashed into a narrow
sliver on a real device, table cells render each icon at full size
instead (same lesson learned in bus-grabo/weather-yr). In
`template.quadrant.liquid` this icon row sits centered at the very
**top** of the pane, above the dish text, and the icons are bigger
(60px). In `template.liquid` the icons sit below the dish text (Skolmatn
column: 64px; upcoming-days forecast table: 26px each).

To add more dishes/categories: add a `{ pattern: /keyword/i, icon: "name" }`
entry to `FOOD_ICON_KEYWORDS` in `fetch.mjs`, draw a matching shape
function in `generate-icons.mjs` (reuse the `bowl()` + `withBowl()`
helpers - a topping function just needs to return a boolean grid for the
area above the bowl rim; use `const u = size / 16;` to scale any
plain-integer pixel offsets so the shape doesn't shrink if `GRID` is ever
changed again), then re-run:

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
  If the current week's row is missing, `hemmamat` is just `null` and both
  views show "Ingen hemmamat inlagd än" - no error, just no data yet.
- If the sheet's sharing is ever changed back to "Restricted", the
  `gviz/tq` request starts failing (logged, non-fatal) and hemmamat quietly
  goes back to always-null until sharing is fixed.
- **Dagens kock depends on `plugins/broforce/portraits/manifest.json`
  existing in the repo.** If broforce is ever removed or that manifest is
  moved, `pickDagensKock()` fails safely (logged, non-fatal) and
  `dagens_kock` is just `null` - the right column simply doesn't render in
  either view.
