import { describe, it, expect } from "vitest";
import { parsePage, parseCanvas } from "../src/lib/aspxDocument.js";
import { renderOptimized } from "../src/lib/optimizedMd.js";
import { validateCoverage } from "../src/lib/coverage.js";
import { tokenize, normalize } from "../src/lib/contentUnits.js";
import { textControl, webPartControl, makeAspx } from "./helpers.js";
import { QUICK_LINKS_ID, PEOPLE_ID, IMAGE_ID } from "../src/lib/webparts.js";

const build = (canvas, name = "T.aspx") => {
  const page = parsePage(makeAspx(canvas), { name, path: name });
  const md = renderOptimized(page);
  return { md, page, check: (override) => validateCoverage(parseCanvas(page.canvasHtml), override ?? md, { pageName: name }) };
};

/* ---- the four extraction gaps found by the 133-page corpus audit ---- */

describe("extraction gaps closed by the corpus audit", () => {
  it("keeps a People section title stored in searchablePlainTexts.title", () => {
    const { md, check } = build(webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Leasing Associate" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "LEASING", "persons[0].name": "A. Person", "persons[0].email": "a@b.com" } },
    }));
    expect(md).toContain("## LEASING");
    expect(check().status).toBe("PASS");
  });

  it("keeps a web part whose only content is its title", () => {
    const { md, check } = build(webPartControl({
      id: "8c88f208-6c77-4bdb-86a0-0c47b4316588", title: "News",
      properties: {},
      serverProcessedContent: { searchablePlainTexts: { title: "Company News &amp; Announcements" }, links: { baseUrl: "/sites/X" } },
    }));
    expect(md).toContain("## Company News & Announcements");
    expect(check().status).toBe("PASS");
  });

  it("keeps an image click-through URL from serverProcessedContent.links.linkUrl", () => {
    const { md, check } = build(webPartControl({
      id: IMAGE_ID, title: "Image",
      properties: { captionText: "", altText: "", linkUrl: "" },
      serverProcessedContent: { links: { linkUrl: "/sites/FAIKnowledgeBase/SitePages/Lost-Page.aspx" } },
    }));
    expect(md).toContain("/sites/FAIKnowledgeBase/SitePages/Lost-Page.aspx");
    expect(check().status).toBe("PASS");
  });

  it("does not fuse multiple <p> inside one <li>", () => {
    const { md, check } = build(textControl(
      "<h2>Amenities</h2><ul><li><p>The Palms Country Club</p><p>Private Access</p><p>(Exclusive for Club Members)</p></li></ul>"
    ));
    expect(md).toContain("- The Palms Country Club");
    expect(md).toContain("- Private Access");
    expect(md).toContain("- (Exclusive for Club Members)");
    expect(md).not.toContain("ClubPrivate");
    expect(check().status).toBe("PASS");
  });
});

/* ---- the matcher: masking is what made a green PASS untrustworthy ---- */

describe("token matching defeats substring masking", () => {
  it("does not accept a unit found inside a longer word", () => {
    // "LEASING" occurs inside "subleasing/assignment" — a real case from
    // ENTRATA-RETAIL-CENTER.aspx, where the old substring check passed a
    // page that had genuinely lost the heading.
    const { check, md } = build(
      textControl("<h2>Terms</h2><p>Subleasing/assignment: strictly not allowed</p>") +
      webPartControl({
        id: PEOPLE_ID, title: "People",
        properties: { persons: [{ role: "Associate" }] },
        serverProcessedContent: { searchablePlainTexts: { title: "LEASING", "persons[0].name": "A. Person", "persons[0].email": "a@b.com" } },
      })
    );
    expect(md).toContain("subleasing/assignment".replace("s", "S"));
    const broken = md.replace(/^## LEASING$/m, "");
    expect(broken).toMatch(/ubleasing/);
    const res = check(broken);
    expect(res.status).toBe("FAIL");
    expect(res.missing).toContain("LEASING");
  });

  it("does not let one occurrence satisfy two different units", () => {
    // "PROJECT DEVELOPMENT" as a section heading must not be considered
    // present merely because a person's role reads "Project Development
    // Specialist". Each unit has to claim its own tokens.
    const { md, check } = build(webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Project Development Specialist" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "PROJECT DEVELOPMENT", "persons[0].name": "D. Canlas", "persons[0].email": "d@b.com" } },
    }));
    const broken = md.replace(/^## PROJECT DEVELOPMENT$/m, "");
    expect(broken).toMatch(/Project Development Specialist/);
    const res = check(broken);
    expect(res.status).toBe("FAIL");
    expect(res.missing).toContain("PROJECT DEVELOPMENT");
  });

  it("still lets one line legitimately carry several distinct units", () => {
    const { check } = build(webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Sales Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "SALES", "persons[0].name": "K. Santos", "persons[0].email": "k@b.com" } },
    }));
    expect(check().status).toBe("PASS");
  });

  it("tolerates the same value legitimately appearing twice", () => {
    // Two people sharing a role, and a caption repeated on two images:
    // source units are deduplicated, the output is not.
    const person = (n, e) => webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Project Development Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "PD", [`persons[0].name`]: n, [`persons[0].email`]: e } },
    });
    const res = build(person("A. One", "a@b.com") + person("B. Two", "b@b.com")).check();
    expect(res.status).toBe("PASS");
    expect(res.unmatched).toEqual([]);
  });

  it("normalizes formatting but never conflates different values", () => {
    expect(tokenize("97–120 sqm")).toEqual(tokenize("97-120 sqm"));
    expect(normalize("**₱25.5M**")).toBe("₱25.5m");
    expect(tokenize("Total: 94.")).toEqual(["total", "94"]);
    expect(tokenize("leasing")).not.toEqual(tokenize("subleasing"));
  });
});

/* ---- the three validation-model defects ---- */

describe("validation-model defects closed", () => {
  it("does not fail a list item whose text precedes a nested list", () => {
    // <li>Consultant<ul>…</ul></li> — closing-tag-only splitting fused
    // "Consultant" with the nested item and produced a false failure.
    const { md, check } = build(textControl(
      "<h2>Details</h2><ul><li>Consultant<ul><li><p>Architecture – Pimentel Rodriguez</p></li></ul></li></ul>"
    ));
    expect(md).toContain("- Consultant");
    expect(md).toContain("- Architecture – Pimentel Rodriguez");
    expect(check().status).toBe("PASS");
  });

  it("does not fail prose containing an inline link", () => {
    const { md, check } = build(textControl(
      '<h2>How to submit</h2><p>Submit files to the BI Team (<a href="mailto:bi@example.com">bi@example.com</a>) before Friday.</p>'
    ));
    expect(md).toContain("mailto:bi@example.com");
    expect(check().status).toBe("PASS");
  });

  it("validates RTE link targets rather than discarding them", () => {
    const { md, check } = build(textControl(
      '<h2>Support</h2><p>Raise a ticket in <a href="https://onesupport.example.com/app/HomePage.do">OneSupport</a>.</p>'
    ));
    expect(check().status).toBe("PASS");
    const withoutUrl = md.replace("https://onesupport.example.com/app/HomePage.do", "");
    const res = check(withoutUrl);
    expect(res.status).toBe("FAIL");
    expect(res.missing).toContain("https://onesupport.example.com/app/HomePage.do");
  });

  it("treats a filename-derived title as scaffolding on a page with no heading", () => {
    // The 7 web-part-only pages in the corpus have no heading to promote.
    const { md, check } = build(webPartControl({
      id: QUICK_LINKS_ID, title: "Quick links",
      properties: { items: [{}] },
      serverProcessedContent: { searchablePlainTexts: { title: "Links", "items[0].title": "Home" }, links: { "items[0].sourceItem.url": "/x" } },
    }), "Event-Gallery.aspx");
    expect(md).toContain("# Event-Gallery");
    const res = check();
    expect(res.status).toBe("PASS");
    expect(res.unmatched).toEqual([]);
  });

  it("still validates a real heading that happens to equal the file name", () => {
    // ARBORAGE.aspx really does have "ARBORAGE" as its heading; treating
    // every such line as scaffolding made a genuine unit unmatchable.
    const { md, check } = build(textControl("<h2>ARBORAGE</h2><p>A residential development.</p>"), "ARBORAGE.aspx");
    expect(md).toContain("# ARBORAGE");
    expect(check().status).toBe("PASS");
    const res = check(md.replace(/^# ARBORAGE$/m, "#"));
    expect(res.status).toBe("FAIL");
    expect(res.missing).toContain("ARBORAGE");
  });
});
