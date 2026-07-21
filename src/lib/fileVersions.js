/* ------------------------------------------------------------------ *
 * Tracks each file's own content-version history (People/Quick Links/
 * etc. changes), independent of which bucket it's sorted into. First
 * time a file is seen is "Version 1" — everything currently in it
 * shows as the baseline. Only filenames + tiny extracted item lists
 * are stored, never raw HTML, so this stays small regardless of file
 * count.
 *
 * Split into check (pure) and commit (persists) so a file's version
 * only actually advances after the changelog entry describing it was
 * successfully published — mirrors snapshot.js's same discipline.
 * ------------------------------------------------------------------ */

import { extractStructuredContent, diffStructuredContent } from "./webparts.js";

const KEY = "afaik-file-versions-v1";

function readAll() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return {};
  return JSON.parse(raw); // corrupt JSON throws — fail fast
}

function writeAll(map) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function getFileVersion(filename) {
  return readAll()[filename] || null;
}

// Pure — computes what would change without persisting anything.
// Returns:
//   null                        — nothing recognized, or nothing changed
//   { stale: true, ... }        — incoming file isn't newer than what's on
//                                  record; skipped so a rolled-back/re-
//                                  uploaded old copy can't fake a "change"
//   { version, changes, parts, modifiedAt } — a real, validated change
export function checkFileVersion(filename, rawContent, modifiedAt) {
  const parts = extractStructuredContent(rawContent);
  if (parts.length === 0) return null;
  const prev = getFileVersion(filename);

  if (prev && modifiedAt != null && prev.modifiedAt != null && modifiedAt <= prev.modifiedAt) {
    return { stale: true, recordedAt: prev.modifiedAt, incomingAt: modifiedAt };
  }

  const changes = diffStructuredContent(prev?.parts || [], parts);
  if (prev && changes.length === 0) return null;
  return { version: (prev?.version || 0) + 1, changes, parts, modifiedAt };
}

// Call only after the changelog entry describing this version was
// actually published successfully.
export function commitFileVersion(filename, version, parts, modifiedAt) {
  const map = readAll();
  map[filename] = { version, parts, modifiedAt };
  writeAll(map);
}
