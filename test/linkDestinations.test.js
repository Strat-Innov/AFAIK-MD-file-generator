import { describe, it, expect } from "vitest";
import { Parser, HtmlRenderer } from "commonmark";
import { renderOptimized } from "../src/lib/optimizedMd.js";
import { parsePage } from "../src/lib/aspxDocument.js";
import { normalize, tokenize } from "../src/lib/contentUnits.js";
import { makeAspx, webPartControl, corpusFiles, readCorpus, HAS_CORPUS } from "./helpers.js";
import { QUICK_LINKS_ID } from "../src/lib/webparts.js";

/* ------------------------------------------------------------------ *
 * A link destination containing whitespace does not parse as a
 * CommonMark link — `[x](http://a b)` survives as literal text, not as
 * a link. SharePoint stores some URLs unencoded, so this reached real
 * output: 11 destinations across 5 corpus pages. See GENERATOR-CONTRACT.
 *
 * These tests assert the property, not the URLs: every destination the
 * renderer emits must parse, whatever a future corpus contains.
 * ------------------------------------------------------------------ */

const parser = new Parser();
const html = new HtmlRenderer();

// Parses markdown and returns each link's destination, as a real
// CommonMark implementation resolves it — not as a regex hopes it does.
function hrefs(md) {
  const out = [];
  const walker = parser.parse(md).walker();
  let event;
  while ((event = walker.next())) {
    if (event.entering && event.node.type === "link") out.push(event.node.destination);
  }
  return out;
}

// A quick-links web part in the shape the extractor reads: titles from
// searchablePlainTexts, destinations from serverProcessedContent.links.
const linksPart = (items) => {
  const searchablePlainTexts = { title: "Docs" };
  const links = {};
  items.forEach((it, i) => {
    searchablePlainTexts[`items[${i}].title`] = it.title;
    links[`items[${i}].sourceItem.url`] = it.url;
  });
  return makeAspx(webPartControl({ id: QUICK_LINKS_ID, serverProcessedContent: { searchablePlainTexts, links } }));
};

describe("link destinations parse as links", () => {
  const SPACED = "https://example.sharepoint.com/sites/KB/Shared Documents/Operating Manual System (OMS) - FAI/Employees";

  it("emits a whitespace destination in the angle-bracket form", () => {
    const md = renderOptimized(parsePage(linksPart([{ title: "Employees", url: SPACED }]), { name: "x.aspx", path: "x.aspx" }));
    expect(md).toContain(`](<${SPACED}>)`);
  });

  it("that form parses to the destination, byte for byte", () => {
    const md = renderOptimized(parsePage(linksPart([{ title: "Employees", url: SPACED }]), { name: "x.aspx", path: "x.aspx" }));
    const found = hrefs(md).map(decodeURI);
    expect(found).toContain(SPACED);
  });

  // The regression: this is what the old renderer produced.
  it("the bare form it replaces would not have parsed at all", () => {
    expect(hrefs(`- [Employees](${SPACED})`)).toEqual([]);
    expect(html.render(parser.parse(`- [Employees](${SPACED})`))).toContain("[Employees](");
  });

  it("leaves an ordinary destination untouched", () => {
    const plain = "/sites/KB/Shared%20Documents/Memo/Gate%20Pass.pdf";
    const md = renderOptimized(parsePage(linksPart([{ title: "Gate Pass", url: plain }]), { name: "x.aspx", path: "x.aspx" }));
    expect(md).toContain(`](${plain})`);
    expect(md).not.toContain("](<");
    expect(hrefs(md)).toContain(plain);
  });

  // Wrapping a destination that already contains < or > would corrupt
  // it, so those are left exactly as the source has them.
  it("does not wrap a destination containing angle brackets", () => {
    const weird = "https://example.com/a b<c>";
    const md = renderOptimized(parsePage(linksPart([{ title: "Odd", url: weird }]), { name: "x.aspx", path: "x.aspx" }));
    expect(md).toContain(`](${weird})`);
    expect(md).not.toContain("](<");
  });
});

describe("the validator treats both destination forms as one", () => {
  const url = "https://example.com/Shared Documents/A B";
  it("normalizes an angle-bracketed destination to the bare one", () => {
    expect(normalize(`<${url}>`)).toBe(normalize(url));
  });
  it("tokenizes them identically", () => {
    expect(tokenize(`[Label](<${url}>)`)).toEqual(tokenize(`[Label](${url})`));
  });
  it("still strips the blockquote marker it always did", () => {
    expect(normalize("> quoted")).toBe(normalize("quoted"));
  });
});

describe.skipIf(!HAS_CORPUS)("every link in the corpus parses", () => {
  it("no emitted destination is lost to a parse failure", () => {
    const offenders = [];
    for (const name of corpusFiles()) {
      const md = renderOptimized(parsePage(readCorpus(name), { name, path: name }));
      // Count what the renderer emitted vs what a parser can recover.
      const emitted = [...md.matchAll(/\]\((<[^>]*>|[^)\s]*)\)/g)].length;
      const parsed = hrefs(md).length;
      if (parsed < emitted) offenders.push(`${name}: emitted ${emitted}, parsed ${parsed}`);
    }
    expect(offenders).toEqual([]);
  }, 300000);

  it("recovers the five pages that carried unencoded SharePoint URLs", () => {
    const affected = [
      "Cash-Advance-(CA).aspx", "Digital Library.aspx", "ETCPLUS(RESOURCES).aspx",
      "Permit.aspx", "Reimbursement-Requests.aspx",
    ].filter((n) => corpusFiles().includes(n));
    expect(affected.length).toBeGreaterThan(0);
    for (const name of affected) {
      const md = renderOptimized(parsePage(readCorpus(name), { name, path: name }));
      const spaced = hrefs(md).filter((h) => /%20|\s/.test(h));
      expect(spaced.length, `${name} should still expose its space-bearing URLs as real links`).toBeGreaterThan(0);
    }
  }, 300000);
});
