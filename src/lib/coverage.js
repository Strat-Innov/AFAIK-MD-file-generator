/* ------------------------------------------------------------------ *
 * The validation gate. An optimized document is publishable only when
 * every meaningful unit of source information is represented in it.
 *
 *   Source ASPX -> source units ─┐
 *                                ├─> compare (normalized) -> PASS/FAIL
 *   Optimized MD ────────────────┘
 *
 * Reports counts plus the actual missing values, so a failure is
 * diagnosable rather than a bare `valid = false`.
 * ------------------------------------------------------------------ */

import { normalize, sourceUnits, renderedFragments } from "./contentUnits.js";

export function validateCoverage(doc, optimizedMd) {
  const units = sourceUnits(doc);
  const haystack = normalize(optimizedMd);

  const missing = [];
  for (const [normalized, original] of units) {
    if (!haystack.includes(normalized)) missing.push(original);
  }

  // Content present in the optimized document that cannot be traced
  // back to a source value — the tripwire for invented or paraphrased
  // text. Every string the renderer emits comes verbatim from the
  // source, so anything here is a defect.
  const sourceHaystack = normalize([...units.values()].join("\n"));
  const unmatched = [];
  for (const fragment of renderedFragments(optimizedMd)) {
    const n = normalize(fragment);
    if (!n || !/[\p{L}\p{N}]/u.test(n)) continue;
    if (!sourceHaystack.includes(n) && !unmatched.includes(fragment)) unmatched.push(fragment);
  }

  return {
    status: missing.length === 0 ? "PASS" : "FAIL",
    sourceUnitCount: units.size,
    representedUnitCount: units.size - missing.length,
    missing,
    unmatched,
  };
}

// The inspectable report from the task brief — plain text, safe to log,
// safe to show in the UI, safe to paste into a bug report.
export function formatReport(result, label = "") {
  const head = ["VALIDATION", "----------", label ? `File: ${label}` : "", `Status: ${result.status}`, ""].filter((l) => l !== "");
  const body = [
    `Source content units: ${result.sourceUnitCount}`,
    `Represented content units: ${result.representedUnitCount}`,
    `Missing units: ${result.missing.length}`,
    `Unmatched units: ${result.unmatched.length}`,
  ];
  const detail = [];
  if (result.missing.length) {
    detail.push("", "Missing content:", ...result.missing.map((m) => `- ${JSON.stringify(m)}`));
  }
  if (result.unmatched.length) {
    detail.push("", "Unmatched content (present in output, not traceable to source):", ...result.unmatched.map((m) => `- ${JSON.stringify(m)}`));
  }
  return [...head, ...body, ...detail].join("\n");
}
