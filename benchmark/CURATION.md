# Question-set curation report

**Nothing in this report has been applied.** The 742-question set is
unchanged and its core is checksum-pinned by `test/benchmark.test.js`.
This records what verification found, what it means for the experiment,
and what should be decided before a headline number is quoted.

## Verified sound

| Property | Result |
|---|---|
| Reproducible | two independent rebuilds byte-identical |
| Count | 742 records, 742 unique ids |
| Uniqueness | 742 globally-distinct question texts — **0 cross-page collisions** |
| Grounding | **0 ungrounded**; every answer traces to a source unit on its own page |
| Provenance | every record carries `page`, `kind`, `evidence` and a structural `locator` |
| Authorship | deterministic template assembly over parsed source values; no LLM wrote any question or answer |

Cross-page uniqueness matters more than it sounds: Copilot sees all 133
pages at once, so a question that is unique only within its own page
would be unscorable. None are.

## Findings

### 1. Amenity questions are yes-only — 98 questions (13%)

Every `amenity` answer is `Yes — X is listed under Amenities.` There are
no negative controls, so **an agent that always answers "yes" scores
100% on this category** and inflates the overall figure by up to 13
points in every arm equally.

*Recommendation:* either exclude the category from the headline number,
or supplement it with deterministic negatives — an amenity that appears
on some other page but demonstrably **not** on this one, with expected
answer "No". That is derivable from the corpus without invention.
**Do not simply delete them**; they still test list membership.

### 2. Thirty-four questions come from a test page

`South-Station-Terminal(test).aspx` contributes 34 questions, including
**4 of the 22** price/area questions. Its page title also collides with
the real `SOUTH-STATION-TRANSPORT-TERMINAL.aspx`, so the subject "South
Station Transport Terminal" does not identify one page.

*Recommendation:* **exclude the page.** Both reasons are independently
sufficient — it is not production content, and its subject is ambiguous
against a real page in the same knowledge base. This is a deterministic
exclusion (filename contains `(test)`), not a judgement call.

### 3. Two questions use a generic heading as their subject

From `Permit.aspx`: *"On the Purpose page, what URL is listed for …"* —
`Purpose` is that page's first heading, not its identity.

*Recommendation:* **exclude both**, or regenerate them with the file name
as the subject. Underlying cause: only **120 distinct titles across 133
pages** (`Purpose` ×7, `Overview:` ×7). The subject-derivation rule is
fragile wherever a page opens with a generic heading, so this is worth
fixing at the source rather than case by case.

### 4. Coverage: 82 of 133 pages contribute nothing

Only **51 pages** produce questions. The generator emits questions for
labelled facts, unit tables, amenity lists, people and links; pages that
are mostly prose produce none.

*Recommendation:* accept for now, but **state the coverage** whenever a
result is reported — this benchmark measures retrieval over the 51 pages
that yielded questions, not over the whole knowledge base. If broader
coverage is wanted, the missing generator is prose-comprehension
questions, which cannot be produced deterministically from source and
would need human authoring.

### 5. The mix is skewed toward contact lookup — 68%

| Category | Count | Share |
|---|---:|---:|
| `contact-email` | 270 | 36% |
| `contact-by-role` | 231 | 31% |
| `external-link` | 105 | 14% |
| `amenity` | 98 | 13% |
| `labelled-fact` | 16 | 2% |
| `unit-area` | 11 | 1.5% |
| `unit-price` | 11 | 1.5% |

An aggregate score over this set is **mostly a measure of contact
lookup**. Contacts are also the easiest case — a name and an address on
one line — so an aggregate will likely look flattering in every arm and
discriminate poorly between them.

*Recommendation:* report **per category, never as one number**, and
treat `unit-price`, `unit-area` and `contact-by-role` as the primary
outcome, since those depend on facts staying next to each other.

### 6. Only 22 questions probe the actual hypothesis — 3%

The optimized MD's distinctive claim is that it keeps a unit type, its
floor area and its price together. Exactly **22 questions** test that,
drawn from **4 pages**, one of which is the test page from finding 2:

| Page | Price/area questions |
|---|---:|
| `FORTUNE-HILL.aspx` | 12 |
| `ParkwayCorporateCenter.aspx` | 4 |
| `South-Station-Terminal(test).aspx` | 4 |
| `STUDIO-CITY.aspx` | 2 |

Excluding the test page leaves **18 questions over 3 pages**. That is
too thin to carry the conclusion on its own.

*Recommendation:* **this is the most important gap.** Before running,
supplement price/area coverage from the corpus. The generator currently
requires the area or price on the line immediately after the unit type;
relaxing that within a single prose block would likely recover more
pages. Any change must be verified to still produce grounded,
unambiguous questions, and the core checksum re-pinned.

### 7. Eleven answers are URLs containing literal spaces

Internal SharePoint document URLs such as `.../Shared Documents/Memo/…`.

*Status:* **handled.** The equivalence rules decode `%20`, so an encoded
reply scores as correct. No exclusion needed. Noted because it would
otherwise look like eleven formatting failures.

## Summary

| Finding | Questions | Recommendation |
|---|---:|---|
| 1 Amenity yes-only | 98 | supplement with negatives, or drop from headline |
| 2 Test page | 34 | **exclude** (deterministic) |
| 3 Generic subject | 2 | **exclude** or regenerate |
| 4 Page coverage | — | state coverage when reporting |
| 5 Contact skew | 501 | report per category |
| 6 Thin price/area | 22 | **supplement before running** |
| 7 URL spaces | 11 | none — already handled |

Excluding findings 2 and 3 alone would take the set from 742 to **706**.
No exclusion has been applied.
