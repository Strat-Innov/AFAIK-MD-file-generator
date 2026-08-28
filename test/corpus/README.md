# Regression corpus

The **August 2026 corpus** — 133 real exported SharePoint pages — is the
standing regression baseline for the generator. It is deliberately *not*
committed: the pages carry employee names, work email addresses and
internal tenant URLs, and this repository is public. `test/corpus/*.aspx`
is gitignored.

Drop the 133 `.aspx` exports in this directory and `npm test` picks them
up automatically. Without them `test/corpus.test.js` skips with a notice
and the rest of the suite still runs.

## What it checks

| Check | Assertion |
|---|---|
| Raw fidelity | every page round-trips byte-for-byte through the ```aspx fence |
| Extraction | every page parses; no crash, no unparseable web part blob |
| Gate | every page passes coverage validation with no missing units |
| Tripwire | no untraceable content in any generated document |
| Mutation | deleting a known unit from a page's output is *detected* |

The mutation check is the important one. A corpus that merely passes
proves the generator is self-consistent, not that the gate can detect
loss — the audit that produced this corpus found a page that lost two
headings and still passed. The mutation check deletes real values from
real output and requires the gate to catch each one.

## Why a corpus and not just the three fixtures

Three pages proved the concept. The 133-page corpus found four
extraction gaps and three validation-model defects that three pages
could not expose, including structures absent from all three (a list
item whose text precedes a nested list, several `<p>` inside one `<li>`,
web parts whose only content is a title, image links stored under
`serverProcessedContent`). Any future parser change should be measured
against all 133.
