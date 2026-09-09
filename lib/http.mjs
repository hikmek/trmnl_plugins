// Shared fetch-with-retry helper used by all plugin fetch.mjs scripts.
// Guards against transient network blips (timeouts, DNS hiccups, 5xx) when
// running on GitHub Actions runners, without needing a dependency.

export async function fetchWithRetry(
  url,
  options = {},
  { retries = 3, delayMs = 1500, timeoutMs = 20000 } = {}
) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok && (res.status >= 500 || res.status === 429) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const maxRetryAfterMs = 10000; // never blindly block longer than this, even if asked to
        lastErr = new Error(`${url} responded ${res.status} ${res.statusText}`);
        const wait =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, maxRetryAfterMs)
            : delayMs * attempt * 2;
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err.name === "AbortError" ? new Error(`${url} timed out after ${timeoutMs}ms`) : err;
      if (attempt < retries) {
        await sleep(delayMs * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
