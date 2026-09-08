# Plugin #2 - School Lunch (Lerums kommun)

TRMNL private plugin (Polling strategy) showing today's school lunch
(grundskola/gymnasium) for Lerums kommun, plus the next few school days.

- Data source: [lerum.se lunch menu page](https://lerum.se/utbildning-och-barnomsorg/gemensamt-for-forskolor-och-skolor-i-lerums-kommun/maltider/matsedel-grundskola-och-gymnasium-hostterminen-2026) (Höstterminen 2026)
- No API - the page is scraped directly (plain server-rendered HTML, no JS needed).

## How it works

1. `.github/workflows/build-pages.yml` runs `fetch.mjs` every 30 minutes
   (same shared workflow as the weather plugin).
2. `fetch.mjs` downloads the lerum.se page, parses each day's heading
   (`<h3 class="subheading3">Weekday D Month [note]</h3>`) and its list of
   `<li>Dagens Lunch ...</li>` / `<li>Dagens Gröna ...</li>` items.
3. It figures out "today" using the **Europe/Stockholm** calendar date and
   writes `public/lunch-lerum/data.json` with today's menu + a short
   look-ahead.
4. GitHub Pages publishes it at:
   `https://hikmek.github.io/trmnl_plugins/lunch-lerum/data.json`
5. Your TRMNL device (Private Plugin, Polling strategy) fetches that JSON
   and renders it with `template.liquid`.

## One-time setup

Pages/Actions are already configured for this repo (shared with plugin #1).
On [usetrmnl.com](https://usetrmnl.com), create another **Private Plugin**:

- Strategy: **Polling**
- Polling URL: `https://hikmek.github.io/trmnl_plugins/lunch-lerum/data.json`
- Polling Verb: `GET`
- Refresh rate: 30-60 min (a daily refresh would also be enough in practice,
  since the menu for a given day doesn't change during the day)
- Markup: paste the contents of `template.liquid`

## Data schema (`data.json`)

```jsonc
{
  "plugin": "lunch-lerum",
  "source_url": "https://lerum.se/...",
  "term": "Höstterminen 2026",
  "generated_at": "2026-09-08T16:53:59.043Z",
  "today": {
    "date": "2026-09-08",
    "weekday": "Tisdag",
    "note": null,          // e.g. "Höstlov", "Studiedag", "Terminsstart" - null on normal days
    "lunch": "Panerad fisk med remouladsås och kokt potatis",
    "vegetarian": null     // null if only one option was published that day
  },
  "upcoming": [
    // next 4 days found on the page after today, same shape as `today`
  ]
}
```

If a date isn't found on the page at all (e.g. outside the term, or a
weekend), `today.note` becomes `"No menu published for this date"` and
`lunch`/`vegetarian` are `null`.

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
