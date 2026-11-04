# Token ID import

`import.mjs` copies the engine's token ids into `reference/data/language.json`. The ids come from the community RMS Equivalencies sheet, shared with permission of its maintainer (see the README's thanks). The design is `docs/token-alias-design.md`.

The sheet is a Google Sheet, id `1gr37obgoA_oa_Yikw8rt4AmNtRk4czX9VcRPkQQZPEc`. Its first column is the id and its second the RMS keyword. Fetch it as CSV into a folder outside the repo.

```bash
curl -sL -o sheet.csv "https://docs.google.com/spreadsheets/d/1gr37obgoA_oa_Yikw8rt4AmNtRk4czX9VcRPkQQZPEc/export?format=csv&gid=0"
```

The CSV is never committed. Import it from the repo root, then format the data file.

```bash
node tools/token-ids/import.mjs sheet.csv
npx prettier --write reference/data/language.json
npm run validate:reference
```

Each entry whose name equals a sheet keyword gets `tokenId` and `tokenIdSource: "equivalencies-<date>"`. Section headers, braces and the comment markers go to `structuralTokens`. The script prints the sheet rows it could not place and the entries left without an id. It never overwrites an id a DE run measured, and it stops if the sheet disagrees with one.

A newer copy of the sheet is imported by running the script again. It clears the ids an earlier import wrote before it writes the new ones. Pass `--date YYYY-MM-DD` to name the date the copy was read, which defaults to today.
