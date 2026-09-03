# Benchmark scope — the selected 128-page set

**Status: recorded, not fully enumerable.** Read §3 before running the
full benchmark.

The generator, parser, optimizer, validator, benchmark-generation code
and application code are unchanged by this document. It records a
decision about *which pages the experiment covers*; it changes nothing
about how they are produced.

---

## 1. The decision

The August snapshot `AUGUST-2026-CORPUS` holds **133 pages**. The
benchmark is run over a deliberately selected subset of **128**, being
the six production buckets as currently tagged. Five pages were left
Unsorted and are **excluded by intent** — this is a scoping decision,
not missing data, and must not be reported as data loss.

| Bucket | Pages | Membership known? |
|---|---:|---|
| PROJECT PLAYBOOK | 16 | yes |
| TOWNSHIP PAGES | 5 | yes |
| NAVIGATION PAGES | 35 | yes |
| LOCATORS | 51 | yes |
| LIFE AT FAI | 16 | yes |
| EMPLOYEE PLAYBOOK | 5 | **no — see §2** |
| **Total** | **128** | 123 of 128 |

All arms compare the same 128 pages. Arm A is the exception and §4
explains why that matters.

## 2. What is not yet pinned down

Comparing the current bucket exports against the 133-page snapshot,
**ten** pages left the previously recorded partition and none arrived:

```
left PROJECT PLAYBOOK (3)   FORTUNE-HILL.aspx  STUDIO-CITY.aspx  THE-SIGNATURE.aspx
left NAVIGATION PAGES (7)   Darwinbox.aspx  Exclusive-Promos.aspx  Lost-Page.aspx
                            OurLink.aspx  Page.aspx  Permit.aspx  Ramco.aspx
```

133 − 10 + 5 (the new EMPLOYEE PLAYBOOK bucket) = 128, so the arithmetic
closes. But **five of those ten are now in EMPLOYEE PLAYBOOK and five are
Unsorted, and no EMPLOYEE PLAYBOOK export has been supplied**, so which
five is which is not established here.

Two of the excluded five are known from the pre-flight decision to drop
Q2 and Q3: `FORTUNE-HILL.aspx` and `STUDIO-CITY.aspx` are out of scope.
`THE-SIGNATURE.aspx` is a residential project page and almost certainly
the third, but that is an inference, not a record.

**To close this**, supply `EMPLOYEE-PLAYBOOK_Master.md` (or the Unsorted
list) and the 128 can be enumerated exactly. Until then the scope is
"123 named pages plus five of seven candidates".

`LOCATORS` and `LIFE AT FAI` are taken as unchanged at 51 and 16: the
counts match the earlier exports, and no re-export was supplied to
confirm membership.

## 3. The 742-question set is NOT valid for this scope

`benchmark/question-set.json` was generated from all 133 pages.

```
742 questions over 51 pages
  anchored on a page confirmed in scope     636
  anchored on one of the ten unaccounted    106
```

| Page | Questions |
|---|---:|
| `FORTUNE-HILL.aspx` | 45 |
| `THE-SIGNATURE.aspx` | 30 |
| `STUDIO-CITY.aspx` | 29 |
| `Permit.aspx` | 2 |
| the other six | 0 |

At least **104** questions (the three project pages) are anchored on
pages outside the 128, and up to 106 if `Permit.aspx` is also excluded.
That is 14% of the set asking about pages Arms B and C do not contain.

The set must be regenerated against the 128-page scope before the full
run. It cannot simply be filtered by the ten: five of them are in
scope, and which five is exactly what §2 leaves open.

One detail for whoever regenerates it: the question set spells one
filename `PROJECT-DEVELOPMENT-#U2013-PRIMING-&-INNOVATION.aspx` (the
corpus spelling, escaped by command-line `unzip`) while the bucket
exports spell it with a real en dash. Match page names normalized, or
six in-scope questions will read as out-of-scope.

## 4. Excluding pages changes what Arm A means

Arm A is the live SharePoint site. It still contains all 133 pages —
excluding five from the uploaded knowledge does not remove them from
SharePoint. So for any question anchored on an excluded page, Arm A can
answer and Arms B and C structurally cannot, which reads as an Arm A win
that has nothing to do with representation.

The nine-question pre-flight is unaffected: after the Q2/Q3 replacement
no pre-flight question touches an excluded page. The full run is
affected, and regenerating the question set against the 128 is what
fixes it.
