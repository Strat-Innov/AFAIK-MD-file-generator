# Response Consolidator tests

The automated tests run on **synthetic** session exports built in
`fixtures.js`. They have the same columns and transcript shape as real
AFAIK Agent exports, but the content is invented.

Real exports are real employee and end-user conversations. This
repository is public, so they are **never committed**: `.gitignore`
excludes every `.csv`, `.xlsx` and `.xls` under `test/responses/`.

## Running against your real exports

Put the exported files here (any names, CSV or XLSX):

```
test/responses/Sessions 9_23_26 - 9_24_26 UTC.csv
test/responses/Sessions 9_22_26 - 9_23_26 UTC.csv
…
```

Then run `npm test`. `realExports.test.js` picks them up and checks
that every file imports, every row becomes a session or merges into
one, and every transcript is kept byte-for-byte. It doesn't expect a
fixed number of files or sessions. Without the files, that suite skips
with a notice and everything else runs.

Before committing, `git status` should never list a data file.

## Validation and transcript analysis report

```
npm run responses:analyze -- test/responses --expect-files 12 --expect-sessions 55
```

Runs the files through the app's own import code and prints a Markdown
report: import totals, a value-for-value check that every field matches
its source cell, every speaker marker actually present, speaker
sequences, multi-question sessions, "not found" / "agent unavailable"
counts, and edge cases. Output is counts and short excerpts with masked
session IDs and redacted e-mails, long numbers and URLs. It prints to
the terminal only. Read it before sharing it.
