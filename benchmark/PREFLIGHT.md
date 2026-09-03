# Copilot Studio pre-flight — record

Nine questions, three arms, 27 conversations. Run in Copilot Studio by
the operator; the outcomes below are **as reported by them**, not
observed or scored here.

Scope: the selected 128-page set — see [`SCOPE.md`](SCOPE.md).
Generator frozen at v1.0.0.

---

## 1. Question set changes

Q2 and Q3 originally probed `FORTUNE-HILL.aspx` and `STUDIO-CITY.aspx`,
which the scoping decision put outside the 128. They are **permanently
replaced**. Q1 and Q4–Q9 are unchanged.

Both replacement answers were checked against the source before the run:
each is unique on its page, unique across the whole PROJECT PLAYBOOK
AI file, and sits adjacent to the unit type it belongs to — so a correct
answer cannot be produced by picking up a neighbouring value.

| | Question | Expected |
|---|---|---|
| Q1 | How many units does 1001 Parkway Residences have? | 382 |
| **Q2** | What is the price range for a 2-BR unit at Golf Ridge Private Estate? | ₱30.8M–₱32.7M |
| **Q3** | What is the unit size of a Studio Unit at Studio N? | 18 sqm |
| Q4 | Where is Westgate Center located? | Commerce Ave, Westgate District |
| Q5 | Where is Wilcon Depot located? | Spectrum Midway Corner Bridgeway Ave, South Station District |
| Q6 | Who is the Sales Operations Manager for 1001 Parkway Residences, and what is their email address? | see the `## Sales Support & Leasing Group` block of the 1001 Parkway page |
| Q7 | What is the Facebook page for 1001 Parkway Residences? | `https://www.facebook.com/1001Parkway/` |
| Q8 | Who is the architecture consultant for 1001 Parkway Residences? | Pimentel Rodriguez Simbulan & Partners |
| Q9 | What is the standard parking rate at Wilcon Depot, and what is the operation schedule for that parking? | PHP 50.00; Mon - Sun 06:00 AM to 02:00 AM |

Q2 and Q3 now both sit in PROJECT PLAYBOOK, where previously they were
in different buckets. Note also that the depth anchoring in the original
runbook — "WESTGATE-CENTER at 98.5% of the file" — described byte
offsets into the single 37 MB consolidated Arm B. Under five-file
packaging those percentages no longer describe anything, and they were
not recomputed before this run. Q4 and Q5 should be read as *late-page*
probes, not as calibrated depth probes.

## 2. Outcome

| Arm | Knowledge | PASS | PARTIAL | NOT RETRIEVED |
|---|---|---:|---:|---:|
| A | SharePoint only | 5 | 1 | 3 |
| B | SharePoint + 6 Master MD files | 8 | 1 | 0 |
| C | SharePoint + 6 AI-optimized MD files | 7 | 2 | 0 |

Non-PASS results, with the reason recorded:

| Arm | Q | Result | Reason |
|---|---|---|---|
| A | Q4 | NOT RETRIEVED | — |
| A | Q5 | NOT RETRIEVED | — |
| A | Q9 | NOT RETRIEVED | — |
| A | Q6 | PARTIAL | Person and email retrieved; the role association was not explicitly established. |
| B | Q7 | PARTIAL | The Facebook page identity was retrieved; the actual URL was not surfaced. |
| C | Q7 | PARTIAL | The correct URL text was surfaced — `https://www.facebook.com/1001Parkway/` — but the rendered clickable target was malformed, the citation marker being folded into the href: `https://www.facebook.com/1001Parkway/**%5B1`. Retrieval correct, link output defective. |

Arm A therefore reconciles to nine: PASS on Q1, Q2, Q3, Q7, Q8;
PARTIAL on Q6; NOT RETRIEVED on Q4, Q5, Q9. An earlier draft of this
record carried 6 PASS / 2 NOT RETRIEVED, which did not reconcile against
the per-question detail; the operator confirmed 5 / 1 / 3 and that is
what stands.

## 3. What this does and does not show

Supported by the run as recorded:

- SharePoint alone failed to retrieve Q4, Q5 and Q9; both uploaded
  representations retrieved all three. Those are the two late-page
  location probes and the structural-association probe — the three
  hardest questions in the set, and the only three Arm A missed.
- Q9 is the association probe specifically: the Wilcon Depot parking
  rate with its own schedule, not fused with the transportation hub's
  `PHP 20.00` a few lines away on the same page. That is the exact
  failure the generator's association validation exists to prevent, and
  it held at the Copilot layer in both arms.

Not supported, and not to be claimed:

- **Nothing here establishes that the AI-optimized representation beats
  the Master representation.** Arm C scored one PASS *lower* than Arm B.
- No performance, latency or accuracy superiority claim of any kind. The
  sample is nine questions, one repetition, one operator, and the
  difference between 7, 8 and 6 passes at n=9 is not a measurement.
- Arm C's Q7 PARTIAL is a rendering defect in Copilot's citation
  handling, not a defect in the AI file — the file carries the URL
  verbatim. Recorded as PARTIAL per the classification rules, but it
  should not be read as a representation failure.

The pre-flight's purpose was to prove the harness works end to end. It
did. The comparison itself needs the full run, over a question set
regenerated for the 128-page scope.
