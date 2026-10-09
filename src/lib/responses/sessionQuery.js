/* ------------------------------------------------------------------ *
 * Search, filter and sort over raw sessions — a read-only view.
 *
 * Returns new arrays and never touches the session records, so the
 * Raw Sessions table can re-query freely without any risk to Layer 1.
 * ------------------------------------------------------------------ */

export const RESOLVED_FILTER = Object.freeze({ ALL: "all", RESOLVED: "resolved", UNRESOLVED: "unresolved", UNKNOWN: "unknown" });

export const DEFAULT_FILTERS = Object.freeze({
  text: "",
  dateFrom: "", // YYYY-MM-DD, inclusive, UTC
  dateTo: "",   // YYYY-MM-DD, inclusive, UTC
  channel: "",
  outcome: "",
  resolved: RESOLVED_FILTER.ALL,
  sourceFile: "",
});

// Fields the free-text search looks in. SessionId is included so a
// reviewer can find a session they were given an ID for, even while
// the ID column is hidden.
const SEARCH_FIELDS = ["sessionId", "transcript", "initialUserMessage", "topicName", "outcome", "outcomeReason", "comments", "channel"];

/** Distinct non-empty values of a field, sorted, for filter menus. */
export function facetValues(sessions, field) {
  const values = new Set();
  for (const s of sessions) {
    if (field === "sourceFile") for (const o of s.occurrences) values.add(o.filename);
    else if (s[field]) values.add(s[field]);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function filterSessions(sessions, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const needle = f.text.trim().toLowerCase();
  return sessions.filter((s) => {
    if (needle && !SEARCH_FIELDS.some((k) => String(s[k] ?? "").toLowerCase().includes(needle))) return false;
    if (f.channel && s.channel !== f.channel) return false;
    if (f.outcome && s.outcome !== f.outcome) return false;
    if (f.sourceFile && !s.occurrences.some((o) => o.filename === f.sourceFile)) return false;
    if (f.resolved === RESOLVED_FILTER.RESOLVED && s.resolved !== true) return false;
    if (f.resolved === RESOLVED_FILTER.UNRESOLVED && s.resolved !== false) return false;
    if (f.resolved === RESOLVED_FILTER.UNKNOWN && s.resolved !== null) return false;
    // A session whose date could not be read cannot be shown to fall
    // inside a range, so a date filter excludes it.
    if (f.dateFrom || f.dateTo) {
      const day = s.timestamp?.slice(0, 10);
      if (!day) return false;
      if (f.dateFrom && day < f.dateFrom) return false;
      if (f.dateTo && day > f.dateTo) return false;
    }
    return true;
  });
}

export const SORT_KEYS = Object.freeze({
  timestamp: (s) => s.timestamp ?? "",
  outcome: (s) => s.outcome.toLowerCase(),
  channel: (s) => s.channel.toLowerCase(),
  csat: (s) => (s.csat.trim() === "" || Number.isNaN(Number(s.csat)) ? null : Number(s.csat)),
  turns: (s) => s.turns,
  sourceFile: (s) => s.occurrences[0].filename.toLowerCase(),
  question: (s) => s.initialUserMessage.toLowerCase(),
});

/* Stable, and empty values always sort last whichever way the column
 * is sorted — a blank CSAT is "no rating", not "lowest rating". */
export function sortSessions(sessions, key = "timestamp", direction = "desc") {
  const read = SORT_KEYS[key];
  if (!read) throw new Error(`Unknown sort key "${key}".`);
  const sign = direction === "asc" ? 1 : -1;
  const isEmpty = (v) => v === null || v === "";
  return sessions
    .map((s, i) => ({ s, i, v: read(s) }))
    .sort((a, b) => {
      if (isEmpty(a.v) !== isEmpty(b.v)) return isEmpty(a.v) ? 1 : -1;
      if (!isEmpty(a.v) && a.v !== b.v) return (a.v < b.v ? -1 : 1) * sign;
      return a.i - b.i;
    })
    .map((x) => x.s);
}
