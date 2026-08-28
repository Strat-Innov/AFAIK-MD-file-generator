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

import { tokenize, normalize, sourceModel, renderedLines, derivedTitleLine } from "./contentUnits.js";

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
  const { units, groups, pairs } = sourceModel(doc);
  const unitTokenStrings = [...units.keys()].map((k) => ` ${k} `);

  // A title equal to the file name is scaffolding ONLY when nothing in
  // the source backs it. ARBORAGE.aspx genuinely has "ARBORAGE" as its
  // heading, and dropping that line made a real unit unmatchable.
  const derived = derivedTitleLine(pageName);
  const derivedKey = derived ? tokenize(derived).join(" ") : "";
  const dropDerivedTitle = !!derived && !units.has(derivedKey);

  const derivedNorm = derived ? normalize(derived) : "";
  const lines = renderedLines(optimizedMd).filter((l) => !(dropDerivedTitle && normalize(l) === derivedNorm));
  const lineTokens = lines.map(tokenize);
  const taken = lineTokens.map((t) => new Array(t.length).fill(false));

  // Longest units first: they are the most constrained, and letting a
  // short unit consume tokens a long one needs would produce a false
  // failure. Ties break on the token key so the result is deterministic.
  const entries = [...units.entries()]
    .map(([key, original]) => ({ key, original, tokens: tokenize(original) }))
    .sort((a, b) => b.tokens.length - a.tokens.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const missing = [];
  const lineOf = new Map(); // unit key -> rendered line it was placed on
  for (const unit of entries) {
    let placed = false;
    for (let li = 0; li < lineTokens.length && !placed; li++) {
      const at = findFreeSpan(lineTokens[li], unit.tokens, taken[li]);
      if (at < 0) continue;
      for (let j = 0; j < unit.tokens.length; j++) taken[li][at + j] = true;
      lineOf.set(unit.key, li);
      placed = true;
    }
    if (!placed) missing.push(unit.original);
  }

  /* ---- ordering and association ----
   *
   * Presence is not meaning. "2-BR Platinum / 97-120 sqm / ₱25.5M" and
   * "2-BR Platinum / ₱25.5M / 97-120 sqm" contain identical tokens and
   * say different things, so the checks below look at *where* each unit
   * landed rather than only whether it landed.
   */
  const ordering = [];

  // Within an RTE block the source lines are prose a reader follows top
  // to bottom, so a correct rendering admits a monotonic placement: walk
  // the block's units in source order and each must be findable at or
  // after the previous one. A web part is a record — its fields have no
  // reading order — so only its position as a whole is constrained.
  const orderTaken = lineTokens.map((t) => new Array(t.length).fill(false));
  for (const group of groups) {
    if (!group.ordered) continue;
    let cursor = 0;
    for (const key of group.orderedKeys ?? group.keys) {
      if (!lineOf.has(key)) continue; // already reported missing
      const tokens = tokenize(units.get(key));
      let found = -1;
      for (let li = cursor; li < lineTokens.length && found < 0; li++) {
        const at = findFreeSpan(lineTokens[li], tokens, orderTaken[li]);
        if (at < 0) continue;
        for (let j = 0; j < tokens.length; j++) orderTaken[li][at + j] = true;
        found = li;
      }
      if (found < 0) {
        ordering.push({ kind: "order", value: units.get(key), detail: "appears before content that precedes it in the source" });
      } else {
        cursor = found;
      }
    }
  }

  // Groups must not interleave: the lines one canvas control's content
  // occupies may not be straddled by another's. This is what keeps a
  // person inside their own section instead of drifting under a
  // neighbouring heading.
  // Spans are computed only from units unique to one group. A value that
  // occurs in two groups is deduplicated to a single key with a single
  // placement, so counting it toward both spans invents an overlap that
  // the document does not have — PRIME.aspx has two quick links sharing
  // one URL, and THE-LEVELS.aspx has a link titled "The Levels " that
  // collapses into the page heading "THE LEVELS".
  const groupCount = new Map();
  for (const g of groups) for (const k of new Set(g.keys)) groupCount.set(k, (groupCount.get(k) || 0) + 1);
  const spans = groups
    .map((g) => {
      const ls = g.keys.filter((k) => groupCount.get(k) === 1).map((k) => lineOf.get(k)).filter((v) => v !== undefined);
      return ls.length ? { min: Math.min(...ls), max: Math.max(...ls), group: g } : null;
    })
    .filter(Boolean);
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1], cur = spans[i];
    if (cur.min < prev.min && cur.max > prev.max) {
      ordering.push({ kind: "interleave", value: units.get(cur.group.keys[0]) ?? "", detail: "content from one section is split across another" });
    }
  }

  // Structural pairs the renderer joins onto one line — a link's label
  // with its target, a person's name with their email. Landing on
  // different lines means the association was broken even though both
  // values are present.
  // Asked as co-occurrence rather than "same assigned line": a value may
  // legitimately appear in several places, and the deduplicated
  // placement of one occurrence says nothing about where the pair meets.
  // The question is whether SOME rendered line carries both, on disjoint
  // spans. Swap two people's emails and no line carries the right pair.
  const coOccurs = (ta, tb) =>
    lineTokens.some((lt) => {
      const used = new Array(lt.length).fill(false);
      const at = findFreeSpan(lt, ta, used);
      if (at < 0) return false;
      for (let j = 0; j < ta.length; j++) used[at + j] = true;
      return findFreeSpan(lt, tb, used) >= 0;
    });

  const association = [];
  for (const [a, b] of pairs) {
    if (!units.has(a) || !units.has(b)) continue;
    if (!coOccurs(tokenize(units.get(a)), tokenize(units.get(b)))) {
      association.push({ a: units.get(a), b: units.get(b), detail: "never rendered together; the source pairs them" });
    }
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
    // Untraceable content blocks publication too. It was advisory until
    // alteration-mutation testing showed the consequence: changing a
    // heading to "ARBORAGE Revised", or a link to BOTANIKA-TOWER-6.aspx,
    // was correctly *detected* as untraceable and still published,
    // because only missing content decided the status. Inventing a fact
    // is as much a failure as losing one.
    status:
      missing.length === 0 && unmatched.length === 0 && ordering.length === 0 && association.length === 0
        ? "PASS"
        : "FAIL",
    sourceUnitCount: units.size,
    representedUnitCount: units.size - missing.length,
    missing,
    unmatched,
    ordering,
    association,
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
    `Ordering problems: ${result.ordering?.length ?? 0}`,
    `Broken associations: ${result.association?.length ?? 0}`,
  ];
  const detail = [];
  if (result.missing.length) {
    detail.push("", "Missing content:", ...result.missing.map((m) => `- ${JSON.stringify(m)}`));
  }
  if (result.unmatched.length) {
    detail.push("", "Unmatched content (present in output, not traceable to source):",
      ...result.unmatched.map((u) => `- ${JSON.stringify(u.tokens.join(" "))} in ${JSON.stringify(u.line)}`));
  }
  if (result.ordering?.length) {
    detail.push("", "Ordering problems:", ...result.ordering.map((o) => `- ${JSON.stringify(o.value)} — ${o.detail}`));
  }
  if (result.association?.length) {
    detail.push("", "Broken associations:", ...result.association.map((a) => `- ${JSON.stringify(a.a)} / ${JSON.stringify(a.b)} — ${a.detail}`));
  }
  return [...head, ...body, ...detail].join("\n");
}
