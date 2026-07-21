/* ------------------------------------------------------------------ *
 * Caches the most recent changelog entry per tag, so a bucket tab can
 * show "what changed last time" without re-fetching from GitHub. Tiny,
 * one entry per tag — this is a display cache only, not used to decide
 * whether a file was added or removed (bucket membership is session-
 * only, so it's never a reliable signal for that; see App.jsx).
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

export function setSnapshot(tag, { latestEntry }) {
  const map = readAll();
  map[tag] = { latestEntry, publishedAt: Date.now() };
  writeAll(map);
}
