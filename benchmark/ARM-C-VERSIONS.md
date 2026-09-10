# Arm C representation history

A benchmark result is only meaningful against the representation it was
run on. This file records each Arm C version, what changed, and what
evidence exists for it, so a result is never merged across a boundary
it does not belong to.

Arm B is deliberately absent: it has not changed and must not.

---

## v1.0.0 — 2026-08-28

`a911dac67115ce08e359df94607fe0c009c063a6a89ded86d65ca7665eabc56a`
279,634 bytes · 133 pages · gate PASS 4791/4791

The representation the **638-question Arm C run** was made against.
That run stands as historical evidence for v1.0.0 and **must not be
merged numerically with any later version.**

## v1.1.0 — 2026-09-03 — link destination serialisation

`103a6ec97acc6d78b6648d183f1883b25c165188be63f956f39a203b4b7dd124`
279,656 bytes (+22) · 133 pages · gate PASS 4791/4791

A CommonMark link destination cannot contain unescaped whitespace.
`[Employees](https://…/Shared Documents/…)` does not parse as a link at
all — it survives as literal text. Verified against a real CommonMark
parser, not inferred. 11 destinations across 5 pages were affected.

Fix: those destinations are emitted in the angle-bracket form. Delimiters
only — removing them from a v1.1.0 document reproduces v1.0.0 exactly.

### Causal test — 12 questions, Copilot Studio

The 11 affected questions plus `q0248` (Training Tracker) as a control:
its URL contains no space, so it parsed correctly under v1.0.0 too and
should not move.

| | v1.0.0 | v1.1.0 |
|---|---|---|
| 11 defect-class questions | reported failing | **8 pass, 3 fail** |
| `q0248` control | pass | **pass** — unchanged, as predicted |

**v1.1.0 is validated.** Eight of eleven recovered, and the control held,
so the flips are attributable to the delimiter repair rather than to
run-to-run variation.

The three residuals — `q0192` Finance, `q0193` Employees, `q0194`
Operations, all on `Digital Library.aspx` — are **a different defect at
a different stage**, and are not evidence against v1.1.0. See below.

---

## v1.1.0 is FROZEN — 2026-09-09

No further Arm C representation change is to be made for the residual
link failures. The evidence below closes that thread: the defect is not
in the representation, and no change to it can fix what is happening.

---

## Closed: the residual link failures are consumer-side truncation

### The probe rejected its own hypothesis

Page identity was added to the one affected section heading — a single
line, verified as the only difference from the generated artifact — and
the three questions were re-asked with the full corpus loaded.

| Probe | Result |
|---|---|
| Finance | FAIL |
| Employees | FAIL |
| Operations | FAIL |
| Training Tracker *(control, different page, untouched)* | PARTIAL |

**0/3.** Under the thresholds fixed in advance, that is "hypothesis
wrong; do not spend the bytes". The +22 KB page-context propagation
change was **not implemented** and should not be revisited for this.

### What the failures actually are

The agent's answer for Finance, copied as text — not as a link — is:

```
https://filinvest.sharepoint.com/sites/FAIKnowledgeBase/Shared
```

against an expected

```
https://filinvest.sharepoint.com/sites/FAIKnowledgeBase/Shared Documents/Operating Manual System (OMS) - FAI/Finance
```

The copied value is truncated at the first whitespace. This is not a
clickable-link rendering artifact: the truncation is present in the
response text itself.

### Why this is not ours

- **Source:** `Opens in a new window` appears 0 times in the 133 `.aspx`
  files. `web=1` appears once, on an unrelated `Home.aspx` sharing link.
- **Arm C v1.1:** contains the complete URL, correctly associated with
  its label, on one line. `?web=1` and `Opens in a new window` appear
  zero times.
- **Markdown validity:** three independent parsers — commonmark, marked,
  markdown-it — all recover the full destination from the v1.1
  angle-bracket form. Only the *v1.0 bare form* and *plain-text
  autolinking* truncate, and both truncate at exactly `/Shared`, which
  is the observed break point.
- **Determinism:** Customer Journey and Corporate Governance share the
  identical URL prefix with Finance/Employees/Operations, sit in the
  same list, and **passed**. No deterministic string transformation can
  corrupt three of five and leave two intact.

Recorded as an **external, consumer-side limitation**: Copilot Studio
retrieves the label and the beginning of the URL, and truncates the
emitted URL at whitespace. Revisit only if new evidence contradicts it.

### The comparability problem this creates

The two arms do **not** carry the same URL forms. SharePoint stores
these URLs twice — percent-encoded in `serverProcessedContent.links`,
raw-space in the web part JSON — and each representation reads a
different field:

| The Finance URL | raw-space form | `%20` form |
|---|---:|---:|
| Arm B (raw `.aspx`) | 2 | **2** |
| Arm C (extracted) | 1 | **0** |

Arm B therefore carries a whitespace-free variant of the same URL that
Arm C does not. A consumer that truncates at whitespace can answer these
from Arm B and cannot from Arm C — **for reasons that have nothing to do
with representation quality.** On the 11 affected questions, Arm B has a
structural advantage that is an artifact of source encoding, not of the
thing the experiment is measuring.

This must be settled before the arms are compared. See the scoring
recommendation below.

---

## Open: page identity after chunking

The three residual failures are *not* a serialisation problem. Their
links are present, well-formed, and correct in v1.1.0:

- the label → destination relationship is intact for all five OMS items
- each label sits on the same line as its own destination
- nothing is flattened, merged, dropped, or nested under another section
- the extractor yields `{title, url}` and the renderer emits both

Two items from the **same list**, rendered by the **same code path**,
with the **same syntax** — Customer Journey and Corporate Governance —
passed. That rules out syntax, structure and extraction.

What separates them is how widely the label occurs across the corpus:

| Label | Result | Pages carrying it |
|---|---|---:|
| Operations | FAIL | **30** |
| Finance | FAIL | **12** |
| Employees | FAIL | **8** |
| Reimbursement | pass | 2 |
| Customer Journey | pass | 1 |
| Corporate Governance | pass | 1 |
| CA Form | pass | 1 |
| Permit System Phase 2 Userguide | pass | 1 |
| Permit_Monitoring_Process | pass | 1 |
| PPG_STIN…PD / …Sales | pass | 1 |
| Training Tracker *(control)* | pass | 1 |

Perfect separation, with a clean gap: every failure ≥8 pages, every pass
≤2. Note that "Employees" is **unique on its own page** and still failed
— page-local collision does not explain this; corpus-wide spread does.

**Hypothesised mechanism.** The query carries two signals: the page
("Modern digital tools for efficient, productive work") and the label.
The page signal is unusable because that H1 sits **53 lines above** the
OMS list, so a chunk containing the answer very likely does not contain
the page title. Across all 96 external-link questions the median
distance from page title to answer is 34 lines, 40 exceed 40 lines, and
the worst is 103. That leaves the label as the only signal, and a label
spread over 8–30 pages cannot identify one chunk.

**This is an inference.** Copilot's chunking is not observable from
here, and the correlation rests on 12 data points. It is not proven the
way the v1.1.0 defect was proven, and no code change should be made on
it until a probe says otherwise.

### Affected population

10 of 96 external-link questions carry a label spread over ≥3 pages.
Three are the generic single-word case above. The other seven are long
labels repeated across pages (`Botanika Nature Residences | … Facebook`
on 3 pages) — a related but distinct risk: retrievable, but liable to
answer from the wrong page. If that is real it reaches well beyond link
questions, into the 208 `contact-by-role` questions where names and
roles repeat across dozens of pages.

### Outcome: rejected

The probe returned 0/3 and the hypothesis was dropped. Its three
failures were subsequently traced to consumer-side URL truncation (see
above), which the page-context change could not have addressed. The
+22 KB change was never implemented.

The page-spread correlation remains unexplained for the *other* seven
ambiguous labels, and is worth revisiting only if a failure appears that
is not accounted for by truncation.
