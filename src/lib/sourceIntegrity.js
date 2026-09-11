/* ------------------------------------------------------------------ *
 * SOURCE INTEGRITY — does this page's body belong to its title?
 *
 * THE DEFECT THIS EXISTS TO CATCH. `South-Station-Terminal(test).aspx`
 * carried the title "South Station Transport Terminal" over a body
 * copied wholesale from Two Botanika: residential unit pricing, Botanika
 * amenities, and a Socials block whose every branded link said Botanika.
 * Thirty-four benchmark questions were generated from it, each one
 * asserting Botanika's facts as South Station's. All three arms then
 * faithfully reproduced a page that was wrong at source, and the
 * benchmark scored them against the contaminated values.
 *
 * Nothing downstream can catch that. The generator is a faithful
 * transform; a faithful transform of a wrong page is a wrong page. The
 * only place to notice is here, before questions are built from it.
 *
 * WHAT THIS IS NOT. It is not a semantic validator and it does not ask
 * a model anything — governance must be deterministic and reproducible,
 * or it cannot be evidence. It is a small number of literal checks over
 * structure the page states about itself.
 *
 * THE PRIMARY SIGNAL. A project page's Socials & Websites block links to
 * that project: 1001 Parkway's links say "1001 Parkway", Botanika's say
 * "Botanika". So when EVERY branded external link on a page names an
 * entity the title never mentions, the title and the body disagree about
 * what the page is — and they disagree in the page's own words, which is
 * what makes it reportable rather than a guess.
 *
 * WHY THE LINK SIGNAL ALONE CANNOT BE "HIGH". `ARBORAGE.aspx` has the
 * identical shape — every branded external link names Brentville, and
 * BRENTVILLE.aspx is a real page — yet Arborage's body is genuinely
 * Arborage. The question builder already documents this as legitimate.
 * Measured over the 134-page corpus, the link rule at high confidence
 * produced two false positives (ARBORAGE, PRIME) against one true one.
 * So it warns; it does not block.
 *
 * What IS certain is the filename. `South-Station-Terminal(test).aspx`
 * announced itself as a draft, and a draft has no business supplying
 * benchmark ground truth whatever its body says. That check has no
 * ambiguity, so it is the one that blocks.
 *
 * SEVERITY, and what each level does:
 *
 *   high   - the page names itself a draft, test or copy. Blocks
 *            benchmark inclusion unless explicitly overridden.
 *   medium - every branded external link names another entity that is
 *            itself a page in this corpus. Warns; review before freezing.
 *   low    - a partial link mismatch, or a title absent from the body.
 *            Informational.
 *
 * Ordinary generation is never blocked. This gates BENCHMARK inclusion,
 * where a wrong page becomes wrong ground truth.
 * ------------------------------------------------------------------ */

// Words that identify a platform, a developer or a link type rather than
// the subject of the page. "Filigree" is the developer and appears on
// every project's links; it can never be the distinguishing entity.
const NOISE = new Set([
  "facebook", "instagram", "youtube", "linkedin", "twitter", "x", "tiktok",
  "virtual", "tour", "tours", "360", "exsight", "official", "page", "pages",
  "website", "websites", "site", "home", "brand", "brands", "playbook",
  "filigree", "filinvest", "fai", "city", "corp", "inc", "the", "and", "of",
  "a", "an", "at", "in", "on", "for", "to", "by", "with", "muntinlupa",
  "alabang", "philippines", "ph", "project", "projects", "residences",
  "residence", "condominium", "condo", "tower", "towers", "estate", "estates",
]);

const words = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !NOISE.has(w));

const SHAREPOINT = /sharepoint\.com|^\/sites\//i;

// A token that is simply the link's own host is naming the platform the
// link points at (Smartsheet, Zoho, Darwinbox), not the page's subject.
const hostWords = (url) => {
  try { return new Set(words(new URL(url).hostname.replace(/\.[a-z.]+$/i, ""))); }
  catch { return new Set(); }
};

// Filenames that announce the page is not production content. This is
// the one signal with no interpretation in it.
const DRAFT_MARKER = /\((?:test|copy|draft|wip|tmp|old|backup)\)|[-_ ](?:test|copy|draft|wip|tmp|backup)(?=\.aspx$|$)/i;
const isExternal = (url) => /^https?:\/\//i.test(url ?? "") && !SHAREPOINT.test(url ?? "");

/** The page's own headline — the first heading, the same one the
 *  question builder uses as the subject of every question it writes. */
export function titleOf(page) {
  for (const s of page.sections ?? []) {
    if (s.kind !== "text") continue;
    const h = (s.blocks ?? []).find((b) => b.type === "heading");
    if (h) return h.text;
  }
  return String(page.name ?? "").replace(/\.aspx$/i, "");
}

const headings = (page) =>
  (page.sections ?? [])
    .filter((s) => s.kind === "text")
    .flatMap((s) => (s.blocks ?? []).filter((b) => b.type === "heading").map((b) => b.text));

const externalLinks = (page) =>
  (page.sections ?? [])
    .filter((s) => s.kind === "webpart" && s.content?.type === "links")
    .flatMap((s) => s.content.items ?? [])
    .filter((i) => i?.title && isExternal(i.url));

/**
 * Inspect one parsed page.
 *
 * Returns `{ page, title, severity, findings }` with severity null when
 * nothing was found. Every finding carries the literal evidence, so a
 * reviewer can confirm or dismiss it without re-running anything.
 */
export function checkPage(page, { name, corpusTitles } = {}) {
  const pageName = name ?? page.name ?? "(unnamed)";
  const title = titleOf(page);
  const titleWords = new Set(words(title));
  const findings = [];

  // ---- the certain signal: the page says it is not production ----
  const marker = String(pageName).match(DRAFT_MARKER);
  if (marker) {
    findings.push({
      rule: "draft-page-marker",
      severity: "high",
      detail: `The filename marks this page as a draft or test copy ("${marker[0]}").`,
      entity: null,
      evidence: [pageName],
    });
  }

  // ---- the suggestive signal: whose links are these? ----
  const links = externalLinks(page);
  const branded = links
    .map((i) => {
      const host = hostWords(i.url);
      return { title: i.title, url: i.url, words: words(i.title).filter((w) => !host.has(w)) };
    })
    .filter((l) => l.words.length > 0);

  if (branded.length) {
    const foreign = branded.filter((l) => !l.words.some((w) => titleWords.has(w)));
    if (foreign.length) {
      const counts = new Map();
      for (const l of foreign) for (const w of new Set(l.words)) counts.set(w, (counts.get(w) ?? 0) + 1);
      const [entity, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      const inUrls = entity ? foreign.filter((l) => l.url.toLowerCase().includes(entity)).length : 0;
      // Does the entity name another page here? Contamination is always
      // FROM somewhere; a name with no page behind it is usually a
      // partner, a platform or an external property.
      const known = Boolean(entity && corpusTitles?.has(entity));

      const severity =
        foreign.length === branded.length && hits >= 2 && inUrls >= 1 && known ? "medium" : "low";

      findings.push({
        rule: "title-vs-linked-entity",
        severity,
        detail:
          `${foreign.length} of ${branded.length} branded external link(s) name "${entity}", ` +
          `which does not appear in the page title` +
          (known ? ` and is itself a page in this corpus.` : `.`),
        entity,
        evidence: foreign.slice(0, 5).map((l) => `${l.title} -> ${l.url}`),
      });
    }
  }

  const bodyWords = new Set(headings(page).flatMap(words));
  if (titleWords.size && ![...titleWords].some((w) => bodyWords.has(w)) && headings(page).length > 2) {
    findings.push({
      rule: "title-absent-from-body-headings",
      severity: "low",
      detail: "No heading in the body repeats any distinctive word from the page title.",
      evidence: headings(page).slice(0, 6),
    });
  }

  const rank = { high: 3, medium: 2, low: 1 };
  const severity = findings.length
    ? findings.reduce((a, f) => (rank[f.severity] > rank[a] ? f.severity : a), "low")
    : null;

  return { page: pageName, title, severity, findings };
}

/** Run over a whole corpus. Returns only the pages with findings. */
export function checkCorpus(pages) {
  // Every distinctive word of every page title, so a link naming another
  // page in this corpus can be told from one naming an outside party.
  const corpusTitles = new Set(pages.flatMap(({ page }) => words(titleOf(page))));
  return pages
    .map(({ page, name }) => checkPage(page, { name, corpusTitles }))
    .filter((r) => r.severity);
}

/** High-confidence findings block benchmark inclusion; nothing else does. */
export const blocksBenchmark = (report) => report.severity === "high";

export function formatReport(reports) {
  if (!reports.length) return "source integrity: no findings";
  const lines = [];
  for (const r of reports) {
    lines.push(`${r.severity.toUpperCase()}  ${r.page}  (title: "${r.title}")`);
    for (const f of r.findings) {
      lines.push(`    [${f.severity}] ${f.rule}: ${f.detail}`);
      for (const e of f.evidence ?? []) lines.push(`        ${e}`);
    }
  }
  return lines.join("\n");
}
