/* ------------------------------------------------------------------ *
 * AI-assisted consolidation — optional.
 *
 * One narrow task: given the initial groups (exact-match), decide which
 * ask for the same information, and write one clean question for each
 * resulting group. Nothing else — no answering, no answer judging, no
 * taxonomy. The answer excerpt is context only, e.g. to see that "give
 * me the links" was about the Operations OMS.
 *
 * The reply names initial-group IDs only. The app expands them to QA IDs
 * and derives counts and answer status itself (consolidate.js), so the
 * model cannot drop, duplicate or invent a question.
 *
 * How the prompt reaches Claude is up to the user: copy it into Claude
 * and paste the reply back. Nothing is sent automatically, and the
 * export never waits for this step.
 * ------------------------------------------------------------------ */

import { PART_KIND } from "../qa.js";

export const PROMPT_MARKER = "You are helping maintain AFAIK";
const EXCERPT_LENGTH = 300;

// FNV-1a, 32-bit: an identity for "this exact set of groups", so a reply
// made for a different import cannot be applied by mistake.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function answerExcerpt(members) {
  for (const r of members) {
    const part = r.answerParts.find((p) => p.kind === PART_KIND.NORMAL || p.kind === PART_KIND.TRUNCATED);
    if (part) return part.text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH);
  }
  return "(no usable reply)";
}

/** @returns { packageId, items: [{ groupId, question, askedTimes, answerExcerpt }] } */
export function buildConsolidationRequest(records, initialGroups) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const items = initialGroups.map((g) => {
    const members = g.qaIds.map((id) => byId.get(id));
    return { groupId: g.groupId, question: members[0].question.trim(), askedTimes: members.length, answerExcerpt: answerExcerpt(members) };
  });
  const packageId = `PKG-${fnv1a(JSON.stringify(initialGroups.map((g) => [g.groupId, g.qaIds])))}`;
  return { packageId, items };
}

export function renderConsolidationPrompt(request) {
  return `${PROMPT_MARKER}, an internal knowledge agent. Below are real questions employees asked AFAIK. Identical questions are already grouped; each line is one group.

TASK: find the groups that ask for the SAME information, and write one clean question for each resulting set.

RULES
1. Merge groups when they ask for the same information, however they are worded ("South Station 1BR price?" and "How much does a 1-BR unit cost at South Station Transport Terminal?" → one question).
2. Do NOT merge groups just because they mention the same project, person or topic. "What is Mimosa Plus?", "What is the land area of Mimosa Plus?" and "Who is the PD of Mimosa Plus?" stay separate.
3. cleanQuestion: one clear, complete question in plain English that keeps the original meaning. Do not answer it, and do not add information that is not in the originals.
4. The answer excerpt is only context for what was being asked. Do not judge it.
5. Every groupId appears in exactly one entry. A group that matches nothing is an entry of its own.
6. Reply with ONE JSON object and nothing else, in this form:
{"packageId": "${request.packageId}", "questions": [{"cleanQuestion": "…", "groupIds": ["IG-001", "IG-007"]}]}

GROUPS (${request.items.length})
${JSON.stringify(request.items, null, 1)}
`;
}

/**
 * Checks a pasted reply. All-or-nothing.
 * @returns { ok, errors, warnings, coverage: { expected, assigned, missing[], duplicated[], unknown[] }, questions: [{ cleanQuestion, groupIds }] }
 */
export function validateConsolidationReply(text, request) {
  const expected = request.items.map((i) => i.groupId);
  const coverage = { expected: expected.length, assigned: 0, missing: [], duplicated: [], unknown: [] };
  const warnings = [];
  const fail = (errors) => ({ ok: false, errors, warnings, coverage, questions: [] });

  const raw = String(text ?? "").trim();
  if (!raw) return fail(["Paste Claude's reply first."]);
  if (raw.includes(PROMPT_MARKER) || (raw.includes('"answerExcerpt"') && !raw.includes('"cleanQuestion"'))) {
    return fail(["That is the prompt, not Claude's reply. Paste the prompt into Claude, then paste what Claude answers here."]);
  }
  let body = raw;
  const fence = /^```(?:json)?\s*\n([\s\S]*)\n```$/i.exec(body);
  if (fence) { body = fence[1].trim(); warnings.push("Removed a Markdown code fence around the reply."); }
  let value;
  try {
    value = JSON.parse(body);
  } catch (e) {
    return fail([`Claude's reply is not valid JSON (${e.message}). Ask Claude to reply with the JSON only.`]);
  }
  if (!value || typeof value !== "object" || !Array.isArray(value.questions) || value.questions.length === 0) {
    return fail(["The reply has no \"questions\" list."]);
  }

  const errors = [];
  if (value.packageId !== request.packageId) {
    errors.push(`The reply is for a different set of questions (${value.packageId ?? "no packageId"}; current ${request.packageId}). Copy the prompt again and ask Claude again.`);
  }
  const counts = new Map();
  value.questions.forEach((q, n) => {
    if (!q || typeof q.cleanQuestion !== "string" || !q.cleanQuestion.trim()) errors.push(`Entry ${n + 1} has no cleanQuestion.`);
    if (!Array.isArray(q?.groupIds) || q.groupIds.length === 0) { errors.push(`Entry ${n + 1} has no groupIds.`); return; }
    for (const g of q.groupIds) counts.set(g, (counts.get(g) ?? 0) + 1);
  });
  const known = new Set(expected);
  for (const [g, n] of counts) {
    if (!known.has(g)) coverage.unknown.push(String(g));
    if (n > 1) coverage.duplicated.push(String(g));
  }
  coverage.missing = expected.filter((g) => !counts.has(g));
  coverage.assigned = expected.length - coverage.missing.length;
  if (coverage.missing.length) errors.push(`Missing group(s): ${coverage.missing.join(", ")}.`);
  if (coverage.duplicated.length) errors.push(`Group(s) used more than once: ${coverage.duplicated.join(", ")}.`);
  if (coverage.unknown.length) errors.push(`Unknown group(s): ${coverage.unknown.join(", ")}.`);
  if (errors.length) return fail(errors);

  return {
    ok: true, errors: [], warnings, coverage,
    questions: value.questions.map((q) => ({ cleanQuestion: q.cleanQuestion.trim(), groupIds: [...q.groupIds] })),
  };
}
