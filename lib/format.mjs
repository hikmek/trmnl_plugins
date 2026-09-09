// Shared "Data uppdaterad kl HH:MM idag" formatter used by multiple plugin
// fetch.mjs scripts. Shows a Swedish relative "idag" (today) label when the
// data was generated on the same Europe/Stockholm calendar date as "now",
// falling back to an absolute date (e.g. "9 september") otherwise.

export function formatUpdatedDisplay(nowMs, timeZone = "Europe/Stockholm") {
  const now = new Date(nowMs);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "long",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const timeStr = `${get("hour")}:${get("minute")}`;
  const dateStr = `${get("day")} ${get("month")}`; // e.g. "9 september"

  const dateKeyFmt = { timeZone, year: "numeric", month: "2-digit", day: "2-digit" };
  const dataDateKey = new Intl.DateTimeFormat("en-CA", dateKeyFmt).format(now);
  const todayKey = new Intl.DateTimeFormat("en-CA", dateKeyFmt).format(new Date());

  const dayLabel = dataDateKey === todayKey ? "idag" : dateStr;
  return `Data uppdaterad kl ${timeStr} ${dayLabel}`;
}
