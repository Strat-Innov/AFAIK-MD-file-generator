/* ------------------------------------------------------------------ *
 * Controls which web part types show up in the Preview panel and the
 * per-bucket changelog highlights. Display-only — the full changelog
 * published to GitHub (buildEntry in github.js) never reads this and
 * always contains every change, regardless of these settings.
 * ------------------------------------------------------------------ */

const KEY = "afaik-webpart-visibility-v1";

function readAll() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return {};
  return JSON.parse(raw); // corrupt JSON throws — fail fast
}

// Default: visible unless explicitly turned off.
export function isVisible(type) {
  return readAll()[type] !== false;
}

export function getVisibilityMap() {
  return readAll();
}

export function setVisible(type, visible) {
  const map = readAll();
  map[type] = visible;
  localStorage.setItem(KEY, JSON.stringify(map));
}
