# Generator contract — v1.0.0 (frozen 2026-08-28)

This records what the generator guarantees, what it does **not**, and
what must be re-verified before any change to it lands. It exists so a
later change can be measured rather than argued about, and so a
retrieval benchmark can name the build it ran against.

## The two representations

```
.aspx ─┬─> buildMaster()                 -> Raw .md   fidelity layer, never gated
       └─> parse -> render -> validate   -> AI .md    retrieval layer, gated on PASS
```

The raw file is the source of truth. It stays downloadable even when the
optimized one is blocked — that is precisely when an auditor needs it.

## What is guaranteed

**Raw / master**
- The source `.aspx` appears byte-for-byte inside its ```aspx fence, and
  round-trips out of the generated file unchanged.
- The master-file format (header, table of contents, per-file section)
  is unchanged from the pre-existing export it was reverse-engineered
  from.

**AI / optimized** — a document is published only if all four hold:
1. **Presence.** Every meaningful source unit is represented, matched as
   a run of whole tokens, each unit claiming its own tokens so no unit
   can be satisfied by another's text.
2. **Nothing invented.** Every token in the output is backed by a source
   value.
3. **Order.** Within a rich-text block, source order is preserved; canvas
   controls do not interleave.
4. **Association.** Structural pairs — a link's label with its target, a
   person's name with their email — appear together.

**Determinism.** No LLM anywhere in the transformation path. The same
input always produces the same output.

**Meaning of a unit.** A unit is one atomic piece of user-visible
information: a line of prose, a list item, a table cell, a price, a link
URL, a person's name. Source units are derived independently of the
parser they validate — tag-boundary splitting on the raw markup plus a
whitelist harvest of the web part JSON — so a parser bug that drops a
paragraph still fails the gate.

**Excluded as implementation detail:** web part GUIDs, canvas positions,
`data-sp-*` attributes, CSS classes and inline styles, `imageSources`,
`fileName`, site/web/list/unique ids, page settings, zone backgrounds,
empty layout sections, `LayoutWebpartsContent` (verified to carry no
text on all 133 pages), and links whose target is an image file.

**Kept:** headings, prose, prices, sizes, unit counts, dates, amenities,
lists, tables, contacts with roles and emails, link labels with targets
(pages, documents, external sites, `mailto:`), authored web part titles,
image captions and alt text, and the SharePoint site URL when the file
records one. URLs are never derived from a filename.

## What is NOT guaranteed

- **Not semantic completeness.** The gate proves values are present, in
  order, correctly paired, and that nothing was invented. It does not
  prove a reader draws the same meaning.
- **Web-part-internal ordering is unvalidated.** A record's field order
  is not reading order, so reordering two links within one list is not
  detected. Judged non-load-bearing.
- **The interleave check uses only units unique to one group**, so a
  section built entirely from values duplicated elsewhere contributes no
  span.
- **Tables have no real-world coverage** — zero `<table>` elements in the
  August corpus. Synthetic tests only.
- **Team role labels** are separate canvas controls from the People web
  parts beside them, and stored order does not pair them reliably. They
  are emitted in source order rather than guessed into pairs; each
  person still carries their own role.
- **Retrieval is not benchmarked.** No claim is made that this improves
  Copilot Studio's answers or latency.

## Frozen baseline — August 2026 corpus, 133 pages

```
Processed 133/133    Errors 0    Skipped 0
Raw fidelity   133/133 byte-for-byte
Gate           133/133 PASS
Units          4,791 source / 4,791 represented
Missing 0      Untraceable 0     Ordering 0     Association 0
Size           19.0 MB -> 270 KB   (98.6%)
```

| Fault class | Mutations | Detected |
|---|---:|---:|
| Deletion | 1,049 | 1,049 |
| Reorder within a block | 124 | 124 |
| Move a fact across the document | 124 | 124 |
| Alter a numeric value | 101 | 101 |
| Alter a heading | 133 | 133 |
| Swap two people's emails | 35 | 35 |
| Swap two link targets | 133 | 133 |
| **Total** | **1,699** | **1,699** |

| Negative control | Runs | False failures |
|---|---:|---:|
| Bold / heading depth / bullet style / blank lines | 532 | 0 |

## Change protocol

Any change to `aspxDocument.js`, `optimizedMd.js`, `contentUnits.js`,
`coverage.js` or `masterMd.js` must, before it lands:

1. Run `npm test` — includes the full corpus, both mutation suites and
   the benign-reformat controls.
2. Keep raw fidelity at 133/133. A regression here is never acceptable;
   it is the one guarantee the whole design exists to protect.
3. Keep the corpus at 133/133 with zero missing, untraceable, ordering
   and association findings.
4. Keep mutation detection at 100% and false failures at 0. **A greener
   pass rate is not evidence.** The gate once reported 133/133 while a
   page had genuinely lost two headings; only mutation testing found it.
5. Bump `GENERATOR_VERSION` in `src/lib/version.js` and record the new
   baseline above.

If a change makes the gate stricter, expect the negative controls to
break first. Strictness that fails ordinary Markdown reformatting is a
bug in the gate, not a finding — two such fragilities (the provenance
block located by a literal `## Source`, and list markers hidden behind
emphasis) were found exactly that way.

## Corpus and fixtures

Both are **gitignored** — they carry employee names, work email
addresses and internal tenant URLs, and this repository is public. See
`test/corpus/README.md` and `test/fixtures/README.md`. Suites that need
them skip with a notice; no PII is hard-coded in any test.

## Next step

Benchmark Copilot Studio retrieval against a representative question
set, comparing SharePoint alone, SharePoint plus the current
consolidated MD, and SharePoint plus the optimized MD. Until then no
performance claim is made.
