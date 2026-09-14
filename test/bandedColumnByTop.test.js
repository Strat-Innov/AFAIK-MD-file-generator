import { describe, it, expect } from "vitest";
import { textControl, webPartControl, makeAspx } from "./helpers.js";
import { parsePage, parseCanvas, canvasHtmlOf } from "../src/lib/aspxDocument.js";
import { canonicalControls, DOM, BANDED_COLUMN_BY_TOP } from "../src/lib/canvasOrder.js";
import { PEOPLE_ID } from "../src/lib/webparts.js";

/* ------------------------------------------------------------------ *
 * The layout-aware policy, clause by clause against benchmark/
 * ORDERING-SPEC.md §2. Each case here is a shape taken from the real
 * September V2 corpus, rebuilt synthetically so it can be asserted
 * without shipping page content into a public repository.
 * ------------------------------------------------------------------ */

const heading = (text, position, flex) => textControl(`<h2>${text}</h2>`, position, flex);
const body = (text, position, flex) => textControl(`<p>${text}</p>`, position, flex);

/** Every section in canonical order — text blocks by their text, web
 *  parts by their title — which is what every ordering claim is about. */
const order = (canvas, policy) =>
  parsePage(makeAspx(canvas), { name: "T.aspx", path: "T.aspx", orderPolicy: policy })
    .sections.flatMap((s) =>
      s.kind === "webpart"
        ? [`[${s.content.title ?? s.content.type ?? "webpart"}]`]
        : (s.blocks ?? []).map((b) => b.text ?? b.lines?.join(" ") ?? ""))
    .filter(Boolean);

describe("clause 4b — a column is read when its first element is reached", () => {
  // A hero image in the left column beside a title in the right. Ordering
  // columns by left edge puts the image first and the page derives its
  // entity from the wrong heading; ordering by topmost element does not.
  const canvas =
    body("Hero image", { controlIndex: 1 }, { x: 0, y: 3, w: 34, h: 20 }) +
    heading("SOUTHKEY PLACE", { controlIndex: 2 }, { x: 36, y: 2, w: 33, h: 5 }) +
    heading("Overview", { controlIndex: 3 }, { x: 36, y: 9, w: 33, h: 3 });

  it("puts the title first even though another column starts further left", () => {
    expect(order(canvas, BANDED_COLUMN_BY_TOP)[0]).toBe("SOUTHKEY PLACE");
  });

  it("is the case DOM order gets wrong", () => {
    expect(order(canvas, DOM)[0]).toBe("Hero image");
  });
});

describe("clause 3 — a full-width rule splits a zone into bands", () => {
  // Three spec columns under one divider. Without the split the divider
  // overlaps every column, collapses them into one, and each heading is
  // paired with the next column's body.
  const canvas =
    webPartControl({ id: "divider", title: "Divider" }, { controlIndex: 1 }, { x: 0, y: 0, w: 70, h: 0 }) +
    heading("Lot Sizes", { controlIndex: 2 }, { x: 0, y: 1, w: 17, h: 3 }) +
    heading("Amenities", { controlIndex: 3 }, { x: 56, y: 1, w: 10, h: 3 }) +
    heading("Payment Schemes", { controlIndex: 4 }, { x: 23, y: 1, w: 24, h: 3 }) +
    body("168 to 544 sqm", { controlIndex: 5 }, { x: 0, y: 4, w: 22, h: 3 }) +
    body("Cash with discount", { controlIndex: 6 }, { x: 26, y: 4, w: 18, h: 37 }) +
    body("Clubhouse and Pool", { controlIndex: 7 }, { x: 52, y: 4, w: 18, h: 6 });

  it("pairs every heading with its own column's body", () => {
    expect(order(canvas, BANDED_COLUMN_BY_TOP)).toEqual([
      "Lot Sizes", "168 to 544 sqm",
      "Payment Schemes", "Cash with discount",
      "Amenities", "Clubhouse and Pool",
    ]);
  });

  it("is the case DOM order gets wrong — Amenities lands on the payment body", () => {
    const domOrder = order(canvas, DOM);
    expect(domOrder.indexOf("Amenities")).toBeLessThan(domOrder.indexOf("Payment Schemes"));
    expect(domOrder[domOrder.indexOf("Amenities") + 1]).not.toBe("Clubhouse and Pool");
  });

  it("treats a wide BODY as content, not as a rule — height is the difference", () => {
    // Same geometry but the full-width control has height: it is a body
    // of text, not a divider, and must not split the zone.
    const wide =
      body("A full width introduction", { controlIndex: 1 }, { x: 0, y: 0, w: 70, h: 4 }) +
      heading("Left", { controlIndex: 2 }, { x: 0, y: 5, w: 20, h: 3 }) +
      heading("Right", { controlIndex: 3 }, { x: 40, y: 5, w: 20, h: 3 });
    expect(order(wide, BANDED_COLUMN_BY_TOP)[0]).toBe("A full width introduction");
  });
});

describe("clause 5 — a single-column zone reduces to vertical order", () => {
  const canvas =
    webPartControl({
      id: PEOPLE_ID, title: "People",
      properties: { persons: [{ role: "Manager" }] },
      serverProcessedContent: { searchablePlainTexts: { title: "TEAM", "persons[0].name": "A. One", "persons[0].email": "one@example.com" } },
    }, { controlIndex: 1 }, { x: 0, y: 4, w: 70, h: 5 }) +
    heading("Marketing", { controlIndex: 2 }, { x: 0, y: 0, w: 22, h: 3 });

  it("puts the heading above the roster it labels", () => {
    // The Filinvest-Mimosa shape: 71 such zones in the V2 corpus, of
    // which DOM order puts 11 the wrong way round.
    expect(order(canvas, BANDED_COLUMN_BY_TOP)[0]).toBe("Marketing");
  });

  it("is the case DOM order gets wrong", () => {
    expect(order(canvas, DOM)[0]).not.toBe("Marketing");
  });
});

describe("clause 1 — fallback, and clause 2's determinism", () => {
  const doc = (canvas) => parseCanvas(canvasHtmlOf(makeAspx(canvas)));

  it("falls back for a zone where only SOME controls carry coordinates", () => {
    const mixed =
      heading("With", { controlIndex: 1 }, { x: 40, y: 0, w: 20, h: 3 }) +
      heading("Without", { controlIndex: 2 });
    expect(canonicalControls(doc(mixed), BANDED_COLUMN_BY_TOP))
      .toEqual(canonicalControls(doc(mixed), DOM));
  });

  it("falls back for a zone with no coordinates at all", () => {
    const none = heading("One", { controlIndex: 1 }) + heading("Two", { controlIndex: 2 });
    expect(canonicalControls(doc(none), BANDED_COLUMN_BY_TOP)).toEqual(canonicalControls(doc(none), DOM));
  });

  it("keeps zones in serialised order and only reorders within them", () => {
    const twoZones =
      heading("Zone one second", { zoneIndex: 1, controlIndex: 1 }, { x: 0, y: 9, w: 20, h: 3 }) +
      heading("Zone one first", { zoneIndex: 1, controlIndex: 2 }, { x: 0, y: 1, w: 20, h: 3 }) +
      heading("Zone two", { zoneIndex: 2, controlIndex: 1 }, { x: 0, y: 0, w: 20, h: 3 });
    expect(order(twoZones, BANDED_COLUMN_BY_TOP)).toEqual(["Zone one first", "Zone one second", "Zone two"]);
  });

  it("breaks a total tie on controlIndex, so the order is deterministic", () => {
    const tied =
      heading("B", { controlIndex: 2 }, { x: 0, y: 0, w: 20, h: 3 }) +
      heading("A", { controlIndex: 1 }, { x: 0, y: 0, w: 20, h: 3 });
    expect(order(tied, BANDED_COLUMN_BY_TOP)).toEqual(["A", "B"]);
  });

  it("is stable across repeated calls on the same document", () => {
    const canvas =
      heading("One", { controlIndex: 1 }, { x: 0, y: 4, w: 30, h: 3 }) +
      heading("Two", { controlIndex: 2 }, { x: 35, y: 0, w: 30, h: 3 });
    const d = doc(canvas);
    const a = canonicalControls(d, BANDED_COLUMN_BY_TOP);
    expect(canonicalControls(d, BANDED_COLUMN_BY_TOP)).toEqual(a);
  });

  it("handles zero-width and zero-height controls without losing them", () => {
    const odd =
      heading("Zero width", { controlIndex: 1 }, { x: 10, y: 5, w: 0, h: 3 }) +
      heading("Zero height", { controlIndex: 2 }, { x: 0, y: 1, w: 20, h: 0 }) +
      heading("Normal", { controlIndex: 3 }, { x: 0, y: 8, w: 20, h: 3 });
    expect(order(odd, BANDED_COLUMN_BY_TOP).sort()).toEqual(["Normal", "Zero height", "Zero width"]);
  });
});
