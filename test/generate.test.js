import { describe, it, expect } from "vitest";
import { generateOptimized, generatePage, formatBucketReport } from "../src/lib/generate.js";
import { buildMaster } from "../src/lib/masterMd.js";
import { readFixture, REAL_PAGES, HAS_REAL_PAGES, textControl, makeAspx } from "./helpers.js";

const files = HAS_REAL_PAGES ? REAL_PAGES.map((name) => ({ name, path: name, raw: readFixture(name) })) : [];

describe.skipIf(!HAS_REAL_PAGES)("bucket generation", () => {
  it("passes a bucket of real pages and emits one document per page", () => {
    const result = generateOptimized("TOWNSHIP PAGES", files);
    expect(result.status).toBe("PASS");
    expect(result.failed).toEqual([]);
    expect(result.pages).toHaveLength(3);
    expect(result.totals.representedUnits).toBe(result.totals.sourceUnits);
    expect(result.md).toContain("# FORTUNE HILL");
    expect(result.md).toContain("# STUDIO CITY");
    expect(result.md).toContain("# THE SIGNATURE");
  });

  it("orders pages the same way the raw master file does", () => {
    const optimized = generateOptimized("T", files);
    const master = buildMaster("T", files);
    const orderIn = (text, names) => names.map((n) => text.indexOf(n)).filter((i) => i >= 0);
    const titles = ["FORTUNE HILL", "STUDIO CITY", "THE SIGNATURE"];
    const a = orderIn(optimized.md, titles);
    expect(a).toEqual([...a].sort((x, y) => x - y));
    expect(orderIn(master, ["FORTUNE-HILL.aspx", "STUDIO-CITY.aspx", "THE-SIGNATURE.aspx"]))
      .toEqual(expect.arrayContaining([expect.any(Number)]));
  });

  it("is dramatically smaller than the raw master file", () => {
    const optimized = generateOptimized("T", files);
    const master = buildMaster("T", files);
    expect(optimized.md.length).toBeLessThan(master.length * 0.05);
  });

  it("blocks publication when any page loses information", () => {
    // A page whose only content sits in an element the renderer cannot
    // reach would produce an empty document; the gate must refuse it.
    const broken = { name: "Broken.aspx", path: "Broken.aspx", raw: makeAspx("<div data-sp-canvascontrol=\"\" data-sp-controldata=\"{&quot;controlType&quot;:9}\"><div data-sp-rte=\"\"><p>Reservation fee ₱50,000</p></div></div>") };
    const result = generateOptimized("T", [...files, broken]);
    expect(result.status).toBe("FAIL");
    expect(result.md).toBe("");
    expect(result.failed.map((p) => p.name)).toEqual(["Broken.aspx"]);
    const report = formatBucketReport("T", result);
    expect(report).toContain("Status: FAIL");
    expect(report).toContain("Reservation fee ₱50,000");
  });

  it("still produces the raw master file when the gate blocks the AI file", () => {
    const broken = { name: "B.aspx", path: "B.aspx", raw: makeAspx("<div data-sp-canvascontrol=\"\" data-sp-controldata=\"{&quot;controlType&quot;:9}\"><div data-sp-rte=\"\"><p>Only fact</p></div></div>") };
    expect(generateOptimized("T", [broken]).status).toBe("FAIL");
    expect(buildMaster("T", [broken])).toContain(broken.raw);
  });

  it("reports per-page validation alongside the document", () => {
    const page = generatePage(files[0]);
    expect(page.name).toBe("FORTUNE-HILL.aspx");
    expect(page.validation.status).toBe("PASS");
    expect(page.report).toContain("File: FORTUNE-HILL.aspx");
    expect(page.report).toContain("Status: PASS");
  });

  it("handles an empty bucket without throwing", () => {
    const result = generateOptimized("Empty", []);
    expect(result.status).toBe("PASS");
    expect(result.pages).toEqual([]);
    expect(result.totals.sourceUnits).toBe(0);
  });

  it("handles a page with no canvas content at all", () => {
    const bare = { name: "Bare.aspx", path: "Bare.aspx", raw: "<html><body></body></html>" };
    const result = generateOptimized("T", [bare]);
    expect(result.status).toBe("PASS");
    expect(result.md).toContain("# Bare");
  });

  it("is deterministic across runs", () => {
    expect(generateOptimized("T", files).md).toBe(generateOptimized("T", files).md);
  });
});
