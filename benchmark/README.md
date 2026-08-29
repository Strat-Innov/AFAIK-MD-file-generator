# Retrieval benchmark

The generator is frozen (see [`../GENERATOR-CONTRACT.md`](../GENERATOR-CONTRACT.md)).
What is still unmeasured is the thing the optimized file exists for:
**does it actually make Copilot Studio answer better?**

No performance claim has been made anywhere in this work, and none
should be until this runs.

## The question set

```bash
npm run benchmark:questions
```

Reads `test/corpus/*.aspx` and writes `question-set.json` and a readable
`question-set.md` here. Both are **gitignored** — the answers contain
employee names and work email addresses, and this repository is public.
The generator is committed; its output is not.

Every question is derived from a fact the source states, and every
answer is a **verbatim source value**. Nothing is paraphrased and no LLM
wrote any part of it, so a wrong answer is wrong against the page rather
than against an opinion.

Current set: **742 questions over 133 pages**, all unambiguous — a
question whose answer is not unique on its page is discarded, because it
cannot score anything.

| Kind | Count | Probes |
|---|---:|---|
| `contact-email` | 270 | direct lookup of a person's address |
| `contact-by-role` | 231 | role → person, the association the gate protects |
| `external-link` | 105 | label → URL, on the page that lists it |
| `amenity` | 98 | membership in a list |
| `labelled-fact` | 16 | unit counts, turnover dates, rents |
| `unit-area` | 11 | unit type → floor area |
| `unit-price` | 11 | unit type → price |

`unit-price`, `unit-area` and `contact-by-role` are the ones that matter
most: they are exactly the adjacency and association that a naive
extraction destroys, so they separate a knowledge base that holds the
right facts from one that merely holds the right words.

## The three arms

Same question set, same Copilot Studio configuration, one variable:

```
A. SharePoint site only                    (today's baseline)
B. SharePoint + current consolidated MD    (what shipped before this work)
C. SharePoint + optimized AI MD            (this change)
```

Run C against a knowledge base built by a single known generator
version — each document records it as `- Generator: x.y.z` in its
`## Source` block, so a result can be tied to a build.

## What to record per question

| Field | Meaning |
|---|---|
| `answer` | what Copilot replied, verbatim |
| `correct` | does it contain the ground-truth value? |
| `grounded` | did it cite a source, and the right one? |
| `latency_ms` | wall clock |

Scoring `correct` should tolerate formatting the way the gate does —
`₱25.5M – ₱27.3M` and `P25.5M - P27.3M` are the same answer — but must
not tolerate a different number.

## Reading the result

The interesting comparison is **not** overall accuracy. It is:

- **B vs C on `unit-price` / `unit-area` / `contact-by-role`.** If the
  optimized file helps anywhere, it should help most where the answer
  depends on two facts staying next to each other.
- **A vs C.** Whether adding a curated knowledge base beats the live
  site at all. If it does not, that is a real result and worth knowing
  before more effort goes in.
- **Wrong-but-confident answers.** More dangerous than misses. Worth
  counting separately.

A difference of a few percent on 742 questions is noise. Look for a
difference large enough to see per category, and report the categories
rather than one headline number.

## What this cannot tell you

Retrieval quality depends on Copilot Studio's own indexing and ranking,
which is outside this repository and can change without notice. A result
is a snapshot of one configuration on one day, not a property of the
generator. Re-run it when the knowledge base is rebuilt or the generator
version changes.
