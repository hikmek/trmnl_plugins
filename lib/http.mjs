// Shared fetch-with-retry helper used by all plugin fetch.mjs scripts.
// Guards against transient network blips (timeouts, DNS hiccups, 5xx) when
// running on GitHub Actions runners, without needing a dependency.

export async function fetchWithRetry(url, options = {}, { retries = 3, delayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        lastErr = new Error(`${url} responded ${res.status} ${res.statusText}`);
        await sleep(delayMs * attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(delayMs * attempt);
        continue;
      }
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
