# Test fixtures

The extraction and validation suites run against **real exported
SharePoint pages**, which are deliberately *not* committed: they contain
employee names, work email addresses and internal tenant URLs, and this
repository is public. `test/fixtures/*.aspx` is gitignored.

To run the full suite, drop the real exports in here:

```
test/fixtures/FORTUNE-HILL.aspx
test/fixtures/THE-SIGNATURE.aspx
test/fixtures/STUDIO-CITY.aspx
```

Export a page from SharePoint the same way you would to feed the
generator — the file the app accepts is exactly the file the tests want.

Without them, the suites that need real pages skip with a notice and the
rest of the tests (master-file format, synthetic-canvas extraction,
normalization, gate mechanics) still run.

Any `.aspx` here is ignored by git, so adding one cannot accidentally
publish it.
