import { describe, it, expect } from "vitest";
import { buildSection } from "../src/lib/masterMd.js";
import { parsePage, parseCanvas } from "../src/lib/aspxDocument.js";
import { renderOptimized } from "../src/lib/optimizedMd.js";
import { validateCoverage } from "../src/lib/coverage.js";
import { tokenize, sourceUnits } from "../src/lib/contentUnits.js";
import { corpusFiles, readCorpus, HAS_CORPUS } from "./helpers.js";

// The August 2026 corpus: 133 real exported pages, gitignored. See
// test/corpus/README.md. Skips cleanly when the files are absent.
describe.skipIf(!HAS_CORPUS)("August 2026 regression corpus", () => {
  const names = corpusFiles();
  const pages = names.map((name) => {
    const raw = readCorpus(name);
    const page = parsePage(raw, { name, path: name });
    const md = renderOptimized(page);
    return { name, raw, page, md, result: validateCoverage(parseCanvas(page.canvasHtml), md, { pageName: name }) };
  });

  it("has the expected corpus size", () => {
    expect(names.length).toBeGreaterThanOrEqual(133);
  });

  it("preserves raw source fidelity for every page", () => {
    const broken = pages.filter(({ name, raw }) => {
      const sec = buildSection(name, name, raw);
      const s = sec.indexOf("```aspx\n") + 8;
      return sec.slice(s, sec.indexOf("\n```", s)) !== raw;
    });
    expect(broken.map((p) => p.name)).toEqual([]);
  });

  it("extracts every page without loss or crash", () => {
    expect(pages.filter((p) => p.page.sections.length === 0).map((p) => p.name)).toEqual([]);
    expect(pages.filter((p) => !p.md.trim()).map((p) => p.name)).toEqual([]);
  });

  it("passes the coverage gate on every page", () => {
    const failed = pages.filter((p) => p.result.status !== "PASS");
    expect(failed.map((p) => `${p.name}: ${JSON.stringify(p.result.missing.slice(0, 3))}`)).toEqual([]);
  });

  it("produces no untraceable content on any page", () => {
    const flagged = pages.filter((p) => p.result.unmatched.length);
    expect(flagged.map((p) => `${p.name}: ${JSON.stringify(p.result.unmatched[0])}`)).toEqual([]);
  });

  it("strips SharePoint implementation detail from every page", () => {
    const dirty = pages.filter((p) =>
      ["data-sp-", "controlType", "webpartdata", "instanceId", "SiteAssets/", "rawPreviewImageUrl"].some((n) => p.md.includes(n))
    );
    expect(dirty.map((p) => p.name)).toEqual([]);
  });

  it("reduces total size by more than 95%", () => {
    const raw = pages.reduce((a, p) => a + p.raw.length, 0);
    const out = pages.reduce((a, p) => a + p.md.length, 0);
    expect(out / raw).toBeLessThan(0.05);
  });

  // The check that actually proves the gate works. A corpus that merely
  // passes shows the generator is self-consistent; it does not show the
  // gate can detect loss. Here a known unit is deleted from real output
  // and the gate must catch it — unless another copy of that value
  // remains, in which case nothing was lost and PASS is correct.
  it("detects deleted content on every page (mutation check)", { timeout: 120000 }, () => {
    const misses = [];
    for (const { name, page, md, result } of pages) {
      const units = [...sourceUnits(parseCanvas(page.canvasHtml)).values()];
      const step = Math.max(1, Math.floor(units.length / 3));
      const body = md.replace(/\n## Source\n[\s\S]*$/, "\n");
      const tail = md.slice(body.length);
      for (let u = 0; u < units.length && u / step < 3; u += step) {
        const ut = tokenize(units[u]);
        if (!ut.length) continue;
        const lines = body.split("\n");
        let hit = -1, at = -1;
        for (let i = 0; i < lines.length && hit < 0; i++) {
          const lt = tokenize(lines[i]);
          outer: for (let s = 0; s + ut.length <= lt.length; s++) {
            for (let j = 0; j < ut.length; j++) if (lt[s + j] !== ut[j]) continue outer;
            hit = i; at = s; break;
          }
        }
        if (hit < 0) continue;
        const lt = tokenize(lines[hit]);
        lt.splice(at, ut.length);
        const mutatedLines = [...lines];
        mutatedLines[hit] = lt.join(" ");
        const mutated = mutatedLines.join("\n") + tail;
        const stillPresent = mutated.replace(/\n## Source\n[\s\S]*$/, "\n").split("\n").some((l) => {
          const t = tokenize(l);
          outer2: for (let s = 0; s + ut.length <= t.length; s++) {
            for (let j = 0; j < ut.length; j++) if (t[s + j] !== ut[j]) continue outer2;
            return true;
          }
          return false;
        });
        if (stillPresent) continue; // another copy remains: no loss, PASS is correct
        const res = validateCoverage(parseCanvas(page.canvasHtml), mutated, { pageName: name });
        if (res.status !== "FAIL") misses.push(`${name}: undetected removal of ${JSON.stringify(units[u]).slice(0, 60)}`);
      }
      void result;
    }
    expect(misses).toEqual([]);
  });
});
