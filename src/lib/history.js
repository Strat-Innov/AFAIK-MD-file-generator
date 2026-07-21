/* ------------------------------------------------------------------ *
 * Changelog history — browser-only persistence (localStorage).
 * One job: store/retrieve/update/delete generated master files.
 * No fallbacks: a missing key means "no history yet" (valid, returns
 * []). Corrupt data or a full quota are real problems and are thrown,
 * not silently swallowed.
 * ------------------------------------------------------------------ */

const KEY = "afaik-history-v1";

function readAll() {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [];
  return JSON.parse(raw); // corrupt JSON throws — fail fast, don't reset user data
}

function writeAll(entries) {
  localStorage.setItem(KEY, JSON.stringify(entries)); // quota errors throw
}

export function listEntries() {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function getEntry(id) {
  const entry = readAll().find((e) => e.id === id);
  if (!entry) throw new Error(`No history entry with id ${id}`);
  return entry;
}

export function addEntry({ title, count, names, md }) {
  const entry = { id: crypto.randomUUID(), title, createdAt: Date.now(), count, names, md };
  writeAll([entry, ...readAll()]);
  return entry;
}

export function renameEntry(id, title) {
  const entries = readAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error(`No history entry with id ${id}`);
  entries[idx] = { ...entries[idx], title };
  writeAll(entries);
}

export function deleteEntry(id) {
  const entries = readAll();
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) throw new Error(`No history entry with id ${id}`);
  writeAll(next);
}

export function searchEntries(query) {
  const q = query.trim().toLowerCase();
  if (!q) return listEntries();
  return listEntries().filter(
    (e) => e.title.toLowerCase().includes(q) || e.names.some((n) => n.toLowerCase().includes(q))
  );
}
