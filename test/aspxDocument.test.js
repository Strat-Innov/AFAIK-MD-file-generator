import { describe, it, expect } from "vitest";
import { parsePage } from "../src/lib/aspxDocument.js";
import { renderOptimized } from "../src/lib/optimizedMd.js";
import { readFixture, REAL_PAGES, HAS_REAL_PAGES, textControl, webPartControl, makeAspx } from "./helpers.js";
import { QUICK_LINKS_ID, PEOPLE_ID, IMAGE_ID } from "../src/lib/webparts.js";

const render = (name) => renderOptimized(parsePage(readFixture(name), { name, path: name }));

describe.skipIf(!HAS_REAL_PAGES)("extraction from real exported pages", () => {
  it("keeps every <br>-separated fact on its own line", () => {
    // The single most damaging failure mode: a unit type, its floor area
    // and its price live in one <p> separated only by <br>. Fusing them
    // produces "2-BR Platinum97–120 sqm₱25.5M" and destroys retrieval.
    const md = render("FORTUNE-HILL.aspx");
    expect(md).toContain("2-BR Platinum\n97–120 sqm\n₱25.5M – ₱27.3M");
    expect(md).toContain("3-BR Gold – Penthouse\n154 sqm\n₱46.06M");
  });

  it("promotes the page's own first heading to the title", () => {
    expect(render("FORTUNE-HILL.aspx").startsWith("# FORTUNE HILL\n")).toBe(true);
    expect(render("THE-SIGNATURE.aspx").startsWith("# THE SIGNATURE\n")).toBe(true);
    expect(render("STUDIO-CITY.aspx").startsWith("# STUDIO CITY\n")).toBe(true);
  });

  it("preserves the source's own section headings, and invents none", () => {
    const md = render("FORTUNE-HILL.aspx");
    for (const h of ["## Overview:", "## Awards & Certifications:", "## Units & Pricing", "## Payment Scheme", "## Amenities"]) {
      expect(md).toContain(h);
    }
    // STUDIO-CITY has no awards section — it must not gain one.
    expect(render("STUDIO-CITY.aspx")).not.toContain("Awards");
  });

  it("extracts list items as list items", () => {
    const md = render("FORTUNE-HILL.aspx");
    expect(md).toContain("- Main Lounge");
    expect(md).toContain("- Infinity Pool");
    expect(md).toContain("- Gym and Yoga Studio");
  });

  it("keeps external links with their real URLs", () => {
    const md = render("FORTUNE-HILL.aspx");
    expect(md).toContain("(https://www.facebook.com/OfficialFortuneHillSanJuan/)");
    expect(md).toContain("(https://fortunehillbyprestige.com/)");
    expect(md).toContain("## Socials & Websites");
  });

  it("keeps every contact email that appears in the page content", () => {
    // Asserted by shape and by comparison against the fixture, never by
    // hard-coding a real person — this repository is public.
    const md = render("FORTUNE-HILL.aspx");
    const canvas = parsePage(readFixture("FORTUNE-HILL.aspx"), { name: "x" }).canvasHtml;
    const emails = [...new Set([...canvas.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]))];
    expect(emails.length).toBeGreaterThan(5);
    for (const email of emails) expect(md).toContain(email);
    expect(md).toMatch(/^- [^\n]+ — [^\n]+ — [^\s@]+@[^\s@]+$/m);
  });

  it("leaves SharePoint's authoring metadata out of the optimized document", () => {
    // Editor/collaborator addresses live in the mso: property bag, not in
    // the page a reader sees. They belong in the raw master file only.
    const raw = readFixture("FORTUNE-HILL.aspx");
    const md = render("FORTUNE-HILL.aspx");
    const canvas = parsePage(raw, { name: "x" }).canvasHtml;
    const inCanvas = new Set([...canvas.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]));
    const metadataOnly = [...new Set([...raw.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]))]
      .filter((e) => !inCanvas.has(e));
    expect(metadataOnly.length).toBeGreaterThan(0);
    for (const email of metadataOnly) expect(md).not.toContain(email);
  });

  it("records the SharePoint site for traceability without inventing a page URL", () => {
    const md = render("FORTUNE-HILL.aspx");
    expect(md).toContain("## Source");
    expect(md).toContain("- Source file: FORTUNE-HILL.aspx");
    expect(md).toMatch(/^- SharePoint site: https:\/\/[a-z0-9-]+\.sharepoint\.com\/sites\/[\w-]+$/m);
    // The page's own URL is not present in the export, so none is emitted.
    expect(md).not.toContain("SitePages/FORTUNE-HILL.aspx");
  });

  it("emits no site URL at all when the source contains none", () => {
    const aspx = makeAspx(textControl("<h2>Bare Page</h2><p>Some text.</p>"));
    const md = renderOptimized(parsePage(aspx, { name: "Bare.aspx" }));
    expect(md).not.toContain("SharePoint site:");
    expect(md).toContain("# Bare Page");
  });

  it("does not reproduce facts the source does not contain", () => {
    // STUDIO-CITY's own Overview text names 1001 Parkway — a copy/paste
    // in the source page. Extraction reproduces it verbatim rather than
    // "correcting" it to Studio City.
    expect(render("STUDIO-CITY.aspx")).toContain("1001 Parkway Residences is Filigree");
  });

  for (const name of REAL_PAGES) {
    it(`${name}: strips SharePoint rendering and implementation noise`, () => {
      const md = render(name);
      for (const noise of ["data-sp-", "controlType", "fontSize", "webpartdata", "instanceId", "rgb(", "margin-left", "SiteAssets", "rawPreviewImageUrl", "layoutIndex"]) {
        expect(md).not.toContain(noise);
      }
      expect(md).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(md).not.toMatch(/<\/?[a-z]+[\s>]/i);
    });

    it(`${name}: is deterministic`, () => {
      expect(render(name)).toBe(render(name));
    });

    it(`${name}: is far smaller than the source`, () => {
      expect(render(name).length).toBeLessThan(readFixture(name).length * 0.1);
    });
  }
});

describe("structures with no real-world fixture yet", () => {
  it("renders a table as a Markdown table", () => {
    const aspx = makeAspx(textControl(
      "<h2>Rates</h2><table><tr><th>Unit</th><th>Price</th></tr><tr><td>Studio</td><td>₱3.8M</td></tr></table>"
    ));
    const md = renderOptimized(parsePage(aspx, { name: "T.aspx" }));
    expect(md).toContain("| Unit | Price |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Studio | ₱3.8M |");
  });

  it("keeps nested list items instead of fusing them into the parent", () => {
    const aspx = makeAspx(textControl("<h2>A</h2><ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>"));
    const md = renderOptimized(parsePage(aspx, { name: "N.aspx" }));
    expect(md).toContain("- Parent");
    expect(md).toContain("- Child");
  });

  it("surrenders searchable text from a web part it does not recognize", () => {
    const aspx = makeAspx(webPartControl({
      id: "00000000-1111-2222-3333-444444444444",
      title: "Unknown part",
      serverProcessedContent: {
        searchablePlainTexts: { title: "Financing Notes", "items[0].body": "Reservation fee ₱50,000" },
        links: { "items[0].url": "https://example.com/terms" },
      },
    }));
    const md = renderOptimized(parsePage(aspx, { name: "U.aspx" }));
    expect(md).toContain("## Financing Notes");
    expect(md).toContain("Reservation fee ₱50,000");
    expect(md).toContain("https://example.com/terms");
  });

  it("drops a web part that carries no reader-facing content", () => {
    const aspx = makeAspx(
      textControl("<h2>Page</h2>") +
      webPartControl({ id: "2161a1c6-db61-4731-b97c-3cdb303f7cbb", title: "Divider", properties: { length: 100, weight: 2 } })
    );
    const md = renderOptimized(parsePage(aspx, { name: "D.aspx" }));
    expect(md).not.toContain("Divider");
  });

  it("keeps an image's caption and alt text but not its asset path", () => {
    const aspx = makeAspx(webPartControl({
      id: IMAGE_ID,
      title: "Image",
      properties: { captionText: "Facade at dusk", altText: "Tower facade", fileName: "3509092396-Facade.jpg" },
      serverProcessedContent: { imageSources: { imageSource: "/sites/FAIKnowledgeBase/SiteAssets/x.jpg" } },
    }));
    const md = renderOptimized(parsePage(aspx, { name: "I.aspx" }));
    expect(md).toContain("Facade at dusk");
    expect(md).toContain("Tower facade");
    expect(md).not.toContain("3509092396");
    expect(md).not.toContain("SiteAssets");
  });

  it("never uses a web part's type name as a heading", () => {
    const aspx = makeAspx(webPartControl({
      id: PEOPLE_ID,
      title: "People",
      properties: { persons: [{ role: "Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { "persons[0].name": "A. Person", "persons[0].email": "a@b.com" } },
    }));
    const md = renderOptimized(parsePage(aspx, { name: "P.aspx" }));
    expect(md).toContain("- A. Person — Manager — a@b.com");
    expect(md).not.toContain("## People");
  });

  it("uses an authored web part title when the source has one", () => {
    const aspx = makeAspx(webPartControl({
      id: QUICK_LINKS_ID,
      title: "Quick links",
      properties: { items: [{}] },
      serverProcessedContent: {
        searchablePlainTexts: { title: "Socials &amp; Websites", "items[0].title": "FB" },
        links: { baseUrl: "/sites/X", "items[0].sourceItem.url": "https://fb.com/x" },
      },
    }));
    const md = renderOptimized(parsePage(aspx, { name: "Q.aspx" }));
    expect(md).toContain("## Socials & Websites");
    expect(md).toContain("- [FB](https://fb.com/x)");
  });
});
