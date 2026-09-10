// Self-correcting fetch throttle. Instead of relying on wall-clock minute
// alignment (fragile: GitHub Actions scheduled workflows are frequently
// delayed/jittered by several minutes, so "only run at :00/:30" can miss
// its exact window entirely and cause much longer real gaps than
// intended), this checks the ALREADY-PUBLISHED data.json's own
// generated_at timestamp and compares it to now. If less time than the
// target interval has passed, the expensive fetch is skipped; otherwise
// it proceeds. This self-corrects regardless of when the workflow
// actually happens to run.

export async function shouldSkipFetch(liveDataUrl, minIntervalMinutes) {
  if (process.env.FORCE_FETCH === "true") return false;

  try {
    const res = await fetch(liveDataUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false; // can't verify freshness - fetch fresh to be safe
    const json = await res.json();
    const generatedAt = new Date(json.generated_at).getTime();
    if (!Number.isFinite(generatedAt)) return false;
    const elapsedMinutes = (Date.now() - generatedAt) / 60000;
    return elapsedMinutes < minIntervalMinutes;
  } catch {
    return false; // any error checking - don't skip, just fetch fresh to be safe
  }
}

// Calendar-day-aware variant for once-a-day plugins (e.g. a daily menu):
// skips only if the published data is already dated "today" (in the given
// timezone). Unlike shouldSkipFetch()'s fixed elapsed-minutes window, this
// guarantees a fresh fetch happens promptly after the calendar day rolls
// over, however long that took, rather than potentially waiting out a
// long fixed interval (e.g. 23h) that was measured from an arbitrary
// previous fetch time and could span into the new day.
export async function shouldSkipDailyFetch(liveDataUrl, getDateFromJson, timeZone = "Europe/Stockholm") {
  if (process.env.FORCE_FETCH === "true") return false;

  try {
    const res = await fetch(liveDataUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    const json = await res.json();
    const publishedDate = getDateFromJson(json);
    if (!publishedDate) return false;
    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return publishedDate === todayKey;
  } catch {
    return false;
  }
}
