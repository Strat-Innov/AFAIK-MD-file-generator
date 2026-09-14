import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { textControl, webPartControl, makeAspx } from "./helpers.js";
import { PEOPLE_ID } from "../src/lib/webparts.js";

/* ------------------------------------------------------------------ *
 * The coverage validator used to walk the canvas itself, in DOM order,
 * to decide what order the rendered document SHOULD be in. The parser
 * walked the canvas separately to decide what order it WOULD be in.
 * Two independent walks that agreed only because both were DOM order.
 *
 * That made the ordering check unable to answer its own question: asked
 * whether DOM order is reading order, it answered by assuming it, and
 * any parser that ordered controls differently was reported as having
 * transposed content no matter how faithful it was.
 *
 * Both sides now read canvasOrder.js. These tests hold the seam: the
 * validator must follow whatever canonical order it is given, and must
 * still catch a renderer that drops, duplicates, invents, or transposes
 * content relative to that order.
 * ------------------------------------------------------------------ */

const PRICING = textControl(
  "<h2>Units &amp; Pricing</h2><p>2-BR Platinum<br>97–120 sqm<br>₱25.5M – ₱27.3M</p>",
  { controlIndex: 1 }
);
const AMENITIES = textControl(
  "<h2>Amenities</h2><p>Clubhouse<br>Lap Pool</p>",
  { zoneIndex: 2, controlIndex: 1 }
);

/** Import the pipeline fresh, so a mocked canvasOrder.js takes effect. */
async function pipeline() {
  const { parsePage, parseCanvas } = await import("../src/lib/aspxDocument.js");
  const { renderOptimized } = await import("../src/lib/optimizedMd.js");
  const { validateCoverage } = await import("../src/lib/coverage.js");
  return { parsePage, parseCanvas, renderOptimized, validateCoverage };
}

async function build(canvas, name = "T.aspx") {
  const { parsePage, parseCanvas, renderOptimized, validateCoverage } = await pipeline();
  const page = parsePage(makeAspx(canvas), { name, path: name });
  const md = renderOptimized(page);
  return { page, md, check: (o) => validateCoverage(parseCanvas(page.canvasHtml), o ?? md, { pageName: name }) };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.doUnmock("../src/lib/canvasOrder.js"));

describe("the validator follows the canonical order, whatever it is", () => {
  it("passes a faithful rendering under the default (DOM) order", async () => {
    expect((await build(PRICING + AMENITIES)).check().status).toBe("PASS");
  });

  it("passes a faithful rendering when the canonical order is REVERSED", async () => {
    // The parser and the validator both follow the policy, so a policy
    // that emits controls back-to-front is still internally coherent and
    // must validate. Before the re-base this failed: the renderer used
    // the new order while the validator still expected DOM order.
    vi.doMock("../src/lib/canvasOrder.js", () => ({
      CANVAS_ORDER_POLICY: "reversed",
      canonicalControls: (doc) => [...doc.querySelectorAll("[data-sp-canvascontrol]")].reverse(),
    }));
    const { md, check } = await build(PRICING + AMENITIES);
    expect(md.indexOf("Amenities")).toBeLessThan(md.indexOf("Units & Pricing"));
    expect(check().status).toBe("PASS");
  });

  it("reports the SAME verdict for a faithful rendering under either policy", async () => {
    const dom = (await build(PRICING + AMENITIES)).check().status;
    vi.resetModules();
    vi.doMock("../src/lib/canvasOrder.js", () => ({
      CANVAS_ORDER_POLICY: "reversed",
      canonicalControls: (doc) => [...doc.querySelectorAll("[data-sp-canvascontrol]")].reverse(),
    }));
    expect((await build(PRICING + AMENITIES)).check().status).toBe(dom);
  });

  it("orders source groups by the canonical policy, not by DOM position", async () => {
    vi.doMock("../src/lib/canvasOrder.js", () => ({
      CANVAS_ORDER_POLICY: "reversed",
      canonicalControls: (doc) => [...doc.querySelectorAll("[data-sp-canvascontrol]")].reverse(),
    }));
    const { parseCanvas } = await pipeline();
    const { sourceModel } = await import("../src/lib/contentUnits.js");
    const { canvasHtmlOf } = await import("../src/lib/aspxDocument.js");
    const { groups } = sourceModel(parseCanvas(canvasHtmlOf(makeAspx(PRICING + AMENITIES))));
    expect(groups[0].keys.join(" ")).toContain("amenities");
  });
});

/* The four things coverage must still catch. Each is checked under the
 * default policy AND under a reordering policy, because a validator that
 * only works when nothing moved is the bug we just removed. */
for (const [policyName, mock] of [
  ["default DOM order", null],
  ["a reordering policy", () => ({
    CANVAS_ORDER_POLICY: "reversed",
    canonicalControls: (doc) => [...doc.querySelectorAll("[data-sp-canvascontrol]")].reverse(),
  })],
]) {
  describe(`coverage still catches a faithless renderer — ${policyName}`, () => {
    const setup = async (canvas = PRICING + AMENITIES) => {
      if (mock) vi.doMock("../src/lib/canvasOrder.js", mock);
      return build(canvas);
    };

    it("a DROPPED unit is reported missing", async () => {
      const { md, check } = await setup();
      const res = check(md.replace("Lap Pool\n", ""));
      expect(res.status).toBe("FAIL");
      expect(res.missing.join(" ")).toContain("Lap Pool");
    });

    it("a DUPLICATED unit is tolerated as a legitimate repeat", async () => {
      // Deliberate, and documented at coverage.js:167-183: the renderer
      // legitimately repeats values (two people share a role, "Learn
      // more" captions several images), so an unclaimed run whose every
      // token is explained by some source unit is a repeat, not
      // untraceable content. Duplication is therefore NOT a coverage
      // finding — pinned here so the limit is visible rather than
      // assumed, and so the re-base is not read as having removed it.
      const { md, check } = await setup();
      const res = check(md.replace("Clubhouse", "Clubhouse\nClubhouse"));
      expect(res.status).toBe("PASS");
      expect(res.unmatched).toEqual([]);
    });

    it("a FUSED unit — the seam of two values run together — is caught", async () => {
      // This is what the unmatched check is really for: "clubhouselap"
      // is a token no source unit contains, so it cannot be tiled and is
      // reported, where a clean repeat is not.
      const { md, check } = await setup();
      const res = check(md.replace("Clubhouse\nLap Pool", "ClubhouseLap Pool"));
      expect(res.status).toBe("FAIL");
      expect(res.unmatched.flatMap((u) => u.tokens).join(" ")).toContain("clubhouselap");
    });

    it("an INVENTED unit is unmatched", async () => {
      const { md, check } = await setup();
      const res = check(md.replace("Lap Pool", "Lap Pool\nRooftop Helipad"));
      expect(res.status).toBe("FAIL");
      expect(res.unmatched.flatMap((u) => u.tokens)).toContain("helipad");
    });

    it("an ALTERED value is unmatched even though the original still appears", async () => {
      const { md, check } = await setup();
      const res = check(md.replace("₱25.5M", "₱95.5M"));
      expect(res.status).toBe("FAIL");
    });

    it("INTRA-RTE ordering corruption still fails", async () => {
      // Prose inside ONE rich-text control has an unambiguous reading
      // order. That invariant is independent of the canvas policy and
      // must survive it untouched.
      const { md, check } = await setup();
      const swapped = md.replace("97–120 sqm\n₱25.5M – ₱27.3M", "₱25.5M – ₱27.3M\n97–120 sqm");
      expect(swapped).not.toBe(md);
      const res = check(swapped);
      expect(res.status).toBe("FAIL");
      expect(res.ordering.length).toBeGreaterThan(0);
    });

    it("a PARSER/RENDERER mismatch — content transposed ACROSS controls — still fails", async () => {
      const { md, check } = await setup();
      // Move a unit out of its own control's block and into the other's.
      const moved = md.replace("Clubhouse\n", "").replace("2-BR Platinum", "Clubhouse\n2-BR Platinum");
      expect(moved).not.toBe(md);
      expect(check(moved).status).toBe("FAIL");
    });

    it("keeps a person's name with their own email", async () => {
      const people = (n, e) => webPartControl({
        id: PEOPLE_ID, title: "People",
        properties: { persons: [{ role: "Manager" }] },
        serverProcessedContent: { searchablePlainTexts: { title: "TEAM", "persons[0].name": n, "persons[0].email": e } },
      });
      const { md, check } = await setup(people("A. One", "one@example.com") + people("B. Two", "two@example.com"));
      expect(check().status).toBe("PASS");
      const swapped = md.replace("one@example.com", "TMP")
        .replace("two@example.com", "one@example.com").replace("TMP", "two@example.com");
      const res = check(swapped);
      expect(res.status).toBe("FAIL");
      expect(res.association.length).toBeGreaterThan(0);
    });
  });
}

describe("fallback when layout coordinates are unavailable", () => {
  it("the shipped policy is DOM order, and says so", async () => {
    const { CANVAS_ORDER_POLICY, canonicalControls } = await import("../src/lib/canvasOrder.js");
    expect(CANVAS_ORDER_POLICY).toBe("dom");
    const { parseCanvas, canvasHtmlOf } = await import("../src/lib/aspxDocument.js");
    const doc = parseCanvas(canvasHtmlOf(makeAspx(PRICING + AMENITIES)));
    expect(canonicalControls(doc)).toEqual([...doc.querySelectorAll("[data-sp-canvascontrol]")]);
  });

  it("controls carrying NO flexibleLayoutPosition are ordered exactly as before", async () => {
    // The synthetic builders emit no flexible coordinates at all, which
    // is the fallback case a layout-aware policy must honour. Section
    // order must equal DOM order here, today and after any such policy
    // lands — otherwise the fallback is not a fallback.
    const { page } = await build(PRICING + AMENITIES);
    const headings = page.sections.flatMap((s) =>
      (s.blocks ?? []).filter((b) => b.type === "heading").map((b) => b.text));
    expect(headings).toEqual(["Units & Pricing", "Amenities"]);
  });

  it("a page with a single control is order-invariant", async () => {
    vi.doMock("../src/lib/canvasOrder.js", () => ({
      CANVAS_ORDER_POLICY: "reversed",
      canonicalControls: (doc) => [...doc.querySelectorAll("[data-sp-canvascontrol]")].reverse(),
    }));
    expect((await build(PRICING)).check().status).toBe("PASS");
  });
});

describe("the re-base changed no output", () => {
  it("both readers resolve to the same single ordering authority", async () => {
    const aspx = await import("../src/lib/aspxDocument.js?raw-check");
    expect(typeof aspx.parsePage).toBe("function");
    // The parser and the unit model must not re-derive an order of their
    // own; a direct querySelectorAll walk in either is the regression.
    const fs = await import("node:fs");
    const url = await import("node:url");
    const path = await import("node:path");
    const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
    for (const f of ["src/lib/aspxDocument.js", "src/lib/contentUnits.js"]) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src, `${f} must import the canonical order`).toContain('from "./canvasOrder.js"');
      expect(src, `${f} must not walk canvas controls itself`)
        .not.toMatch(/querySelectorAll\(\s*["'`]\[data-sp-canvascontrol\]/);
    }
  });
});
