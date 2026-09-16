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

`generate-icons.mjs` procedurally draws 19 pixel-art icons at a 32x32 grid
(finer/more granular than the old 16x16 grid - no external images, no
licensing concerns) into `icons/*.png`: 14 food-type icons (`pasta`,
`meatballs`, `fish`, `salmon`, `chicken`, `sausage`, `rice`, `soup`,
`taco`, `pie`, `pancake`, `meatloaf`, `casserole`, `pot` - a stew/curry/
gulasch pot with a lid and steam lines, replacing the old single `stew`
icon), a wordplay pair (`macintosh`/`cheese`, see below), 2 "who chose"
icons (`chef` - a toque/chef's hat, for "Kockens val"; `people` - two
person silhouettes, for "Gästens val"), and `generic` (a plain empty
bowl) as the ultimate fallback. `salmon` reuses `fish`'s silhouette plus
three diagonal subtractive stripe cutouts (not an additive overlay -
additive details drawn inside an already-solid black shape render
identically to the base icon, a bug found the hard way in weather-yr's
clothing icons; subtracting pixels from the solid fill is what actually
shows up). These are static assets committed to git and copied into
`public/lunch-lerum/icons/` by the shared workflow (same pattern as
banksy's gallery / weather-yr's icons).

**`macintosh` + `cheese` are a wordplay pair for "Mac n cheese"**, shown
together instead of a generic pasta/casserole icon: a generic old boxy
computer/monitor silhouette (screen cutout, floppy-slot cutout, two
feet - not any specific product's design, just a generic "old computer"
pictogram) for the "Mac" pun, and a wedge of cheese with two holes for
the "cheese". Both `FOOD_ICON_KEYWORDS` entries in `fetch.mjs` match the
exact same phrase (`/mac\s*n\s*cheese|mac\s*(?:and|&)\s*cheese/i`) with
different icon names, so `iconsForDish()`'s "collect every match" logic
naturally adds both. The cheese wedge's holes are deliberately placed
well clear of its pointed tip - a hole positioned too close to the tip
gets lost in the tip's own taper and just looks like part of the
triangle's edge instead of a distinct hole (found by rendering the raw
grid as ASCII art and eyeballing it before committing to coordinates).

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

Every icon `<table>` block is guarded with `{% if x_icon_urls.size > 0 %}` before
it renders. This isn't just cosmetic: `shouldSkipDailyFetch()` in
`lib/throttle.mjs` means a code change to `fetch.mjs` does **not**
retroactively update a `data.json` that's already published for today's
calendar date - so there's always a transition window (until the next
calendar-day rollover, or a manual `workflow_dispatch` run, which sets
`FORCE_FETCH=true` and bypasses the throttle) where a newly-pasted
template can be polling **stale data still using the old schema**. If a
template's `{% for %}` loop iterates a field that doesn't exist yet, it
silently produces zero cells - fine on its own - but this project
previously hit a case where an unguarded `<table><tr>` left with **zero**
`<td>` children (because the array field didn't exist in the stale JSON
yet) blanked TRMNL's entire render, not just that one icon row. The
`.size > 0` guard skips the whole `<table>` in that situation instead of
emitting a malformed empty one.

**Centering the icon row (Quadrant only) needs `text-align: center` on
a wrapping `<div>` plus `display: inline-table` on the `<table>` itself
- plain `margin: 0 auto` on the table alone isn't reliable here.** It
looked fine with 3 icons spread across most of the pane's width, but was
visibly stuck at the left edge on a day with only 1 icon (a dish that
matched no keyword, falling back to the generic bowl icon) - `margin: 0
auto` only centers a block element within a containing block that gives
it a definite width, which apparently doesn't happen reliably inside the
surrounding `layout--col` column on TRMNL's renderer.

Each icon `<img>` is rendered inside its own plain `<table>`/`<td>` cell
(not TRMNL's styled table component, and not a bare flex row of `<img>`
siblings) - a bare row of `<img>` tags gets squashed into a narrow
sliver on a real device, table cells render each icon at full size
instead (same lesson learned in bus-grabo/weather-yr). In
`template.quadrant.liquid` this icon row sits centered at the very
**top** of the pane, above the dish text, and the icons are bigger
(44px, up from the original 32px). In `template.liquid` the icons sit
below the dish text (Skolmatn column: 64px; upcoming-days forecast
table: 26px each) - the Full view has room to spare, so it isn't
height-constrained the way Quadrant is.

**Quadrant is a fixed, non-scrolling pane** - a first attempt at 60px
icons pushed the dish text and the whole "Dagens kock" column off the
visible area entirely (the icons showed, everything below them just
vanished, with no partial cut-off - the renderer appears to crop
whatever doesn't fit rather than shrink or scroll it). 44px was chosen
as the biggest size that leaves room for the rest of the pane's content;
if you make icons bigger again, expect to also shrink something else
below them (Dagens kock's photo height, its description's truncate
length) to compensate, and re-check the real device rather than
assuming it fits.

**The dish-text/Dagens kock section is a plain HTML `<table>` (one
`<tr>`, two `<td>`s), not a `<div class="layout layout--row">` with flex
children - and that's not a style choice, it's a workaround.** It used
to be a flex row, and it broke badly on the real device: the two columns
collapsed into one narrow vertical sliver, with the dish text wrapped
one character per line and the Dagens kock photo squeezed into a thin
strip, instead of rendering side by side. Three different fixes were
tried, in order - a bigger flex-grow share on the text column
(`flex: 1.4`) with a smaller gap, reverting that back to the plain
`flex: 1`/`gap--large` every other row in this repo uses, and then
adding the `item` class that every *other* working flex row here already
has (comparing against `template.liquid`'s three-column row, which has
rendered correctly this whole time) - and all three produced the
identical broken sliver on the real device, despite each looking
completely fine by every check possible without it (tag balance,
structure review). Whatever's actually broken about a `layout--row` in
this specific spot was never isolated. Switching to a plain `<table>`
(column widths via `width="58%"`/`width="42%"` on the `<td>`s plus
`table-layout: fixed`, not flex-grow) sidesteps the whole mechanism by
reusing the same "plain unstyled table" trick already proven to work for
the icon row above and for `template.liquid`'s forecast table. If this
section needs changes again, test on the real device before trusting
anything, and prefer extending the table pattern over reintroducing a
`layout--row` here.

**Follow-up bug, also fixed: don't put a flex container (`layout--col`
or `layout--row`) directly inside a `<td>` either.** The table swap
above fixed the sliver, but its first version still wrapped each cell's
content in `<div class="layout layout--col layout--center gap--xsmall">`
- and on the real device, everything after the first child inside each
cell vanished (only the "Dagens Lunch"/"Dagens kock:" labels showed; the
dish description and the chef photo were both just gone). Flexbox inside
a table cell is a known cross-renderer trouble spot generally (cell
sizing doesn't compose cleanly with flex layout), so both `<td>`s here
now use plain `<div>`s with `text-align: center;` instead - there's no
flex box in this section at all anymore, direct child of a `<td>` or
otherwise. The Dagens kock `<img>` also switched from `max-height: 34%`
(a percentage height needs a sized ancestor to mean anything, and a
`<td>` with no explicit height doesn't give it one) to a fixed
`max-height: 55px`.

The dish text also has a generous
70-character truncate as a safety net for this same reason - every dish
in the current term (~63 chars max) fits well under it, so it's not
visible in practice, but an unbounded name could in principle wrap
enough lines to push content off-pane the same way the icons did.

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
- **Fixed: recurring GitHub Actions failure fetching lerum.se**
  (`TypeError: fetch failed` / `Error: redirect count exceeded`, seen
  repeatedly in the "Fetch lunch-lerum data" step). Because
  `shouldSkipDailyFetch()` only re-fetches once per calendar day, every
  failed run left `data.json` stuck on whatever was last successfully
  published - which is why a code change (e.g. the Mac n Cheese icon pair
  below) could sit merged for a while without showing up live: the daily
  fetch kept failing before it ever ran the new code against fresh HTML.
  Root cause: Node's built-in `fetch` (undici) follows redirects
  automatically but does NOT persist `Set-Cookie` across those hops the way
  a browser's shared cookie jar does. lerum.se (SiteVision) appears to gate
  access behind a "set a cookie, then redirect back to the same URL"
  check - without the cookie being echoed back, the redirect target looks
  like a fresh visitor again and redirects right back, looping until
  undici's redirect cap trips. Reproduced locally against a mock server
  that implements exactly that pattern (plain `fetch()` fails with the
  identical "redirect count exceeded" message; a cookie jar fixes it).
  `fetchHtml()` in `fetch.mjs` now follows redirects manually
  (`fetchWithCookieJar()`), carrying `Set-Cookie` values forward as a
  `Cookie` header on each subsequent hop - exactly what a browser does for
  you automatically. Only `fetchHtml()` (the lerum.se request) was changed;
  the hemmamat Google Sheets request is a different host and already has
  its own non-fatal fallback, so it was left alone.
- **Fixed: Quadrant content sat too high, not vertically centered in the
  pane.** The outer wrapper in `template.quadrant.liquid` was plain
  `<div class="layout layout--col gap--xsmall">` - missing `layout--center`,
  which every other Quadrant template in this repo (`broforce`, `banksy`,
  `weather-yr`) already has on its outermost wrapper. Added `layout--center`
  plus `height: 100%;` (the same "give it a definite size so centering has
  something to center within" reasoning as the icon-table centering fix
  above).
