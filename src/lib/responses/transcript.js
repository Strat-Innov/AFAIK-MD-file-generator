/* ------------------------------------------------------------------ *
 * ChatTranscript parser — deterministic, lossless.
 *
 * Designed from the real AFAIK exports (September 2026, 12 files, 55
 * sessions; see scripts/analyze-session-exports.mjs). What they showed:
 *
 *   Agent says: <text>;User says: <text>;Agent says: <text>;
 *
 *  - Every entry is "<Speaker> says: <text>;" — one space after the
 *    colon, a ";" terminating every entry including the last, entries
 *    joined with nothing between them, no line breaks.
 *  - Only two speakers occur: "User says" and "Agent says".
 *  - "Bot said:" is NOT a speaker. It appears only as the start of an
 *    Agent entry's text ("Agent says: Bot said:Hi!…") and stays part of
 *    that message.
 *  - The Turns column equals the number of entries in every session,
 *    which gives the parser an independent check.
 *
 * Guarantees:
 *  - Every character of the transcript belongs to exactly one entry:
 *    joining `entries[].source` reproduces the transcript byte-for-byte.
 *  - `text` is the message exactly as exported — only the marker in
 *    front and the ";" terminator behind are removed. No trimming.
 *  - Nothing is dropped. Text before the first marker, or a transcript
 *    with no marker at all, becomes an UNPARSED entry. A speaker-shaped
 *    label that is not a known speaker becomes an UNKNOWN entry.
 * ------------------------------------------------------------------ */

export const SPEAKER = Object.freeze({
  USER: "USER",
  AGENT: "AGENT",
  UNKNOWN: "UNKNOWN",   // "<Label> says:" at an entry boundary, label not recognised
  UNPARSED: "UNPARSED", // text that no marker introduces
});

/* Recognised markers. Add a spelling here if a future export uses one;
 * the report script lists every marker actually present. */
export const KNOWN_MARKERS = Object.freeze({
  "User says": SPEAKER.USER,
  "Agent says": SPEAKER.AGENT,
});

export const PARSE_STATUS = Object.freeze({
  OK: "OK",
  NO_TRANSCRIPT: "NO_TRANSCRIPT",       // empty ChatTranscript
  PARSE_MISMATCH: "PARSE_MISMATCH",     // entry count ≠ Turns column
  UNKNOWN_SPEAKER: "UNKNOWN_SPEAKER",   // an unrecognised speaker label
  UNPARSED_CONTENT: "UNPARSED_CONTENT", // text outside any entry
});

// Precedence when several apply: the most fundamental problem first.
const STATUS_ORDER = [
  PARSE_STATUS.NO_TRANSCRIPT, PARSE_STATUS.PARSE_MISMATCH,
  PARSE_STATUS.UNKNOWN_SPEAKER, PARSE_STATUS.UNPARSED_CONTENT,
];

/* A marker is a short "<Label> says:" / "<Label> said:" at the start of
 * the transcript or straight after an entry's ";". Anything after
 * "says:" mid-message (e.g. "Bot said:" inside an Agent entry) is not at
 * a boundary and is left alone. One following space is part of the
 * marker, as every real entry has exactly one. */
const MARKER = /(^|;)([A-Za-z][A-Za-z ]{0,30}? (?:says|said)):( ?)/g;

/**
 * @param transcript  the ChatTranscript cell, exactly as imported
 * @param turns       the Turns column as a number, or null if absent
 * @returns {{ entries, parseStatus, parseFlags }}
 *   entries: [{ index (1-based turn number, null for UNPARSED), speaker,
 *               marker, text, source, start, end }]
 */
export function parseTranscript(transcript, turns = null) {
  const t = transcript ?? "";
  if (t === "") return { entries: [], parseStatus: PARSE_STATUS.NO_TRANSCRIPT, parseFlags: [PARSE_STATUS.NO_TRANSCRIPT] };

  const markers = [];
  let m;
  MARKER.lastIndex = 0;
  while ((m = MARKER.exec(t))) {
    const at = m.index + m[1].length;
    markers.push({ at, label: m[2], textStart: MARKER.lastIndex });
  }

  const entries = [];
  const flags = new Set();

  if (markers.length === 0 || markers[0].at > 0) {
    const end = markers.length ? markers[0].at : t.length;
    entries.push({ index: null, speaker: SPEAKER.UNPARSED, marker: null, text: t.slice(0, end), source: t.slice(0, end), start: 0, end });
    flags.add(PARSE_STATUS.UNPARSED_CONTENT);
  }

  markers.forEach((mk, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].at : t.length;
    // The ";" terminator is part of the entry's source, not its text.
    // The next marker starts right after it; the last entry keeps its
    // own trailing ";" if the export wrote one.
    const textEnd = t[end - 1] === ";" && end > mk.textStart ? end - 1 : end;
    const speaker = KNOWN_MARKERS[mk.label] ?? SPEAKER.UNKNOWN;
    if (speaker === SPEAKER.UNKNOWN) flags.add(PARSE_STATUS.UNKNOWN_SPEAKER);
    entries.push({
      index: null,
      speaker,
      marker: mk.label,
      text: t.slice(mk.textStart, textEnd),
      source: t.slice(mk.at, end),
      start: mk.at,
      end,
    });
  });

  let n = 0;
  for (const e of entries) if (e.speaker !== SPEAKER.UNPARSED) e.index = ++n;

  if (turns !== null && turns !== n) flags.add(PARSE_STATUS.PARSE_MISMATCH);

  const parseFlags = STATUS_ORDER.filter((s) => flags.has(s));
  return { entries, parseStatus: parseFlags[0] ?? PARSE_STATUS.OK, parseFlags };
}
