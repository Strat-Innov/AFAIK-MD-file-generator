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

## The registry

`src/lib/snapshots.js` is the single source of truth for which snapshots
exist and what each one is. Everything downstream — the name and clock on
screen, the header inside each artifact, `CANONICAL`, `SNAPSHOT_HISTORY`
— is derived from it. Nothing anywhere infers a snapshot from the
calendar.

A loaded corpus is identified by hashing it, not by its filenames and not
by the date:

- `contentSha256` — over `name + content-digest` for every page, sorted.
  This is the identity detection matches on. Change one character of one
  page and it changes.
- `fileSetSha256` — the older names-only signature. Kept because the
  historical manifests are keyed on it, and reported alongside so a
  mismatch between the two is visible; never used to decide identity.

A corpus matching no registered `contentSha256` is reported as
**UNREGISTERED SNAPSHOT** and artifact generation is blocked. It is never
given a guessed name, month or clock.

### Registering a new snapshot

1. Archive the pages under `benchmark/corpora/<name>/`.
2. Read its `contentSha256` and `fileSetSha256` off the Benchmark screen
   (they are shown for an unregistered corpus precisely so this step
   needs no extra tooling).
3. Add the entry to `SNAPSHOTS` in `src/lib/snapshots.js`, with the
   artifact digests and source-unit count for the arms built from it, and
   flip the previous `frozen` entry to `superseded`. Exactly one entry may
   be `frozen`; the module refuses to load otherwise.
4. Run `npm test` — the archived snapshots are rebuilt and checked
   against the digests recorded for them.
