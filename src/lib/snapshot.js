/* ------------------------------------------------------------------ *
 * Caches the most recent changelog entry per tag — both the flat
 * published text (used by the detailed Changelog tab, always complete)
 * and the structured changes it was built from (used to render a
 * filtered "highlights" view locally, so changing the visibility
 * toggle later doesn't require re-publishing). Tiny, one entry per tag.
 * Bucket membership is session-only, so this is never used to decide
 * whether a file was added or removed — see App.jsx.
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

export function setSnapshot(tag, { latestEntry, latestChanges }) {
  const map = readAll();
  map[tag] = { latestEntry, latestChanges, publishedAt: Date.now() };
  writeAll(map);
}
