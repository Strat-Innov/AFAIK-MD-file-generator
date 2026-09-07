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

### Next step, before any code change

A three-question probe: take the generated v1.1.0 artifact, add page
identity to the one affected section heading, change nothing else, and
re-ask q0192/q0193/q0194 with the full corpus still loaded — so that
reduced label ambiguity is not confounded with added page context.

3/3 → implement page-context propagation generally.
2/3 → page context helps but something else remains.
0–1/3 → the hypothesis is wrong; do not spend 22 KB on it.

The candidate change, if earned: scope each section heading with its
page. 949 section headings, +22,064 bytes (+7.9%), taking Arm C to
301,720 — still 0.81% of Master.
