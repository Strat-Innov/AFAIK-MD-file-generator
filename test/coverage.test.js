import { describe, it, expect } from "vitest";
import { parsePage, parseCanvas } from "../src/lib/aspxDocument.js";
import { renderOptimized } from "../src/lib/optimizedMd.js";
import { validateCoverage, formatReport } from "../src/lib/coverage.js";
import { normalize } from "../src/lib/contentUnits.js";
import { readFixture, REAL_PAGES, HAS_REAL_PAGES, textControl, makeAspx } from "./helpers.js";

function run(name) {
  const page = parsePage(readFixture(name), { name, path: name });
  const md = renderOptimized(page);
  return { md, result: validateCoverage(parseCanvas(page.canvasHtml), md) };
}

describe.skipIf(!HAS_REAL_PAGES)("the gate passes real pages", () => {
  for (const name of REAL_PAGES) {
    it(`${name}: every source unit is represented`, () => {
      const { result } = run(name);
      expect(result.missing).toEqual([]);
      expect(result.unmatched).toEqual([]);
      expect(result.status).toBe("PASS");
      expect(result.sourceUnitCount).toBeGreaterThan(50);
      expect(result.representedUnitCount).toBe(result.sourceUnitCount);
    });
  }
});

describe.skipIf(!HAS_REAL_PAGES)("the gate fails when information disappears", () => {
  it("catches a deleted price", () => {
    const { md } = run("FORTUNE-HILL.aspx");
    const page = parsePage(readFixture("FORTUNE-HILL.aspx"), { name: "FORTUNE-HILL.aspx" });
    const damaged = md.replace("₱28.8M\n", "");
    const result = validateCoverage(parseCanvas(page.canvasHtml), damaged);
    expect(result.status).toBe("FAIL");
    expect(result.missing).toContain("₱28.8M");
  });

  it("catches a dropped floor-area range and a dropped amenity", () => {
    const { md } = run("FORTUNE-HILL.aspx");
    const page = parsePage(readFixture("FORTUNE-HILL.aspx"), { name: "FORTUNE-HILL.aspx" });
    const damaged = md.replace("154–181 sqm\n", "").replace("- Music Room\n", "");
    const result = validateCoverage(parseCanvas(page.canvasHtml), damaged);
    expect(result.status).toBe("FAIL");
    expect(result.missing).toEqual(expect.arrayContaining(["154–181 sqm", "Music Room"]));
  });

  it("catches a dropped link, contact and whole section", () => {
    const { md } = run("FORTUNE-HILL.aspx");
    const page = parsePage(readFixture("FORTUNE-HILL.aspx"), { name: "FORTUNE-HILL.aspx" });
    // Taken from the fixture rather than hard-coded: this repo is public.
    const email = readFixture("FORTUNE-HILL.aspx").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)[0];
    const damaged = md
      .replace("https://fortunehillbyprestige.com/", "")
      .replace(email, "")
      .replace(/## Payment Scheme[\s\S]*?## Amenities/, "## Amenities");
    const result = validateCoverage(parseCanvas(page.canvasHtml), damaged);
    expect(result.status).toBe("FAIL");
    expect(result.missing).toEqual(expect.arrayContaining([
      "https://fortunehillbyprestige.com/",
      email,
    ]));
    expect(result.missing.some((m) => m.includes("100% payable"))).toBe(true);
  });

  it("catches an empty document outright", () => {
    const page = parsePage(readFixture("THE-SIGNATURE.aspx"), { name: "THE-SIGNATURE.aspx" });
    const result = validateCoverage(parseCanvas(page.canvasHtml), "# The Signature\n");
    expect(result.status).toBe("FAIL");
    expect(result.missing.length).toBeGreaterThan(60);
    expect(result.representedUnitCount).toBeLessThan(5);
  });

  it("catches invented content that no source value backs", () => {
    const { md } = run("STUDIO-CITY.aspx");
    const page = parsePage(readFixture("STUDIO-CITY.aspx"), { name: "STUDIO-CITY.aspx" });
    const embellished = md.replace("## Amenities", "## Amenities\n\n- Rooftop helipad and private cinema");
    const result = validateCoverage(parseCanvas(page.canvasHtml), embellished);
    expect(result.unmatched).toContain("Rooftop helipad and private cinema");
  });
});

describe.skipIf(!HAS_REAL_PAGES)("the gate tolerates formatting differences", () => {
  const cases = [
    ["Markdown emphasis", (md) => md.replace("₱25.5M – ₱27.3M", "**₱25.5M – ₱27.3M**")],
    ["heading depth", (md) => md.replace("## Amenities", "#### Amenities")],
    ["bullet style", (md) => md.replace(/^- /gm, "* ")],
    ["extra whitespace", (md) => md.replace(/\n/g, "\n\n").replace(/ /g, "  ")],
    ["non-breaking spaces", (md) => md.replace(/ /g, " ")],
    ["blockquoting", (md) => md.split("\n").map((l) => `> ${l}`).join("\n")],
  ];
  for (const [label, mangle] of cases) {
    it(`${label} does not produce a false failure`, () => {
      const { md } = run("FORTUNE-HILL.aspx");
      const page = parsePage(readFixture("FORTUNE-HILL.aspx"), { name: "FORTUNE-HILL.aspx" });
      const result = validateCoverage(parseCanvas(page.canvasHtml), mangle(md));
      expect(result.missing).toEqual([]);
      expect(result.status).toBe("PASS");
    });
  }

  it("normalizes dash, quote and space variants but not values", () => {
    expect(normalize("97–120 sqm")).toBe(normalize("97-120 sqm"));
    expect(normalize("**₱25.5M**")).toBe("₱25.5m");
    expect(normalize("a b")).toBe("a b");
    expect(normalize("₱44.9M")).not.toBe(normalize("₱44.8M"));
  });
});

describe("the gate is independent of the parser it validates", () => {
  it("fails when the renderer silently drops a paragraph the parser skipped", () => {
    // A <section> element is not something collectBlocks recurses into by
    // name; the gate's own splitter still sees the text inside it, which
    // is the whole point of deriving source units separately.
    const aspx = makeAspx(textControl("<h2>Rates</h2><p>Standard rate ₱1.2M</p><p>Promo rate ₱0.9M</p>"));
    const page = parsePage(aspx, { name: "R.aspx" });
    const md = renderOptimized(page).replace("Promo rate ₱0.9M\n", "");
    const result = validateCoverage(parseCanvas(page.canvasHtml), md);
    expect(result.status).toBe("FAIL");
    expect(result.missing).toContain("Promo rate ₱0.9M");
  });
});

describe.skipIf(!HAS_REAL_PAGES)("the report is inspectable", () => {
  it("reports counts on success", () => {
    const { result } = run("STUDIO-CITY.aspx");
    const text = formatReport(result, "STUDIO-CITY.aspx");
    expect(text).toContain("Status: PASS");
    expect(text).toContain(`Source content units: ${result.sourceUnitCount}`);
    expect(text).toContain("Missing units: 0");
    expect(text).toContain("Unmatched units: 0");
  });

  it("names the missing values on failure", () => {
    const { md } = run("FORTUNE-HILL.aspx");
    const page = parsePage(readFixture("FORTUNE-HILL.aspx"), { name: "FORTUNE-HILL.aspx" });
    const result = validateCoverage(parseCanvas(page.canvasHtml), md.replace("₱46.06M\n", ""));
    const text = formatReport(result, "FORTUNE-HILL.aspx");
    expect(text).toContain("Status: FAIL");
    expect(text).toContain("Missing content:");
    expect(text).toContain("₱46.06M");
  });
});
