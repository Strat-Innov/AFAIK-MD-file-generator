/* ------------------------------------------------------------------ *
 * CANONICAL CANVAS ORDER — one definition, two readers.
 *
 * A page is read twice: parsePage() turns controls into the sections a
 * renderer emits, and sourceModel() turns the same controls into the
 * units coverage validates against. Both used to walk the canvas
 * themselves, so "the order the renderer used" and "the order the
 * validator expected" were two independent assertions that happened to
 * agree — because both were DOM order.
 *
 * That made the coverage ordering check unable to answer the question it
 * appeared to answer: asked whether DOM order is reading order, it
 * replied by assuming it. A parser ordering controls any other way was
 * reported as having transposed content, however faithful it was.
 *
 * So the order lives here and both readers import it. Coverage then
 * proves what it is meant to prove — that the RENDERER did not drop,
 * invent, fuse or transpose what the PARSER produced.
 *
 * ---- why the policy is a parameter, not a constant ----
 *
 * A snapshot is defined by the code that built it. SEPTEMBER-2026-V2 was
 * generated under "dom" and reproduces only under "dom"; a later corpus
 * built under a layout-aware policy reproduces only under that one.
 * Making the policy a property of the snapshot is what lets a frozen
 * result stay reproducible after the canonical policy moves on, instead
 * of quietly becoming unbuildable. Each registry entry names its own
 * policy, exactly as it already names its generator version.
 *
 * See benchmark/ORDERING-SPEC.md for the contract and the evidence.
 * ------------------------------------------------------------------ */

/** The order SharePoint serialises controls in. What V2 was built under. */
export const DOM = "dom";

/**
 * Layout-aware reading order, from the flexible-canvas coordinates a
 * modern page carries. See ORDERING-SPEC.md §2 for the contract this
 * implements, clause by clause.
 */
export const BANDED_COLUMN_BY_TOP = "bandedColumnByTop";

export const ORDER_POLICIES = [DOM, BANDED_COLUMN_BY_TOP];

/* The default is DOM: the policy the active snapshot was built under.
 * Callers building a different lineage select its policy explicitly. */
const DEFAULT_POLICY = DOM;

const flexOf = (controlData) => {
  const f = controlData?.flexibleLayoutPosition?.lg;
  return f && typeof f.x === "number" && typeof f.y === "number" ? f : null;
};

/* Clause 4: cluster controls whose horizontal spans overlap into
 * columns; order columns by the y of their topmost control, then by left
 * edge, then by right edge; order within a column by (y, x, controlIndex).
 *
 * Columns are ordered by their FIRST element rather than by left edge
 * because a page whose title sits top-right beside an image at top-left
 * reads title-first; ordering by left edge alone puts the image first. */
function columnsByTop(items) {
  const columns = [];
  for (const item of [...items].sort(
    (a, b) => (a.flex.x - b.flex.x) || (right(a) - right(b))
  )) {
    const overlapping = columns.find((c) => item.flex.x < c.right && c.left < right(item));
    if (overlapping) {
      overlapping.left = Math.min(overlapping.left, item.flex.x);
      overlapping.right = Math.max(overlapping.right, right(item));
      overlapping.items.push(item);
    } else {
      columns.push({ left: item.flex.x, right: right(item), items: [item] });
    }
  }
  for (const c of columns) {
    c.items.sort((a, b) => (a.flex.y - b.flex.y) || (a.flex.x - b.flex.x) || (a.controlIndex - b.controlIndex));
    c.top = c.items[0].flex.y;
  }
  columns.sort((a, b) => (a.top - b.top) || (a.left - b.left) || (a.right - b.right));
  return columns.flatMap((c) => c.items);
}

const right = (item) => item.flex.x + (item.flex.w ?? 0);

/* Clauses 1-3: fall back to legacy order when any control in the zone
 * lacks coordinates; otherwise split the zone on full-width rules into
 * bands and read each band by column.
 *
 * A full-width, zero-height control is a divider. Without the split it
 * overlaps every column and collapses them into one, which turns a
 * three-column spec table back into row order and re-pairs each heading
 * with the wrong body. Height is what separates a rule from a merely
 * wide body of text. */
function orderZone(zone) {
  if (!zone.every((c) => c.flex)) return zone;

  const width = Math.max(...zone.map(right));
  const isRule = (c) => (c.flex.w ?? 0) >= 0.9 * width && (c.flex.h ?? 0) === 0;
  const rules = zone.filter(isRule).sort((a, b) => a.flex.y - b.flex.y);
  if (!rules.length) return columnsByTop(zone);

  const rest = zone.filter((c) => !isRule(c));
  const out = [];
  let from = -Infinity;
  const band = (lo, hi) => {
    const inBand = rest.filter((c) => c.flex.y >= lo && c.flex.y < hi);
    if (inBand.length) out.push(...columnsByTop(inBand));
  };
  for (const rule of rules) {
    band(from, rule.flex.y);
    out.push(rule);
    from = rule.flex.y;
  }
  band(from, Infinity);
  return out;
}

function describe(el, i) {
  let controlData = {};
  try { controlData = JSON.parse(el.getAttribute("data-sp-controldata") || "{}"); } catch { /* unparseable: ordered by position */ }
  const p = controlData.position || {};
  return {
    el,
    zone: `${p.layoutIndex ?? 0}/${p.zoneIndex ?? -1}/${p.sectionIndex ?? -1}`,
    controlIndex: p.controlIndex ?? i,
    flex: flexOf(controlData),
  };
}

/**
 * The canvas controls of `doc`, in canonical reading order.
 *
 * Callers must treat this as the only ordering authority: neither the
 * parser nor the validator may re-derive an order of its own, or the two
 * can drift apart again.
 *
 * Every comparator terminates in controlIndex, which is unique within a
 * zone, so the result is a total order and the same input always gives
 * the same sequence. Zones themselves keep their serialised order.
 */
export function canonicalControls(doc, policy = DEFAULT_POLICY) {
  const controls = [...doc.querySelectorAll("[data-sp-canvascontrol]")];
  if (policy === DOM) return controls;
  if (policy !== BANDED_COLUMN_BY_TOP) {
    throw new Error(`Unknown canvas order policy: ${policy}. Known: ${ORDER_POLICIES.join(", ")}`);
  }

  const described = controls.map(describe);
  const zones = [];
  const byZone = new Map();
  for (const c of described) {
    if (!byZone.has(c.zone)) {
      const z = [];
      byZone.set(c.zone, z);
      zones.push(z);
    }
    byZone.get(c.zone).push(c);
  }
  return zones.flatMap(orderZone).map((c) => c.el);
}
