/* ------------------------------------------------------------------ *
 * The validation gate. An optimized document is publishable only when
 * every meaningful unit of source information is represented in it.
 *
 *   Source ASPX -> source units ─┐
 *                                ├─> assign (token spans) ─> PASS/FAIL
 *   Optimized MD -> lines ───────┘
 *
 * Why assignment rather than a substring search:
 *
 * Each source unit must claim its own run of whole tokens in some
 * rendered line, and no two units may claim the same tokens. A plain
 * `includes()` check passed a page that had genuinely lost its
 * "LEASING" and "PROJECT DEVELOPMENT" headings, because those strings
 * also occur inside "subleasing/assignment" and inside a person's
 * "Project Development Specialist" role. Token runs defeat the first
 * (subleasing is one token, not two), and the disjointness rule
 * defeats the second — the role's tokens are claimed by the role unit,
 * so the heading unit has nothing left to match and is correctly
 * reported missing.
 *
 * Disjointness is also what makes a legitimately composite line work:
 * "Name — Role — email" carries three units on three non-overlapping
 * spans, so all three are satisfied by the one line.
 *
 * Tokens left unclaimed after assignment are content the output
 * asserts but no source value backs — the tripwire for invented text
 * and for fusion (a fused "ClubPrivate" is a token no unit can claim).
 * ------------------------------------------------------------------ */

import { tokenize, sourceUnits, renderedLines, derivedTitleLine } from "./contentUnits.js";

// First run of `needle` inside `hay` whose positions are all still
// free, scanning left to right.
function findFreeSpan(hay, needle, taken) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (taken[i + j] || hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function validateCoverage(doc, optimizedMd, { pageName = "" } = {}) {
  const units = sourceUnits(doc);
  const unitTokenStrings = [...units.keys()].map((k) => ` ${k} `);

  // A title equal to the file name is scaffolding ONLY when nothing in
  // the source backs it. ARBORAGE.aspx genuinely has "ARBORAGE" as its
  // heading, and dropping that line made a real unit unmatchable.
  const derived = derivedTitleLine(pageName);
  const derivedKey = derived ? tokenize(derived).join(" ") : "";
  const dropDerivedTitle = !!derived && !units.has(derivedKey);

  const lines = renderedLines(optimizedMd).filter((l) => !(dropDerivedTitle && l === derived));
  const lineTokens = lines.map(tokenize);
  const taken = lineTokens.map((t) => new Array(t.length).fill(false));

  // Longest units first: they are the most constrained, and letting a
  // short unit consume tokens a long one needs would produce a false
  // failure. Ties break on the token key so the result is deterministic.
  const entries = [...units.entries()]
    .map(([key, original]) => ({ key, original, tokens: tokenize(original) }))
    .sort((a, b) => b.tokens.length - a.tokens.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const missing = [];
  for (const unit of entries) {
    let placed = false;
    for (let li = 0; li < lineTokens.length && !placed; li++) {
      const at = findFreeSpan(lineTokens[li], unit.tokens, taken[li]);
      if (at < 0) continue;
      for (let j = 0; j < unit.tokens.length; j++) taken[li][at + j] = true;
      placed = true;
    }
    if (!placed) missing.push(unit.original);
  }

  // Leftover tokens are only a finding if NO source unit contains them.
  // Source units are deduplicated, but the renderer legitimately repeats
  // a value — two people can share the role "Project Development
  // Manager", "Learn more" can caption several images — and the second
  // occurrence has no unclaimed unit left to take it. That is a repeat,
  // not untraceable content. A genuinely invented or fused string (the
  // token "clubprivate" from a fused list item) appears in no unit at
  // all, and is still reported.
  // A leftover run is a repeat if every token in it is accounted for by
  // some source unit. The run may span several units — a whole person
  // line repeated in a second People web part covers a name unit, a
  // role unit and an email unit — so it is tiled greedily, longest
  // piece first, rather than tested against one unit as a whole.
  // Anything left untileable is a token no source value contains: an
  // invented phrase, or the seam of a fusion ("clubprivate").
  const explainable = (run) => {
    for (let i = 0; i < run.length; ) {
      let best = 0;
      for (let len = run.length - i; len >= 1; len--) {
        const piece = ` ${run.slice(i, i + len).join(" ")} `;
        if (unitTokenStrings.some((u) => u.includes(piece))) { best = len; break; }
      }
      if (!best) return false;
      i += best;
    }
    return true;
  };

  const unmatched = [];
  for (let li = 0; li < lineTokens.length; li++) {
    let run = [];
    const flush = () => {
      if (run.length && !explainable(run)) unmatched.push({ line: lines[li], tokens: run });
      run = [];
    };
    for (let i = 0; i < lineTokens[li].length; i++) {
      if (taken[li][i]) flush();
      else run.push(lineTokens[li][i]);
    }
    flush();
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
    detail.push("", "Unmatched content (present in output, not traceable to source):",
      ...result.unmatched.map((u) => `- ${JSON.stringify(u.tokens.join(" "))} in ${JSON.stringify(u.line)}`));
  }
  return [...head, ...body, ...detail].join("\n");
}
