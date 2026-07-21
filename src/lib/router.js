/* ------------------------------------------------------------------ *
 * Routes a dropped file to a tag. One deterministic rule, checked in
 * order — no fallbacks beyond this order, no guessing:
 *   1. Its folder name (top-level, from the zip path) matches a known
 *      tag, case-insensitively -> that tag. Remembers the match.
 *   2. Else the filename was assigned to a tag before (memory) -> that
 *      tag, as long as the tag still exists.
 *   3. Else -> "Unsorted", for a person to assign by hand.
 * ------------------------------------------------------------------ */
import { getTagForFile, rememberTag } from "./memory.js";

export const UNSORTED = "Unsorted";

function topFolder(path) {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : null;
}

export function routeFile(file, tags) {
  const folder = topFolder(file.path);
  if (folder) {
    const match = tags.find((t) => t.toLowerCase() === folder.toLowerCase());
    if (match) {
      rememberTag(file.name, match);
      return match;
    }
  }
  const remembered = getTagForFile(file.name);
  if (remembered && tags.includes(remembered)) return remembered;
  return UNSORTED;
}
