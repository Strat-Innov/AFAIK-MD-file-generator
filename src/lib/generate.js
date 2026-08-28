/* ------------------------------------------------------------------ *
 * Ties the two representations together for one bucket.
 *
 *   .aspx ──┬─> buildMaster()      -> RAW / MASTER md   (always)
 *           └─> parse -> render -> validate
 *                                 -> AI-OPTIMIZED md    (only on PASS)
 *
 * The gate is enforced here rather than in the UI: a bucket whose
 * optimized output lost meaningful source information does not produce
 * a publishable document at all. The raw master file is never gated —
 * it is the fidelity layer and must stay available for audit precisely
 * when something has gone wrong with the optimized one.
 * ------------------------------------------------------------------ */

import { parsePage, parseCanvas } from "./aspxDocument.js";
import { renderOptimized } from "./optimizedMd.js";
import { validateCoverage, formatReport } from "./coverage.js";

export function generatePage(file) {
  const page = parsePage(file.raw, { name: file.name, path: file.path });
  const md = renderOptimized(page);
  const validation = validateCoverage(parseCanvas(page.canvasHtml), md, { pageName: file.name });
  return { name: file.name, md, validation, report: formatReport(validation, file.name) };
}

export function generateOptimized(bucketName, files) {
  const sorted = [...files].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const pages = sorted.map(generatePage);
  const failed = pages.filter((p) => p.validation.status === "FAIL");

  const totals = pages.reduce(
    (acc, p) => ({
      sourceUnits: acc.sourceUnits + p.validation.sourceUnitCount,
      representedUnits: acc.representedUnits + p.validation.representedUnitCount,
      unmatched: acc.unmatched + p.validation.unmatched.length,
    }),
    { sourceUnits: 0, representedUnits: 0, unmatched: 0 }
  );

  const status = failed.length === 0 ? "PASS" : "FAIL";
  const md =
    status === "PASS"
      ? `# ${bucketName}\n\n` + pages.map((p) => p.md.trim()).join("\n\n---\n\n") + "\n"
      : "";

  return { status, md, pages, failed, totals };
}

// One report covering the whole bucket, in the same inspectable shape as
// the per-file report.
export function formatBucketReport(bucketName, result) {
  const head = [
    "VALIDATION",
    "----------",
    `Bucket: ${bucketName}`,
    `Status: ${result.status}`,
    "",
    `Pages: ${result.pages.length}`,
    `Source content units: ${result.totals.sourceUnits}`,
    `Represented content units: ${result.totals.representedUnits}`,
    `Missing units: ${result.totals.sourceUnits - result.totals.representedUnits}`,
    `Unmatched units: ${result.totals.unmatched}`,
  ];
  if (!result.failed.length) return head.join("\n");
  return [head.join("\n"), "", ...result.failed.map((p) => p.report)].join("\n");
}
