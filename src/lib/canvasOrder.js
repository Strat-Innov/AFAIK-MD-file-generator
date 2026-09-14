/* ------------------------------------------------------------------ *
 * CANONICAL CANVAS ORDER — one definition, two readers.
 *
 * A page is read twice: parsePage() turns controls into the sections a
 * renderer emits, and sourceModel() turns the same controls into the
 * units coverage validates against. Both walked the canvas themselves,
 * so "the order the renderer used" and "the order the validator
 * expected" were two independent assertions that happened to agree.
 *
 * They agreed only because both walked the DOM. That made the coverage
 * ordering check unable to answer the question it appeared to answer:
 * asked whether DOM order is reading order, it replied by assuming it.
 * A parser that ordered controls any other way would be reported as
 * having transposed content, however faithful it was.
 *
 * So the order lives here, and both readers import it. Coverage then
 * proves what it is meant to prove — that the RENDERER did not drop,
 * duplicate, invent or transpose what the PARSER produced — and stops
 * silently ratifying whichever order the parser happened to use.
 *
 * Today this is DOM order, which is exactly what both sides did before,
 * so nothing about the current output moves. When a layout-aware policy
 * is authorised (benchmark/ORDERING-SPEC.md), it replaces the body of
 * this one function and both readers follow it together, by
 * construction rather than by coincidence.
 * ------------------------------------------------------------------ */

export const CANVAS_ORDER_POLICY = "dom";

/**
 * The canvas controls of `doc`, in canonical reading order.
 *
 * Callers must treat this as the only ordering authority: neither the
 * parser nor the validator may re-derive an order of its own, or the
 * two can drift apart again.
 */
export function canonicalControls(doc) {
  return [...doc.querySelectorAll("[data-sp-canvascontrol]")];
}
