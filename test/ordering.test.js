import { describe, it, expect } from "vitest";
import { parsePage, parseCanvas } from "../src/lib/aspxDocument.js";
import { renderOptimized } from "../src/lib/optimizedMd.js";
import { validateCoverage } from "../src/lib/coverage.js";
import { textControl, webPartControl, makeAspx } from "./helpers.js";
import { QUICK_LINKS_ID, PEOPLE_ID } from "../src/lib/webparts.js";

const build = (canvas, name = "T.aspx") => {
  const page = parsePage(makeAspx(canvas), { name, path: name });
  const md = renderOptimized(page);
  return { md, check: (o) => validateCoverage(parseCanvas(page.canvasHtml), o ?? md, { pageName: name }) };
};

// Presence is not meaning. These two documents hold identical tokens and
// say different things:
//   2-BR Platinum / 97–120 sqm / ₱25.5M    vs    2-BR Platinum / ₱25.5M / 97–120 sqm
// A token-presence check cannot tell them apart; these can.
describe("ordering and adjacency", () => {
  const pricing = textControl(
    "<h2>Units &amp; Pricing</h2><p>2-BR Platinum<br>97–120 sqm<br>₱25.5M – ₱27.3M<br>3-BR Platinum<br>154–181 sqm<br>₱40.7M – ₱45.1M</p>"
  );

  it("passes a correctly ordered document", () => {
    expect(build(pricing).check().status).toBe("PASS");
  });

  it("detects a size and its price swapping places", () => {
    const { md, check } = build(pricing);
    const swapped = md.replace("97–120 sqm\n₱25.5M – ₱27.3M", "₱25.5M – ₱27.3M\n97–120 sqm");
    expect(swapped).not.toBe(md);
    const res = check(swapped);
    expect(res.status).toBe("FAIL");
    expect(res.ordering.length).toBeGreaterThan(0);
  });

  it("detects a fact moved away from the block it belongs to", () => {
    const { md, check } = build(pricing);
    // Moved to the end of the body, before the provenance block.
    const moved = md.replace("97–120 sqm\n", "").replace("\n## Source", "\n97–120 sqm\n\n## Source");
    expect(moved).not.toBe(md);
    const res = check(moved);
    expect(res.status).toBe("FAIL");
    expect(res.ordering.length).toBeGreaterThan(0);
  });

  it("detects a heading moved below the content it introduces", () => {
    const { md, check } = build(pricing);
    const res = check(md.replace(/^# Units & Pricing\n\n(.*)$/ms, "$1\n\n# Units & Pricing"));
    expect(res.status).toBe("FAIL");
  });

  it("keeps a person's name with their own email", () => {
    const people = (n, e) => webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "SALES", "persons[0].name": n, "persons[0].email": e } },
    });
    const { md, check } = build(people("A. One", "one@example.com") + people("B. Two", "two@example.com"));
    expect(check().status).toBe("PASS");
    // Swap the two emails: every token is still present, but each name
    // now carries the other person's address.
    const swapped = md.replace("one@example.com", "TMP").replace("two@example.com", "one@example.com").replace("TMP", "two@example.com");
    const res = check(swapped);
    expect(res.status).toBe("FAIL");
    expect(res.association.length).toBeGreaterThan(0);
  });

  it("keeps a link label with its own target", () => {
    const { md, check } = build(webPartControl({
      id: QUICK_LINKS_ID, title: "Quick links",
      properties: { items: [{}, {}] },
      serverProcessedContent: {
        searchablePlainTexts: { title: "Socials", "items[0].title": "Facebook", "items[1].title": "Website" },
        links: { baseUrl: "/x", "items[0].sourceItem.url": "https://fb.example.com/a", "items[1].sourceItem.url": "https://site.example.com/b" },
      },
    }));
    expect(check().status).toBe("PASS");
    const swapped = md.replace("https://fb.example.com/a", "TMP").replace("https://site.example.com/b", "https://fb.example.com/a").replace("TMP", "https://site.example.com/b");
    const res = check(swapped);
    expect(res.status).toBe("FAIL");
    expect(res.association.length).toBeGreaterThan(0);
  });
});

describe("altered content is blocked, not merely noted", () => {
  const page = textControl("<h2>Rates</h2><p>Standard rate<br>₱1,250 per sqm</p>");

  it("fails on an altered value even though the original still appears elsewhere", () => {
    const { md, check } = build(textControl("<h2>ARBORAGE</h2><p>ARBORAGE is a development.</p>"), "ARBORAGE.aspx");
    const res = check(md.replace("# ARBORAGE", "# ARBORAGE Revised"));
    expect(res.status).toBe("FAIL");
    expect(res.unmatched.flatMap((u) => u.tokens)).toContain("revised");
  });

  it("fails on an altered price", () => {
    const { md, check } = build(page);
    const res = check(md.replace("₱1,250", "₱6,250"));
    expect(res.status).toBe("FAIL");
  });
});

describe("legitimate restructuring still passes", () => {
  const canvas =
    textControl("<h2>Process</h2><ol><li><p>Prepare the required documents</p></li><li><p>Submit to the desk</p></li></ol>") +
    webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Manager" }, { role: "Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "TEAM", "persons[0].name": "A. One", "persons[0].email": "a@x.com", "persons[1].name": "B. Two", "persons[1].email": "b@x.com" } },
    });

  for (const [label, mangle] of [
    ["bold added around list markers", (md) => md.split("\n").map((l) => (l.trim() && !l.startsWith("#") ? `**${l}**` : l)).join("\n")],
    ["heading depth changed", (md) => md.replace(/^## /gm, "#### ")],
    ["bullet style changed", (md) => md.replace(/^- /gm, "* ")],
    ["blank lines inserted", (md) => md.split("\n").flatMap((l) => [l, ""]).join("\n")],
    ["ordered markers renumbered", (md) => md.replace(/^\d+\. /gm, "1. ")],
  ]) {
    it(`${label} does not fail`, () => {
      const { md, check } = build(canvas);
      const res = check(mangle(md));
      expect({ label, ...res, missing: res.missing, ordering: res.ordering, unmatched: res.unmatched }).toMatchObject({ status: "PASS" });
    });
  }

  it("tolerates a repeated role across two people", () => {
    expect(build(canvas).check().status).toBe("PASS");
  });
});
