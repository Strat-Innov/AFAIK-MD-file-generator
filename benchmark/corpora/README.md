# Corpus snapshots

Each directory holds one exported snapshot of the SharePoint pages, plus
a `manifest.json` of per-file SHA-256 digests, so any snapshot can be
reconstructed and verified independently of the artifacts built from it.

```
benchmark/corpora/
  august-2026/      133 pages   superseded
  september-2026/   134 pages   active
```

The `.aspx` files are **gitignored** — they carry employee names, work
email addresses and internal tenant URLs, and this repository is public.
Supply them locally. `benchmark/SCOPE.md` records each snapshot's
aggregate digests so a local copy can be checked without the files ever
being committed.

`test/corpus/` holds the **active** snapshot, which is what the
generator, the question-set builder and the arm builder all read. To
switch snapshots, replace its contents from the directory here.

`SNAPSHOT_HISTORY` in `src/lib/benchmarkExport.js` records every
superseded snapshot's digests, and `buildBenchmarkArtifacts()` accepts a
snapshot name and clock, so a historical snapshot can be rebuilt and
checked. `test/snapshots.test.js` asserts exactly that: every archived
snapshot must rebuild to the digests recorded for it. Those tests skip
when the corpora are absent.
