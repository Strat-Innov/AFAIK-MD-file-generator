/* ------------------------------------------------------------------ *
 * Per-bucket snapshot — what a tag looked like last time it was
 * generated (just filenames, never content) plus the most recent
 * changelog entry's text, so a tab can show "what changed last time"
 * without re-fetching from GitHub. Tiny, one entry per tag.
 * ------------------------------------------------------------------ */

const KEY = "afaik-bucket-snapshot-v1";

function readAll() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return {};
  return JSON.parse(raw); // corrupt JSON throws — fail fast
}

function writeAll(map) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function getSnapshot(tag) {
  return readAll()[tag] || null;
}

export function setSnapshot(tag, { names, latestEntry }) {
  const map = readAll();
  map[tag] = { names, latestEntry, publishedAt: Date.now() };
  writeAll(map);
}

// Pure diff: what's new, what's gone, comparing two filename lists.
export function diffNames(prevNames, currentNames) {
  const prevSet = new Set(prevNames);
  const currSet = new Set(currentNames);
  const added = currentNames.filter((n) => !prevSet.has(n));
  const removed = prevNames.filter((n) => !currSet.has(n));
  return { added, removed };
}
