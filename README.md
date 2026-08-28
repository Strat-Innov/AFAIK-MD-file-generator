# ASPx → Markdown Master File

Drop `.aspx` files (or a `.zip` of them) and get one combined Markdown
"master file" in the same format as your existing export. Everything runs
in the browser — no server, no upload, no database.

Built with React + Vite. ZIP unpacking uses the browser's native
`DecompressionStream`, so there are no runtime dependencies to install
beyond React.

## What it outputs
Two files per bucket, from the same source, for two different jobs.

**Raw `.md` — the fidelity layer.** Unchanged from before: for each
`.aspx` it emits the raw file in an ```aspx``` fence, then a
`### Content Overview` with the page's ContentTypeId, PageLayoutType, and
the `CanvasContent1` decoded one HTML-entity pass. Files are listed in a
table of contents and sorted case-insensitively by name. This is the
source-of-truth copy — use it for audit, diffing and rollback.

**AI `.md` — the retrieval layer.** A much smaller document per page,
built for Copilot Studio knowledge retrieval. It keeps the user-visible
information (headings, prose, prices, unit sizes, amenities, tables,
links, contacts, source metadata) and drops the SharePoint rendering and
implementation detail (web part GUIDs, canvas positions, asset paths,
CSS classes). On the three sample pages this is a ~98% size reduction
with no loss of meaningful content.

Extraction is deterministic — a DOM walk over the page's own canvas
controls. There is no LLM anywhere in the transformation path, nothing
is summarized or paraphrased, and the same input always produces the
same output.

## The validation gate
An AI file is only downloadable if it passes coverage validation:

```
Source ASPX ──> source content units ─┐
                                      ├─> compare ──> PASS -> publish
Optimized MD ─────────────────────────┘         └──> FAIL -> blocked
```

A *content unit* is one atomic piece of information: a line of prose, a
list item, a table cell, a price, a link URL, a person's name. The gate
derives the source's units independently of the parser it is checking —
by a different technique — so a parser bug that silently drops a
paragraph still fails the gate. Comparison is normalized, so Markdown
syntax, whitespace, heading depth, bullet style, quote/dash variants and
non-breaking spaces never cause a false failure, but an omitted value
does.

Failures name the values, not just a boolean:

```
VALIDATION
----------
Status: FAIL

Source content units: 99
Represented content units: 96
Missing units: 3

Missing content:
- "₱44.9M"
- "125–146 sqm"
- "South Luzon"
```

The raw master file is never gated — it stays downloadable precisely
when something has gone wrong with the optimized one.

## Status

The generator is **frozen at v1.0.0** (2026-08-28). See
[GENERATOR-CONTRACT.md](GENERATOR-CONTRACT.md) for what it guarantees,
what it does not, the validated baseline over the 133-page August
corpus, and the protocol for changing it. Each AI file records the
generator version in its `## Source` block.

## Tests
```bash
npm test
```
Covers raw-source fidelity (byte-for-byte round-trip through the fence),
extraction against the three real exported pages in `test/fixtures/`, and
the gate's ability to detect missing and invented content.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
1. Push this folder to a new GitHub repo.
2. Vercel → New Project → import the repo.
3. Framework preset: **Vite** (auto-detected). Build `npm run build`, output `dist`.
4. Deploy.

## Known limitations
- Team role labels (MARKETING, SALES, …) are separate canvas controls
  from the People web parts they visually sit beside, and SharePoint's
  stored control order does not reliably pair them. They are emitted in
  source order rather than guessed into pairs. Each person still carries
  their own role, so retrieval is unaffected.
- Table extraction has no real-world fixture yet — none of the sample
  pages contains a `<table>`. It is covered by a synthetic test only.
- Copilot Studio retrieval improvement has not been benchmarked. The
  optimized file is smaller and cleaner; whether that improves answer
  quality or latency needs measuring against a real question set.

## Notes
- The `Path:` line uses each file's name; the original absolute Windows
  path can't be reproduced in a browser. Change the prefix in `src/App.jsx`
  (`buildSection`) if you want a fixed one like `input\name.aspx`.
- Requires a modern browser (Chrome/Edge/Firefox/Safari) for
  `DecompressionStream` (deflate-raw).
