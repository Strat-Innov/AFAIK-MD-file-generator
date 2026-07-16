# ASPx → Markdown Master File

Drop `.aspx` files (or a `.zip` of them) and get one combined Markdown
"master file" in the same format as your existing export. Everything runs
in the browser — no server, no upload, no database.

Built with React + Vite. ZIP unpacking uses the browser's native
`DecompressionStream`, so there are no runtime dependencies to install
beyond React.

## What it outputs
For each `.aspx` it emits: the raw file in an ```aspx``` fence, then a
`### Content Overview` with the page's ContentTypeId, PageLayoutType, and
the `CanvasContent1` decoded one HTML-entity pass. Files are listed in a
table of contents and sorted case-insensitively by name.

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
1. Push this folder to a new GitHub repo.
2. Vercel → New Project → import the repo.
3. Framework preset: **Vite** (auto-detected). Build `npm run build`, output `dist`.
4. Deploy.

## Notes
- The `Path:` line uses each file's name; the original absolute Windows
  path can't be reproduced in a browser. Change the prefix in `src/App.jsx`
  (`buildSection`) if you want a fixed one like `input\name.aspx`.
- Requires a modern browser (Chrome/Edge/Firefox/Safari) for
  `DecompressionStream` (deflate-raw).
