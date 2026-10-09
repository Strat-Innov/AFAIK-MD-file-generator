import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePage } from "../src/lib/generate.js";
import { parsePage } from "../src/lib/aspxDocument.js";
import { WEB_PART_TEXT_PROPERTIES, PEOPLE_ID, IMAGE_ID, AGENT_LINK_ID, QUICK_LINKS_ID } from "../src/lib/webparts.js";
import { makeAspx, textControl, webPartControl } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* A web part with no dedicated extractor — a Hero, a News roll-up, a
 * banner, whatever SharePoint adds next. */
const UNKNOWN = "11111111-2222-3333-4444-555555555555";

const build = (canvas, name = "T.aspx") =>
  generatePage({ name, path: name, raw: makeAspx(canvas) });

const PROSE = textControl("<h2>News</h2><p>Body text.</p>");

/* ------------------------------------------------------------------ *
 * SharePoint keeps most readable text under serverProcessedContent, but
 * not all of it. Image keeps its caption in properties.captionText, the
 * Agent link its label in properties.webPartTitle, and parts we have no
 * extractor for routinely carry a heading in properties.title.
 *
 * The unit harvester counted all of those as source content. The generic
 * renderer read none of them. So any unrecognised web part whose text
 * lived in properties was harvested, never emitted, and reported as a
 * missing unit — content a reader can see on the page that the optimized
 * file had simply lost, with coverage correctly refusing to publish it.
 *
 * Both sides now read one list. These tests hold them together.
 * ------------------------------------------------------------------ */

describe("an unrecognised web part cannot lose text kept in properties", () => {
  for (const field of WEB_PART_TEXT_PROPERTIES) {
    it(`renders properties.${field} instead of dropping it`, () => {
      const value = field === "linkUrl" ? "https://example.com/sportsfest" : `Value of ${field}`;
      const v = build(PROSE + webPartControl({ id: UNKNOWN, properties: { [field]: value } })).validation;
      expect(v.missing, `properties.${field} was harvested but never rendered`).toEqual([]);
      expect(v.status).toBe("PASS");
      expect(v.representedUnitCount).toBe(v.sourceUnitCount);
    });
  }

  it("renders several of them at once, the shape that failed", () => {
    // Three fields on one part: the 3-missing-unit signature.
    const v = build(PROSE + webPartControl({
      id: UNKNOWN,
      properties: { webPartTitle: "Sportsfest Highlights", captionText: "Team photo", altText: "Players on court" },
    })).validation;
    expect(v.missing).toEqual([]);
    expect(v.status).toBe("PASS");
  });

  it("the text actually appears in the output, not merely in the accounting", () => {
    const p = build(PROSE + webPartControl({ id: UNKNOWN, properties: { webPartTitle: "Sportsfest Highlights" } }));
    expect(p.md).toContain("Sportsfest Highlights");
  });

  it("uses properties.title as the heading when the part has no searchable title", () => {
    const p = build(PROSE + webPartControl({ id: UNKNOWN, properties: { title: "Anniversary Sportsfest" } }));
    expect(p.md).toContain("Anniversary Sportsfest");
    expect(p.validation.missing).toEqual([]);
  });

  it("prefers the searchable title when both are present, and loses neither", () => {
    const p = build(PROSE + webPartControl({
      id: UNKNOWN,
      serverProcessedContent: { searchablePlainTexts: { title: "Searchable heading" } },
      properties: { title: "Property heading" },
    }));
    expect(p.md).toContain("Searchable heading");
    expect(p.validation.missing).toEqual([]);
  });
});

describe("the fix adds content without inventing or duplicating any", () => {
  it("still excludes image assets, which are not something a reader reads", () => {
    const p = build(PROSE + webPartControl({
      id: UNKNOWN,
      properties: { linkUrl: "https://tenant.sharepoint.com/SiteAssets/banner.png" },
    }));
    expect(p.md).not.toContain("banner.png");
    expect(p.validation.unmatched).toEqual([]);
  });

  it("does not emit the same value twice when it appears in both places", () => {
    const p = build(PROSE + webPartControl({
      id: UNKNOWN,
      serverProcessedContent: { searchablePlainTexts: { body: "Shared value" } },
      properties: { captionText: "Shared value" },
    }));
    expect(p.md.split("Shared value").length - 1).toBe(1);
    expect(p.validation.status).toBe("PASS");
  });

  it("invents nothing — a part with empty properties renders as before", () => {
    const p = build(PROSE + webPartControl({ id: UNKNOWN, properties: { captionText: "", title: "" } }));
    expect(p.validation.unmatched).toEqual([]);
    expect(p.validation.status).toBe("PASS");
  });
});

describe("the parts that already had extractors are untouched", () => {
  const cases = {
    people: webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "TEAM", "persons[0].name": "A. One", "persons[0].email": "one@example.com" } },
    }),
    image: webPartControl({ id: IMAGE_ID, properties: { captionText: "A caption", altText: "Alt text" } }),
    agent: webPartControl({ id: AGENT_LINK_ID, properties: { webPartTitle: "Ask the agent" } }),
    quickLinks: webPartControl({
      id: QUICK_LINKS_ID, title: "Quick links",
      properties: { items: [{}] },
      serverProcessedContent: {
        searchablePlainTexts: { title: "Socials", "items[0].title": "Facebook" },
        links: { baseUrl: "/x", "items[0].sourceItem.url": "https://fb.example.com/a" },
      },
    }),
  };

  for (const [name, control] of Object.entries(cases)) {
    it(`${name} still validates, and its fields are not duplicated`, () => {
      const p = build(PROSE + control);
      expect(p.validation.status).toBe("PASS");
      expect(p.validation.missing).toEqual([]);
      expect(p.validation.unmatched).toEqual([]);
    });
  }

  it("the Image caption comes from the image extractor, printed once", () => {
    const p = build(PROSE + webPartControl({ id: IMAGE_ID, properties: { captionText: "A caption" } }));
    expect(p.md.split("A caption").length - 1).toBe(1);
  });
});

describe("one list, read by both sides", () => {
  it("the harvester and the renderer import the same constant", () => {
    for (const f of ["src/lib/contentUnits.js", "src/lib/aspxDocument.js"]) {
      const srcText = fs.readFileSync(path.join(root, f), "utf8");
      expect(srcText, `${f} must read the shared list`).toContain("WEB_PART_TEXT_PROPERTIES");
      expect(srcText, `${f} must not keep its own copy`)
        .not.toMatch(/\["captionText", "altText", "overlayText"/);
    }
  });

  it("covers every field the harvester counts", () => {
    // Adding a field to the list without teaching the renderer about it
    // would reintroduce exactly this bug; this fails if that happens.
    for (const field of WEB_PART_TEXT_PROPERTIES) {
      const value = field === "linkUrl" ? "https://example.com/x" : `probe ${field}`;
      const v = build(PROSE + webPartControl({ id: UNKNOWN, properties: { [field]: value } })).validation;
      expect(v.missing, `WEB_PART_TEXT_PROPERTIES includes ${field} but the renderer drops it`).toEqual([]);
    }
  });

  it("a page model still carries the part as one section", () => {
    const page = parsePage(makeAspx(PROSE + webPartControl({ id: UNKNOWN, properties: { webPartTitle: "X" } })), { name: "T.aspx" });
    expect(page.sections.filter((s) => s.kind === "webpart")).toHaveLength(1);
  });
});
