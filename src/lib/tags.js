/* ------------------------------------------------------------------ *
 * Tag list — the fixed-but-editable set of buckets. Tiny (a handful
 * of strings), so this never comes near the localStorage quota.
 * ------------------------------------------------------------------ */

const KEY = "afaik-tags-v1";
const DEFAULT_TAGS = ["PROJECT PLAYBOOK", "TOWNSHIP PAGES", "LIFE AT FAI PAGE", "NAVIGATION PAGES", "LOCATORS"];

function readTags() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [...DEFAULT_TAGS];
  return JSON.parse(raw); // corrupt JSON throws — fail fast
}

function writeTags(tags) {
  localStorage.setItem(KEY, JSON.stringify(tags));
}

export function getTags() {
  return readTags();
}

export function addTag(name) {
  const tag = name.trim();
  if (!tag) throw new Error("Tag name can't be empty.");
  const tags = readTags();
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) throw new Error(`Tag "${tag}" already exists.`);
  writeTags([...tags, tag]);
}

export function renameTag(oldName, newName) {
  const name = newName.trim();
  if (!name) throw new Error("Tag name can't be empty.");
  const tags = readTags();
  const idx = tags.findIndex((t) => t === oldName);
  if (idx === -1) throw new Error(`No tag named "${oldName}".`);
  if (tags.some((t, i) => i !== idx && t.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Tag "${name}" already exists.`);
  }
  tags[idx] = name;
  writeTags(tags);
}

export function removeTag(name) {
  const tags = readTags();
  const next = tags.filter((t) => t !== name);
  if (next.length === tags.length) throw new Error(`No tag named "${name}".`);
  if (next.length === 0) throw new Error("At least one tag must remain.");
  writeTags(next);
}
