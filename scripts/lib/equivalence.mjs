/* ------------------------------------------------------------------ *
 * Answer equivalence for benchmark scoring.
 *
 * These rules decide whether a Copilot answer matches the ground truth.
 * They are code rather than prose so they can be tested, and so two
 * people scoring the same run reach the same verdict.
 *
 * The guiding constraint is that they must be permissive about
 * FORMATTING and strict about VALUES. The generator work already
 * produced the cautionary case: a substring check once accepted
 * "LEASING" because the page contained "subleasing/assignment". The
 * same mistake here would silently inflate every arm's score, so
 * matching is on whole tokens, never on raw substrings.
 * ------------------------------------------------------------------ */

/** Formatting differences that carry no meaning. */
export function normalizeAnswer(s) {
  let out = String(s ?? "").normalize("NFKC");

  // URL encoding: "%20" and a literal space are the same path. Decoding
  // is attempted on the whole string and abandoned if it is malformed,
  // so a stray "%" never throws.
  if (/%[0-9A-Fa-f]{2}/.test(out)) {
    try { out = decodeURIComponent(out); } catch { /* leave as-is */ }
  }

  return out
    .replace(/[   ]/g, " ")          // non-breaking spaces
    .replace(/[‐-―−]/g, "-")          // en/em dash, minus -> hyphen
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    // The peso is written "₱", "PHP 1,000" and "P1,000" across the
    // corpus and in replies. All three mean the same amount; the digits
    // after it are what must agree.
    .replace(/\bphp\b/gi, "₱")
    .replace(/\bP(?=\s?\d)/g, "₱")                    // bare P before a number
    .replace(/₱\s+(?=\d)/g, "₱")                       // "₱ 25.5M" -> "₱25.5M"
    .replace(/(\d),(?=\d{3}\b)/g, "$1")              // 1,000 -> 1000 (thousands only)
    .replace(/[*_`~#>|[\]()]/g, " ")                 // Markdown decoration
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Whole tokens, with edge punctuation trimmed. Internal punctuation is
 * kept: it is what holds emails, decimals, currency amounts and URLs
 * together as single tokens.
 */
export function tokens(s) {
  return normalizeAnswer(s)
    .split(" ")
    .map((t) => t.replace(/^[.,;:!?'"]+|[.,;:!?'"]+$/g, ""))
    .filter((t) => t && /[\p{L}\p{N}]/u.test(t));
}

function containsRun(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Scores one answer against its ground truth.
 *
 *   correct  the expected value appears in full, as a contiguous run of
 *            whole tokens
 *   partial  some but not all of the expected tokens appear; a price
 *            range answered with only one of its two endpoints lands
 *            here, never in `correct`
 *
 * Deliberately NOT equivalent: different digits, different units
 * (sqm vs sqft), and a half-answered range. Trailing zeros are not
 * stripped either — "25.5" and "25.50" stay distinct, because deciding
 * they are the same is a numeric judgement, not a formatting one.
 */
export function matchAnswer(expected, actual) {
  const exp = tokens(expected);
  const act = tokens(actual);
  const correct = exp.length > 0 && containsRun(act, exp);
  const present = exp.filter((t) => act.includes(t));
  return {
    correct,
    partial: !correct && present.length > 0 && present.length < exp.length,
    expectedTokens: exp.length,
    matchedTokens: present.length,
    coverage: exp.length ? present.length / exp.length : 0,
  };
}

/** A citation is present if the reply names a source file, page or URL. */
export function hasCitation(answer) {
  const a = String(answer ?? "");
  return /\.aspx\b/i.test(a) || /https?:\/\//i.test(a) || /\[\d+\]|\bsource\s*:/i.test(a);
}
