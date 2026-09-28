/* ------------------------------------------------------------------ *
 * Response Consolidator — Layer 2: EXTRACTED Q&A.
 *
 * A deterministic reading of Layer 1. No AI, no rewriting:
 *
 *  - One QARecord per User message. The question is that message's
 *    text exactly as exported.
 *  - The answer is every Agent entry after it, up to the next User
 *    message, kept as ordered parts, each exactly as exported. Parts are
 *    never joined here.
 *  - Agent entries before the first User message are the session's
 *    PREAMBLE (greeting, unavailable notice) and belong to no question.
 *  - InitialUserMessage is carried as reference metadata only. The real
 *    exports showed it empty in 26 sessions and pointing at a later
 *    user message in one, so the transcript is authoritative.
 *  - Answer status comes from the transcript text, never from
 *    SessionOutcome: "agent unavailable" occurred under Unengaged,
 *    Resolved, Escalated and Abandoned alike.
 *
 * Derived, never stored: it is recomputed from the raw sessions, so it
 * can't drift from them and never writes back into them.
 * ------------------------------------------------------------------ */

import { parseTranscript, SPEAKER, PARSE_STATUS } from "./transcript.js";

export const ANSWER_STATUS = Object.freeze({
  ANSWERED: "ANSWERED",
  AGENT_UNAVAILABLE: "AGENT_UNAVAILABLE",
  NO_RESPONSE: "NO_RESPONSE",
  REDACTED: "REDACTED",
  TRUNCATED: "TRUNCATED",
});

/* What each status means for the knowledge pipeline. A truncated or
 * redacted answer still shows the question was asked and can inform
 * intent grouping, but it is not evidence of what the full answer is. */
export const STATUS_METADATA = Object.freeze({
  [ANSWER_STATUS.ANSWERED]: { isCompleteAnswer: true, isUsableAsAnswerEvidence: true, requiresReview: false },
  [ANSWER_STATUS.TRUNCATED]: { isCompleteAnswer: false, isUsableAsAnswerEvidence: false, requiresReview: true },
  [ANSWER_STATUS.REDACTED]: { isCompleteAnswer: false, isUsableAsAnswerEvidence: false, requiresReview: true },
  [ANSWER_STATUS.AGENT_UNAVAILABLE]: { isCompleteAnswer: false, isUsableAsAnswerEvidence: false, requiresReview: false },
  [ANSWER_STATUS.NO_RESPONSE]: { isCompleteAnswer: false, isUsableAsAnswerEvidence: false, requiresReview: true },
});

/* Part-level conditions, each fixed to what the real exports show.
 *
 * TRUNCATED: the exporter caps a message at ~500 characters and appends
 * "...". All 22 cut messages were 490–506 characters long and ended in
 * "..."; no other message was longer than 480. Both conditions are
 * required — a long answer alone, or a short one ending in an
 * ellipsis, is not truncation.
 *
 * REDACTED: the whole message is the literal "[REDACTED]".
 *
 * UNAVAILABLE: the platform's usage-limit notice ("This agent is
 * currently unavailable. It has reached its usage limit. …"), the one
 * variant seen in 57 messages. */
export const TRUNCATION_MIN_LENGTH = 480;
export const TRUNCATION_SUFFIX = "...";
export const REDACTION_TEXT = "[REDACTED]";
const UNAVAILABLE = [/\bcurrently unavailable\b/i, /\busage limit\b/i];

export const PART_KIND = Object.freeze({
  NORMAL: "NORMAL",
  TRUNCATED: "TRUNCATED",
  REDACTED: "REDACTED",
  UNAVAILABLE: "UNAVAILABLE",
});

export function classifyPart(text) {
  const body = text.trim();
  if (body === REDACTION_TEXT) return PART_KIND.REDACTED;
  if (UNAVAILABLE.every((re) => re.test(body))) return PART_KIND.UNAVAILABLE;
  if (body.endsWith(TRUNCATION_SUFFIX) && body.length >= TRUNCATION_MIN_LENGTH) return PART_KIND.TRUNCATED;
  return PART_KIND.NORMAL;
}

/* One status for the whole answer, most restrictive first:
 *  - no parts                          -> NO_RESPONSE
 *  - any part redacted                 -> REDACTED   (content withheld)
 *  - any part truncated                -> TRUNCATED  (content incomplete)
 *  - every part is the unavailable notice -> AGENT_UNAVAILABLE
 *  - otherwise                         -> ANSWERED
 * An unavailable notice beside a real reply leaves the reply ANSWERED;
 * the notice stays visible as its own part. */
export function answerStatusOf(parts) {
  if (parts.length === 0) return ANSWER_STATUS.NO_RESPONSE;
  const kinds = parts.map((p) => p.kind);
  if (kinds.includes(PART_KIND.REDACTED)) return ANSWER_STATUS.REDACTED;
  if (kinds.includes(PART_KIND.TRUNCATED)) return ANSWER_STATUS.TRUNCATED;
  if (kinds.every((k) => k === PART_KIND.UNAVAILABLE)) return ANSWER_STATUS.AGENT_UNAVAILABLE;
  return ANSWER_STATUS.ANSWERED;
}

const qaId = (n) => `QA-${String(n).padStart(4, "0")}`;

/**
 * Parses every session and extracts its Q&A records.
 *
 * @param sessions  workspace.sessions (Layer 1, frozen)
 * @returns {{ records, parsedSessions }}
 *   records         QARecord[], in session order then question order
 *   parsedSessions  [{ sessionRecordId, entries, parseStatus, parseFlags, preamble }]
 */
export function extractQA(sessions) {
  const records = [];
  const parsedSessions = [];

  for (const s of sessions) {
    const { entries, parseStatus, parseFlags } = parseTranscript(s.transcript, s.turns);
    const firstUser = entries.findIndex((e) => e.speaker === SPEAKER.USER);
    const preamble = entries
      .slice(0, firstUser < 0 ? entries.length : firstUser)
      .filter((e) => e.speaker === SPEAKER.AGENT)
      .map((e) => ({ turnNumber: e.index, text: e.text, kind: classifyPart(e.text) }));
    parsedSessions.push(Object.freeze({ sessionRecordId: s.id, entries, parseStatus, parseFlags, preamble }));

    let questionNumber = 0;
    entries.forEach((e, i) => {
      if (e.speaker !== SPEAKER.USER) return;
      questionNumber++;
      const parts = [];
      const skipped = []; // UNKNOWN / UNPARSED entries inside this answer's span
      for (let j = i + 1; j < entries.length && entries[j].speaker !== SPEAKER.USER; j++) {
        const next = entries[j];
        if (next.speaker === SPEAKER.AGENT) parts.push({ turnNumber: next.index, text: next.text, kind: classifyPart(next.text) });
        else skipped.push({ turnNumber: next.index, speaker: next.speaker, marker: next.marker, text: next.text });
      }
      const answerStatus = answerStatusOf(parts);
      records.push(Object.freeze({
        id: qaId(records.length + 1),
        sessionRecordId: s.id,
        sessionId: s.sessionId,
        sourceFiles: s.occurrences.map((o) => o.filename),
        sourceRows: s.occurrences.map((o) => ({ fileId: o.fileId, filename: o.filename, rowNumber: o.rowNumber })),
        timestamp: s.timestamp,
        timestampRaw: s.timestampRaw,
        channel: s.channel,
        sessionOutcome: s.outcome,
        outcomeReason: s.outcomeReason,
        resolvedImplied: s.resolved,
        initialUserMessage: s.initialUserMessage, // reference only
        turnNumber: e.index,
        questionNumber,
        question: e.text,
        answerParts: parts,
        answerStatus,
        ...STATUS_METADATA[answerStatus],
        otherContent: skipped,
        parseStatus,
        parseFlags,
      }));
    });
  }

  return { records, parsedSessions };
}

/** Headline numbers for summaries and the regression check. */
export function summarizeQA({ records, parsedSessions }) {
  const byStatus = Object.fromEntries(Object.values(ANSWER_STATUS).map((st) => [st, 0]));
  for (const r of records) byStatus[r.answerStatus]++;
  const bySession = new Map();
  for (const r of records) bySession.set(r.sessionRecordId, (bySession.get(r.sessionRecordId) ?? 0) + 1);
  return {
    records: records.length,
    byStatus,
    sessionsWithQuestions: bySession.size,
    multiQuestionSessions: [...bySession.values()].filter((n) => n > 1).length,
    multiPartAnswers: records.filter((r) => r.answerParts.length > 1).length,
    requiresReview: records.filter((r) => r.requiresReview).length,
    parseMismatches: parsedSessions.filter((p) => p.parseFlags.includes(PARSE_STATUS.PARSE_MISMATCH)).length,
    sessionsWithParseIssues: parsedSessions.filter((p) => p.parseStatus !== PARSE_STATUS.OK).length,
  };
}
