/* ------------------------------------------------------------------ *
 * Filename -> tag memory. This is what lets a loose file (no folder)
 * get auto-sorted the same way it was sorted last time. Stores only
 * names, never file content, so it stays tiny regardless of how many
 * files have ever passed through.
 * ------------------------------------------------------------------ */

const KEY = "afaik-file-tag-memory-v1";

function readMap() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return {};
  return JSON.parse(raw); // corrupt JSON throws — fail fast
}

function writeMap(map) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function getTagForFile(filename) {
  return readMap()[filename] || null;
}

// All remembered mappings, for the editable Memory Log view.
export function listMemory() {
  return Object.entries(readMap()).map(([filename, tag]) => ({ filename, tag }));
}

export function rememberTag(filename, tag) {
  const map = readMap();
  map[filename] = tag;
  writeMap(map);
}

export function forgetTag(filename) {
  const map = readMap();
  delete map[filename];
  writeMap(map);
}

// Keep memory consistent when a tag is renamed in tags.js
export function renameTagEverywhere(oldTag, newTag) {
  const map = readMap();
  for (const k of Object.keys(map)) if (map[k] === oldTag) map[k] = newTag;
  writeMap(map);
}

// Keep memory consistent when a tag is deleted in tags.js
export function clearTagEverywhere(tag) {
  const map = readMap();
  for (const k of Object.keys(map)) if (map[k] === tag) delete map[k];
  writeMap(map);
}
