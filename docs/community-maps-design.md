# Community Maps design (rev 8, 2026-10-28)

A place inside the app where the community shares random map scripts. A user can browse maps, download one into the editor, see when a newer version exists and see which tournament matches it was played in. Anyone can publish a map, and anyone can publish a new version of any map, with the script's header and changelog keeping the credit straight. Scripting competitions run inside the app too, from the call for maps through submissions to the announced results. Worked out from `CREATION_PLAN.md` Sec.A.6 (noted 2026-10-15) and item 5 of `feedback/next_steps.md`. Design only, nothing built. Sec.14 holds the questions still open.

Read `CLAUDE.md` first. The rules that bite here are "every interactive UI element wraps in HelpTip" and the house language rule, and `PLAN.md` Open question 2 item 3 (free, no ads, no paid tier, permanently) binds every choice below. This is not the withdrawn tool registry of `external-tools-design.md`. That shared tools, and this shares maps.

**Revisions.** Rev 1 and rev 2 were written 2026-10-27, rev 2 from the owner's first answers (a set is one match, competitions run in the app, no-account publishing preferred). Rev 3 the same day folds in the owner's answers to rev 2's Q1 to Q9. aoe2map.net is out. Publishing is automated with no pull request review (Sec.6). Parser errors only warn. Competitions may hide entries until they close (Sec.7.3), discussion stays on Discord, and competitions are added by a maintainer by hand. Edited copies of another author's map are allowed with a changelog and credit (Sec.6.6). Rev 3 also found two clashes with the existing script header stamp (`src/hooks/scriptHeader.ts`) and settles them in Sec.4.2 and Sec.6.7. Rev 4 the same day folds in the owner's next answers. Edited maps are no longer a separate "Edit a copy" map. Anyone uploads a new version of the map itself (Sec.6.6). On upload the app checks the header's Author and Edited by rows and writes a changelog comment under the header, one entry per version with its date and who made it (Sec.6.7). The whole catalog is CC BY 4.0 (Sec.6.8). Hidden competition entries are confirmed. Sec.4.5 answers whether local file versioning (`CREATION_PLAN.md` Sec.A.3) would make this simpler and how the two could be built together. Rev 5 the same day settles rev 4's Q1, Q2 and Q4. Anyone may upload a version, shown at once, with Report on every version and no creator Hide button. The header keeps its Author label. Sealed competitions hide maps, not names. The changelog takes the owner's layout, a title line per version and one `- ` line per change (Sec.6.7). Rev 6 (2026-10-28) settles rev 5's Q2 and Q3. The header's Author row is now labelled Created by, a change already made in the app, since it does not wait on this feature. Anyone may upload someone else's map as a new map, the Created by row names its real creator, and nobody is asked to confirm they wrote it (Sec.6.7). Sec.4.5 gains the pros and cons of the two directions for local history. Rev 7 the same day folds in the owner's next decisions. Local history (A.3) uses a hidden Git store in the app's data folder. Scripts are matched to catalog maps by content as well as by header, and every map lists the maps most similar to it (Sec.4.6). The catalog is designed as a versioned public API from the start, to be offered to other programs once stable (Sec.6.10). A new version's uploader can enter the editor names that go into Edited by (Sec.6.4). No owner questions remain open. Rev 8 the same day records spike S8, the fingerprint calibration, in Sec.4.6, and makes the startup check for competitions on by default with no prompt (Sec.6.10).

## 1. The short answer

- **Maps live in a public GitHub repository**, here called the catalog (working name `age-of-rms-maps`). The app reads one generated index file from it and downloads scripts as plain files. Browsing and downloading need no account.
- **Publishing is automatic and needs no account.** The app sends the map to a small relay, a serverless function holding the only GitHub token. The relay runs every check itself and, if they pass, commits the map straight to the catalog. Nobody reviews it first. A Report button and a maintainer's hide list handle anything that gets through (Sec.6.5).
- **A publisher is a key, not a login.** The app makes a signing key pair on first publish and keeps the private half in the Windows Credential Manager. Every version records the key that published it, which proves two versions came from the same person without saying who that person is.
- **Anyone may upload a new version of any map.** A scripter copies a map, changes it and uploads it as Golden Swamp v3. The version records which version it was edited from and needs a changelog entry. It needs no approval from the map's creator, and a version anyone finds wrong is reported.
- **The script carries its own credit.** On upload the app checks the header, keeps the creator in its Created by row, adds the uploader to an Edited by row when they are someone else, and writes a changelog comment under the header listing every version with its date, its editor and one line per change. The relay refuses an upload whose header or changelog does not match.
- **A version is identified by the hash of its map text**, leaving out the app's header and changelog comments, so a save that only refreshes "Last modified" does not count as an edit.
- **A copied script is also recognised by its content.** Each version has a small fingerprint, so the app can say "this looks like Golden Swamp v2" even when the header was deleted, and every map lists the maps most similar to it.
- **The catalog is a public API from the start.** Versioned read addresses, published schemas and documented upload rules, so other RMS programs can share the catalog once it is stable. A competition opens at a scheduled time, so it appears in every program at once.
- **Tournament match data comes from Liquipedia, fetched by the catalog's CI, never by the app.** Liquipedia's database API needs a key that may not be shared with third parties, and shipping it inside a desktop app shares it with every user.
- **Competitions are added by a maintainer by hand.** A competition has a page with its rules and dates, a Submit button while it is open, submissions that are public or hidden until the close date, and results the maintainer posts once the organisers announce them.
- **The only automatic request is a check for competitions at startup**, the same kind of download the update check already makes, and a setting turns it off (Sec.6.10). Everything else waits for the Community pane. The app stays usable offline, and nothing is sent anywhere without an explicit Publish, Submit or Report click, matching the bug report's rule that the script never leaves the machine on its own (`src/bugReport.ts:30`).

## 2. Facts this rests on

Rows marked "spike" are unverified and gate the slice that needs them (Sec.12).

| Fact                                                                                                                                                                                       | Source                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Liquipedia's MediaWiki API allows one request every 2 seconds, and one `action=parse` every 30 seconds                                                                                     | liquipedia.net/api-terms-of-use, read 2026-10-27                                                                  |
| Liquipedia requires a custom User-Agent naming the project and a contact, gzip support and connection reuse                                                                                | Same page                                                                                                         |
| LiquipediaDB (LPDB) needs an approved request and a key, allows 60 requests an hour, and keys must not be shared with third parties                                                        | Same page. Whether access is free for an open source project is not stated. **Spike S1**                          |
| Liquipedia content is CC-BY-SA 3.0 and must credit Liquipedia as the source                                                                                                                | Same page                                                                                                         |
| Automated reading of Liquipedia's HTML pages is not permitted, only its API endpoints                                                                                                      | Same page                                                                                                         |
| Liquipedia's Age of Empires wiki records the map of each game inside a match                                                                                                               | Believed from browsing, not checked against the API. **Spike S1**                                                 |
| The official mod site (ageofempires.com/mods) is how players install maps from the in-game Mods menu, and how online lobbies get them                                                      | General knowledge, not checked. No public upload API is known. **Spike S6**                                       |
| A map is installed for local play by placing the `.rms` in the profile's `resources/_common/random-map-scripts` folder                                                                     | Community install guides. The exact profile path under `%USERPROFILE%\Games\Age of Empires 2 DE\` is **Spike S3** |
| The app stamps a header comment (File, Created by, Created, Last modified, AoRMS version) on a script created in the app, and rewrites File, Last modified and AoRMS version on every save | `src/hooks/scriptHeader.ts` (`HEADER_FIELDS`, `REFRESHED_FIELDS`), `useDocument.ts` `stampHeader`                 |
| The app never stamps or refreshes the header of an opened file, on purpose, since that would edit someone else's work uninvited                                                            | `useDocument.ts` `loadScript`, the comment above `hasHeaderRef.current = true`                                    |
| A blank document starts as "not stamped yet", so its first save writes a header naming the user in Settings > General as creator                                                           | `useDocument.ts` `newFile`                                                                                        |
| The first-save stamp inserts at offset 0 without looking at the text, so a script pasted into File > New gets a second header naming the paster as creator, above the original header      | `useDocument.ts` `stampHeader`, the `replaceRange(0, 0, ...)` branch                                              |
| No local history exists beyond Monaco's undo stack, and `CREATION_PLAN.md` Sec.A.3 is noted but not designed                                                                               | `CREATION_PLAN.md` Sec.A.3                                                                                        |
| CC BY 4.0 requires credit and an indication of whether the work was changed                                                                                                                | The licence's Sec.3(a)(1)                                                                                         |
| GitHub silently drops an issue or new file prefill past roughly 8 KB of URL                                                                                                                | `src/bugReport.ts` comment on `MAX_USER_AGENT`. Rules out prefilled URLs for whole scripts                        |
| Serverless hosts have free tiers far above the request volume a map catalog sees                                                                                                           | General knowledge. The chosen host's limits and terms are **Spike S7**                                            |
| The app has no HTTP plugin today and its only network use is the updater                                                                                                                   | `src-tauri/Cargo.toml`, `src-tauri/capabilities/*.json`                                                           |
| `tauri-plugin-store` writes plain JSON, so it cannot hold a private key                                                                                                                    | The plugin's design. The key goes in the OS credential store (Sec.6.2)                                            |
| The app must stay free, with no ads and no paid tier                                                                                                                                       | `PLAN.md` Open question 2 item 3, a Game Content Usage Rules condition                                            |

## 3. Where the maps live

| Option                              | Browsing                     | Publishing                     | Versions                       | Running cost and work                                            | Main risk                                                                  |
| ----------------------------------- | ---------------------------- | ------------------------------ | ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **A. GitHub catalog repo** (chosen) | One static index, no account | Relay checks and commits       | Git history plus version files | Free tiers. The relay, and hiding what gets reported             | Bad content is visible until someone reports it (Sec.6.5)                  |
| C. Official mod site                | Link out only                | Link out only, Microsoft login | The site's own mod versions    | Free                                                             | No API, so the app can only open browser pages                             |
| D. Our own server                   | Any shape we like            | Our own accounts               | Any shape we like              | Hosting bills, account security, spam handling, backups, forever | Rejected. Permanent operations work for a free project with one maintainer |

Option B, aoe2map.net, was dropped by the owner on 2026-10-27 after a measurement showed it quiet since 2024.

A gives version history through Git, a home for tournament data in CI with a secret, and static hosting that costs nothing to read.

C is complementary rather than a rival. A map has to be on the mod site for an online lobby to fetch it, and our catalog cannot change that. Each catalog entry gets an optional link to its mod site page (Sec.4.3), and a later slice may add an "Export as mod" step if S6 finds a stable folder layout.

## 4. The catalog

### 4.1 Layout

```
maps/
  golden-swamp/
    map.json          one map, its metadata and version list
    v1.rms
    v2.rms
    v2.png            preview thumbnail of that version
competitions/
  rms-cup-2027/
    competition.json  rules, dates, results (Sec.7)
    sealed/           encrypted entries while a hidden competition is open (Sec.7.3)
moderation/
  hidden.json         map IDs a maintainer has hidden, with a reason
tournaments/
  links.json          written by the Liquipedia workflow, never by hand
v1/                   generated by a workflow on every push, never edited by hand, the public read API (Sec.6.10)
  index.json          every map's summary, version fingerprints and similar maps, the only file the app reads to browse
  maps/golden-swamp.json
  competitions/rms-cup-2027.json
schema/
  map.schema.json
  competition.schema.json
```

`index.json` elsewhere in this document means `v1/index.json`. A map's folder name is its stable ID. It never changes, even if the map is renamed, so links to it keep working. A competition entry is an ordinary map folder whose `map.json` names the competition.

### 4.2 The version hash

`sha256` is computed over the text with line endings normalised to LF and with two leading comment blocks removed when present, the app's header and the changelog under it (Sec.6.7). The header is recognised the way `scriptHeader.ts` recognises it, by its `AoRMS` signature row between a standalone `/*` and `*/`. The changelog is recognised by its first line, `AoRMS changelog`.

Leaving the header out matters because the app rewrites "Last modified" on every save of a script it created. Without the rule, an author who publishes v2 and then presses Ctrl+S with no change would see their own file labelled "Edited from Golden Swamp v2". Leaving the changelog out means the hash covers the map and not its paperwork. Both blocks are metadata the catalog already holds, so ignoring them loses nothing, and an upload whose map text is unchanged from its parent is refused as "nothing changed".

The rule lives in one pure module (working name `src/community/mapHash.ts`) that local history reuses (Sec.4.5).

### 4.3 `map.json`

| Field            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | Same as the folder name                                                                                                                                                                                                                                                                                                                                                                                      |
| `name`           | Display name                                                                                                                                                                                                                                                                                                                                                                                                 |
| `uploadedBy`     | Optional, display name and public key of whoever uploaded v1 when the Created by row named someone else                                                                                                                                                                                                                                                                                                      |
| `creators`       | Display name and public key of whoever published v1, or the name in the uploaded script's Created by row when that is someone else (Sec.6.7), plus any co-creators a maintainer adds. A creator named by someone else has no key until a maintainer adds theirs                                                                                                                                              |
| `license`        | Always `CC-BY-4.0` (Sec.6.8). Kept as a field so the schema states it and a future change is visible                                                                                                                                                                                                                                                                                                         |
| `description`    | Short plain text                                                                                                                                                                                                                                                                                                                                                                                             |
| `tags`           | From a fixed vocabulary in the schema (land, water, hybrid, nomad, closed, team, 1v1 and so on) so filters stay meaningful                                                                                                                                                                                                                                                                                   |
| `players`        | Supported player counts, author stated                                                                                                                                                                                                                                                                                                                                                                       |
| `modSiteUrl`     | Optional, the map's page on the official mod site                                                                                                                                                                                                                                                                                                                                                            |
| `liquipediaMap`  | Optional, the title of the map's page on Liquipedia, which is how match data finds it (Sec.5)                                                                                                                                                                                                                                                                                                                |
| `competition`    | Optional, the ID of the competition this map was submitted to (Sec.7)                                                                                                                                                                                                                                                                                                                                        |
| `versions`       | Ordered list. Each entry has `version` (a whole number counting up from 1), `parent` (the version it was edited from, absent on v1), `file`, `sha256`, `published` timestamp from the relay, `publishedBy` (display name and public key), `editedBy` (the editor names entered in the dialog, Sec.6.4), `changes` (the changelog lines, at least one from v2 on) and the publisher's signature over the hash |
| `hiddenVersions` | Optional list of version numbers hidden by a maintainer after a report (Sec.6.5)                                                                                                                                                                                                                                                                                                                             |
| `supersededBy`   | Optional map ID, for a map that continues under a new name                                                                                                                                                                                                                                                                                                                                                   |

### 4.4 How a version is recognised

The app hashes the open text by the rule of Sec.4.2 and looks the hash up in the cached index.

- A match on the newest version shows a small "Golden Swamp v3 (latest)" label beside the file name.
- A match on an older version shows "v2, v3 is available" with buttons to open v3 beside it or replace the file.
- No match, but the header's Published as row (Sec.6.7) names a catalog map, shows "Edited from Golden Swamp v2". So does a record in the app's own store saying this path was downloaded from that map, for a script whose header row was deleted.
- No match, no header row and no record, but a strong content match (Sec.4.6), shows "Looks like Golden Swamp v2" with the match score.
- Nothing at all shows nothing.

The Published as row is what makes a copied script recognisable wherever it came from. A file passed around on Discord carries it, because the app wrote it at upload and the downloaded text includes it.

### 4.5 Versions, and local file versioning (A.3)

A published version is immutable. A fix is a new version, never an edit to `v2.rms`. Old versions stay listed and downloadable.

Versions can branch. Bob edits v2 into v3 while Carol edits v2 into v4, so v4 does not contain Bob's change. Numbering stays linear for simplicity and each version shows "edited from v2 by Carol". The newest unhidden version is the one "v4 is available" points to.

**Would proper local file versioning make this simpler?** The owner asked, since `CREATION_PLAN.md` Sec.A.3 is planned. Partly. The two share their core but solve different problems.

What local versioning would remove or simplify here.

- **Knowing which map and version a file came from.** If history starts at the download, the publish dialog knows the map and the parent version exactly, instead of reading the Published as row or guessing by similarity.
- **Comparing versions.** Both want a version list and a side by side diff. Monaco ships a diff editor, so one component serves "what changed since my last save" and "what did v3 change from v2".
- **Choosing what to publish.** The dialog can publish a snapshot rather than only the file as it is open now. The seam is one question at publish time, "which text is this version?".
- **The changelog.** The notes a user types against local snapshots can prefill the upload's changelog entry.

What it does not touch. The relay, keys, checks, moderation, competitions and match links are all about other people, and a local history is about one machine. A script pasted in from Discord has no local history before the paste, so the Published as row is still needed. This holds whatever stores the local history, Git included (see the comparison below).

**The two directions A.3 names, compared.** The owner asked for the pros and cons (2026-10-28), then asked three questions that corrected the first comparison. Would it matter that scripters do not know Git, if Git were handled behind the scenes? What is wrong with one repository holding every map? Why would Git share nothing with the catalog?

The answers separate two things the first comparison mixed together. **What the user sees** is the same either way, a History panel listing saves by time with Compare and Restore. **What stores the history** is the real choice. Git can be that store with nobody ever seeing it, and no account is needed, since Git keeps history on the local machine and asks only for a name and an email written into each commit, which the app fills from Settings. An account matters only for pushing to a host such as GitHub.

So there are three options, not two.

|                                | A. Own snapshot store                                                                                                           | B. Hidden Git store                                                                                                                                                                                                     | C. Visible Git beside the script                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where history lives            | The app's data folder, compressed copies of each save plus a small index                                                        | A Git repository in the app's data folder                                                                                                                                                                               | A `.git` folder in the script's own folder                                                                                                                                                                                                                          |
| Does the user need to know Git | No                                                                                                                              | No, the app is the only thing that touches it                                                                                                                                                                           | Yes, it is meant to be used with Git tools                                                                                                                                                                                                                          |
| What we build                  | The store, its index, pruning                                                                                                   | Calls into a Git library. `isomorphic-git` is plain JavaScript, so it runs in Vitest like the rest of the TS and keeps logic out of the thin Rust side                                                                  | As B, plus handling a user's own commits and branches in the same repository                                                                                                                                                                                        |
| Storage cost                   | About 5 KB per save, compressed (the median of 52 maps on disk, measured 2026-10-28). A thousand saves of one map is about 5 MB | The same. `isomorphic-git` stores every version whole and compressed, with no delta packing and no `gc` (its `pack` command writes whole objects, read 2026-10-28). Real Git's smaller packs need a repack it cannot do | As B                                                                                                                                                                                                                                                                |
| Header-only saves              | Skipped by the hash rule of Sec.4.2                                                                                             | Skipped the same way, before committing. Git's own hash covers the whole file, so the hash rule is needed either way                                                                                                    | As B                                                                                                                                                                                                                                                                |
| Fit with community maps        | A download is the first snapshot, a publish marks one                                                                           | The same, a download becomes the first commit, carrying the catalog version in its message, and a publish tags the commit it sent                                                                                       | The same, but in a repository the user may also be editing by hand                                                                                                                                                                                                  |
| Later backup to GitHub         | Needs an export step written from scratch                                                                                       | Close to free, push the repository, for a user who has an account                                                                                                                                                       | Already there                                                                                                                                                                                                                                                       |
| Risks                          | Our own format to keep correct                                                                                                  | Library size (a few hundred KB), and a library interface the developers have to learn. The user never sees it                                                                                                           | A `.git` folder lands in the game's random map folder or the user's folder and gets zipped up or deleted with it. A user who already keeps the folder in Git gets the app's commits in their history. Two app windows saving at once can collide on Git's lock file |

**One repository holding every map** is not wrong in itself. Git tracks each file's history separately within one repository, and showing one map's history is a filter. It mattered in the first comparison only because a visible repository sits in a shared folder the user also uses for other things, which is option C's risk row. In option B the repository is the app's own and the question disappears. B can keep one repository for every script or one per script, a detail for A.3's own design.

**"Shares nothing with the catalog"** was wrong as written. It meant that a user's local repository is not a clone of the catalog's GitHub repository, so Git cannot publish a map by pushing, since pushing needs a GitHub account and the relay exists to avoid one. What the two features share is the hash rule, the version record and the diff view, and any of the three stores can carry those. With Git as the store the link is direct, a downloaded map's catalog versions can even be written into the local repository as commits, so "which version did I edit from" becomes a question Git answers itself.

**Settled 2026-10-28, option B, a hidden Git store in the app's data folder.** The user sees only the History panel. It costs a few hundred KB of library, and buys a standard format and an easy later path to a backup on GitHub for users who want one. An earlier draft of this paragraph also claimed smaller storage than option A. That was wrong for `isomorphic-git`, which stores each version whole, so storage is the same as A's, about 5 KB per save. Option C is not built as the default, for its risk row, though a later setting could offer it to scripters who already use Git.

**Recommendation: build them alongside, from a shared core, and do not make either wait for the other's whole scope.**

1. Design A.3 next, as a History panel over a hidden Git store in the app's data folder (option B above, settled 2026-10-28).
2. Build the shared core first, used by both. The hash rule of Sec.4.2, one version record shape (`hash`, `parent`, `date`, `by`, `changes`) used by local snapshots and catalog versions alike, and the diff view.
3. Community slice A (read only) does not need A.3 and can run in parallel with it. Slice B's publish dialog takes its parent version and changelog prefill from A.3 when it exists, and falls back to the header row and the content match of Sec.4.6 when it does not.

A downloaded map would then enter local history as its first snapshot, labelled "Golden Swamp v2 from the community", and a later upload marks the snapshot it published as "published as v3".

### 4.6 Matching by content, and similar maps

Settled 2026-10-28. The header rows and the download record can both be missing, a file passed around on Discord with its header deleted for example. A content match finds the map anyway.

**The fingerprint.** Settled by spike S8 (below). The map text is normalised by the rule of Sec.4.2, then read by the app's own lexer with comments dropped, so reformatting, edited comments and blank lines do not count as changes. Every name the script defines itself with `#const` or `#define` becomes one placeholder token, so renaming a constant is not a change. The token stream is cut into overlapping runs of 3 tokens, runs on the stop list below are left out, and a MinHash of the rest keeps the smallest of 64 hash values. The fingerprint also stores how many runs went in. The share of the 64 positions where two fingerprints agree estimates their **overlap**, the share of all their runs they have in common. From the overlap and the two run counts follows **containment**, the share of the smaller script's runs found in the larger. One pure module (working name `src/community/fingerprint.ts`) computes it, and the catalog's workflow runs the same module, so both sides always agree.

**Boilerplate.** Most scripts share blocks copied from DE's own maps, the player setup and the standard starting objects for example, so two unrelated maps already agree on part of their fingerprint. Every 3-token run found in at least 10% of DE's shipped maps goes on a fixed stop list (4,743 runs from 188 maps) and is left out before hashing. The list is versioned with the fingerprint scheme and published with the API (Sec.6.10), since a client with a different list computes different fingerprints.

**Spike S8, measured 2026-10-28** (`tools/fingerprint-probe/`, whose README holds the method and the full output). Pairs of unrelated maps from the community and local corpus, 1,824 of them, against the real versions on disk (Menindee v2.3, v2.5 and WDC2 v1.7, Comeer v1.4 and v1.5) and synthetic edits of 40 community maps.

| Measure     | Unrelated pairs                    | Real versions | Synthetic edits, median                     |
| ----------- | ---------------------------------- | ------------- | ------------------------------------------- |
| Overlap     | p99 0.09, max 0.72                 | 0.31 to 1.00  | 15% of numbers 0.61, all edits at once 0.39 |
| Containment | p99 0.31, two pairs at 0.6 or more | 0.93 to 1.00  | 15% of numbers 0.87, all edits at once 0.72 |

- **Overlap misses a version whose live code changed size.** The two Comeer files are both 1,031 lines with about 73 changed, but the copy of v1.4 on disk has a stray `/*` on line 196 that is never closed. DE nests comments, so every later `/* */` pair balances inside it and the last 835 lines are comment by the engine's rules (the app's lexer reports RMS0001 there). v1.4's live code is therefore about a fifth of v1.5's and almost wholly inside it, so overlap reads 0.31 and containment 1.00. The same happens whenever a version adds code or comments a block out, so the version guess uses containment.
- **The two unrelated pairs at containment 0.6 or more are real shared code.** A community map, Pa Site, whose code is nearly all found in DE's Fortified Clearing (0.95), and DE's African Clearing against Land Nomad (0.73).
- **Runs of 3 tokens beat 5 and 8**, scoring edits higher for the same unrelated tail. Without the stop list, DE maps from one template score up to 0.92 overlap against each other.
- **The placeholder for own names** raised Comeer's overlap from 0.27 to 0.31. Small here, but renames are common between versions.
- **64 hashes** keep the estimate within 0.04 of the exact overlap at p95. A fingerprint costs about 5 ms on a median map after about 7 ms of lexing.
- **The sample of real versions is small**, four distinct relationships. The thresholds below are a starting point, to be checked again once the catalog holds real version histories.

**Thresholds**, from that table.

| Use                                           | Rule                                                                            | What it catches in S8                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version guess and "Looks like" (Sec.4.4, 6.4) | Best containment of at least 0.6                                                | Every real version, every one-change synthetic edit, the median heavy edit. Two unrelated pairs, both real shared code                                                                               |
| Similar maps list                             | Containment of at least 0.4, the smaller script at least 200 runs, closest five | Nine unrelated pairs. DE maps from one template, a community map sharing nearly all its code with a DE map, a test template cut from Comeer, and two pairs of community maps that share large blocks |
| "Similar to" chip, and the new map question   | Containment of at least 0.8, by a different creator                             | Only Pa Site against Fortified Clearing                                                                                                                                                              |

The 200-run floor keeps a tiny script from looking contained in every large one.

**Where it is used.**

- The index workflow stores each version's fingerprint and run count in `index.json`, about 1 MB per 1,000 maps.
- The publish dialog adds the content match to its guess at which map a script belongs to (Sec.6.4). When the match and the header disagree, the dialog shows both.
- Recognition (Sec.4.4) shows "Looks like Golden Swamp v2" for a strong match with no other record.

**Similar maps.** The index workflow compares every map's newest version with every other map's and records the closest five above the list threshold as `similar`, with their scores. A thousand maps is about half a million comparisons of 64 numbers each, a moment of CI time. The owner liked this for browsing, so it is a feature in its own right.

- Every map's details list its similar maps with their scores, each one clickable.
- A card shows a "Similar to Golden Swamp" chip when its closest match by a different creator passes the chip threshold.
- A new map that passes the chip threshold against an existing one by a different creator is still accepted, but the publish dialog asks first whether it should be a new version of that map instead, and the chip lets a maintainer spot a copy claimed as new.

A fingerprint measures shared text, not similar gameplay. Two maps written separately that play alike score low, and a map that reuses a large block from another scores high. The details list says "similar code" for that reason.

## 5. Tournament match links

### 5.1 What gets linked

- **Map to set.** "Golden Swamp was played in this match of Tournament X." A set is one match, a series such as a best of five between two players or teams (settled 2026-10-27). Liquipedia's match records hold this, game by game.
- **Map to tournament.** Derived from the set links, so a map shows a tournament only when at least one of its matches was found.

### 5.2 How the data flows

```
Liquipedia (LPDB)  --scheduled GitHub workflow, key as a secret-->  tournaments/links.json  --index workflow-->  index.json  -->  app
```

1. A scheduled workflow in the catalog repository runs weekly. For every map with `liquipediaMap` set, it asks LPDB for matches with a game played on that map, inside the limit of 60 requests an hour.
2. It writes the results to `tournaments/links.json`, keyed by map ID. Each entry has the tournament name and Liquipedia page title, the match (players or teams, round, date, the score), which games of the match were on this map, and the version of our map if known.
3. The index workflow folds the links into `index.json` with a credit line for Liquipedia and the CC-BY-SA 3.0 notice. The app shows that credit wherever match data appears.
4. The app links out to Liquipedia pages and never calls Liquipedia itself.

If LPDB access is refused or costs money (S1), set links are dropped and tournament links become hand entered by a maintainer. The MediaWiki API, which needs no key, then only checks that each linked page exists.

### 5.3 Which version was played

Liquipedia knows a map by name, not by our version. Tournaments often play a tuned copy of a map. So a link records the version only when a maintainer says so, through an optional `tournaments` list in `map.json` (`{ liquipediaTournament, version }`). A competition winner that went into a tournament pool gets this from the competition's `tournament` field (Sec.7.1). Without either, the app shows the match against the map as a whole and says the version is unknown.

### 5.4 Matching names

`liquipediaMap` is set by hand, once per map. Matching on the map's display name automatically was rejected because common names collide ("Arabia" covers dozens of different scripts).

## 6. Publishing

### 6.1 The relay

A single serverless function (Spike S7 picks the host) between the app and GitHub. It holds a GitHub App token with write access to the catalog repository and nothing else.

| Route              | Does                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `POST /v1/publish` | A new map or a new version of any map. Checks it and commits it                                           |
| `POST /v1/submit`  | A competition submission. Refused after the close date, sealed if the competition hides entries (Sec.7.3) |
| `POST /v1/report`  | A report on a map or on one of its versions, with a reason. Opens an issue on the catalog repository      |

Each publish or submit carries the files, the metadata and a signature from the sender's key. The relay runs the checks of Sec.6.3. If they pass, it commits the files to the catalog's main branch in one commit through GitHub's API, retrying on a fresh head when two publishes race. A workflow on push rebuilds `index.json`, so a new map shows in the pane a minute or two later. The relay answers with the commit, or with the failed check's message worded for an author.

Each key and each address is limited to a few requests an hour. Addresses are kept only for the length of the window.

The relay is deliberately thin. A relay outage stops new publishing and nothing else, since browsing reads the catalog directly.

### 6.2 The author key

The first Publish or Submit makes an Ed25519 key pair on the Rust side. The private half goes into the Windows Credential Manager through the `keyring` crate, and never reaches `tauri-plugin-store` or the webview. The public half and a display name the user picks are the author's identity from then on.

Settings gets an Author section with the display name and two buttons. Export Key writes the key pair to a file the user saves, so a second PC or a reinstall can keep publishing as the same author. Import Key reads such a file. A lost key cannot be recovered by anyone, so a maintainer adds the author's new key to their maps by hand after confirming who they are on Discord.

### 6.3 What the relay checks

These run before anything is committed, and run again in the catalog's CI after each push as a backstop that alerts the maintainer if a bad commit ever lands.

- `map.json` validates against the schema, and the license is `CC-BY-4.0`.
- Only `.rms` text and a `.png` thumbnail are accepted, each under a size cap (256 KB for the script, larger than any corpus map, and 200 KB for the image).
- Every `.rms` parses with the app's own parser without throwing. Parser errors and warnings are shown to the author and never block (settled 2026-10-27), since some working maps carry errors the engine tolerates.
- `sha256` values match the files and the signature verifies against the key in `publishedBy`.
- The header and changelog match the catalog record, by the rules of Sec.6.7. The Created by row names the map's creators, the Edited by row includes this version's editor names (Sec.6.4) when they are not creators, and the changelog's top entry carries this version's number, a date within a day of the relay's clock (time zones differ), the editor names and at least one change line. A mismatch is refused with the exact row to fix, although the app's own dialog has already fixed it, so only a hand-made request sees this.
- A new map whose hash equals any published version is refused, with "this is already Golden Swamp v2, upload it as a new version of that map instead". A new version whose hash equals its parent is refused as "nothing changed".
- An existing version file is never changed or deleted by the relay.
- Names and descriptions have length limits and pass a short word filter.
- `#include_drs` of anything other than the game's own files gets a warning, since the downloaded map will not work without that file.

The relay cannot tell whether a request came from Age of RMS. The app is open source, so anything it could send to prove itself can be copied into a script. Every rule above is therefore a check on the content, never on the sender.

### 6.4 New map and new version

1. The user opens File > Publish to Community. The dialog (Sec.8.2) first asks one thing, **New map** or **New version of an existing map**, with the answer already picked by the guess below.
2. For a new map, it collects name, description, tags, player counts and the two optional links. For a new version, the map's metadata is shown read only and the fields are the parent version and the changelog entry. Both show the preview thumbnail the app renders at a fixed seed and the current Generation Settings.
3. The dialog shows the header and changelog exactly as they will be uploaded, with the rows it added or corrected highlighted (Sec.6.7).
4. The user ticks the consent box and clicks Publish. The app writes the header and changelog into the open buffer as one undoable edit, makes the key on first use, signs the hash and sends everything to the relay.
5. On success the dialog links to the map in the pane, and a file with a path is saved so the copy on disk matches what was published. On failure the buffer edit is undone and the failed check's message is shown.

**Which map is this a version of?** The guess, in order. The header's Published as row. The app's download record for this path. A local history record, once A.3 exists (Sec.4.5). A strong content match (Sec.4.6). Otherwise New map is picked. Whatever the guess, the user can switch, and picks the map from a search of the catalog rather than typing its name, so the choice always points at a real map. The parent version defaults to the version of the chosen map with the fewest lines differing from the open text, which is cheap since a map has a handful of versions. The user sees "edited from v2" and can change it.

**What the uploader may type.** Settled 2026-10-28.

- **Created by** for a new version always comes from the catalog's record of the chosen map, never from typing, so nobody can drop the original creator's credit.
- **Created by** for a new map is the uploader's to give (Sec.6.7).
- **Edited by name.** A new version has a name field, prefilled with the display name of the uploader's key when they are not one of the map's creators, and empty when they are. The uploader can change it, or list more than one name for a joint edit. The names are stored on the version as `editedBy`, appear on the changelog title line and are added to the header's Edited by row. Names that are already creators are not repeated there.

Settled 2026-10-27, the owner wants this to be the smooth path, because scripters usually copy an existing script, change it and want to upload it. So a new version needs no permission from the map's creators, and shows at once. There is no creator Hide button either. An unwanted version is reported like anything else (Sec.6.5).

### 6.5 Moderation after the fact

With no review before publishing, what the community sees is filtered by the checks above and corrected afterwards.

- Every map's details have a Report button, and so does every row of its version list (settled 2026-10-27). Both offer a short list of reasons (spam, offensive text, not the publisher's work, broken, a version that undoes or vandalises the map) and an optional note. A version report names the version, so a maintainer can hide that version alone. It goes through `POST /v1/report` and becomes an issue on the catalog repository.
- A maintainer hides a map by adding its ID to `moderation/hidden.json`, or one version through the map's `hiddenVersions`. The index leaves it out, the files stay in history, and the publisher sees why in the pane.
- A maintainer can block a key from publishing through a list the relay reads.

### 6.6 New versions by other scripters

Settled 2026-10-27. A scripter who changes someone else's map uploads the result as a new version of that map, not as a separate map. The owner chose this because it matches how scripters work, copying a script, changing it and wanting to share it.

- The version records its `parent` and its `publishedBy`. Its changelog entry is required, as it is for every version after v1.
- The credit is kept three ways. The header's Created by row always names the map's creators. The Edited by row names the editors recorded on each version in this one's line of parents. The changelog lists every version with its date and editors. The pane shows the same from the catalog's record, so a header deleted by hand does not erase the credit there.
- The map's details have a version list showing each version's number, date, editor, parent and change lines, with Compare beside any two and Report on each row (Sec.4.5's diff view).
- CC BY 4.0 (Sec.6.8) is what makes this lawful without asking the creator each time. It allows changes as long as the creator is credited and the changes are indicated, which the header and changelog do.

A scripter who wants a separate map under a new name instead, a tournament's own variant for example, publishes it as a new map. Its hash differs from every published version once anything is changed, so the relay accepts it. Linking such a map back to the original is not designed here, since the owner asked for the version path. Sec.13 keeps the rev 3 Edit a copy design for reference.

### 6.7 The script header and changelog

**A downloaded map must never be stamped as the downloader's.** Open in Editor puts the map into a buffer with no file path, which `useDocument.ts` today treats like New. Its first save would then write a header naming whoever downloaded it as creator, with today as Created. A buffer from the catalog must start the way an opened file does, with `hasHeaderRef` set, so the stamp never runs on it.

**The header after upload.** Two rows join `HEADER_FIELDS`. Neither is in `REFRESHED_FIELDS`, so ordinary saves never touch them.

| Row          | Content                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Created by   | The map's creators from the catalog. The existing row, relabelled from Author on 2026-10-28                            |
| Edited by    | The `editedBy` names of every version in this one's line of parents, oldest first, creators left out. Absent if nobody |
| Published as | `Golden Swamp v3 (golden-swamp)`, the map's name, this version's number and the map's stable ID                        |

The existing File, Created, Last modified and AoRMS version rows are left as the uploader has them.

**The changelog** is a second comment directly under the header. Its first line, `AoRMS changelog`, identifies it the way the `AoRMS` row identifies the header, and it is laid out by the same rules `scriptHeader.ts` follows (each `/*` and `*/` on its own line, values passed through `sanitizeField` so no word opens a nested comment).

Each entry is a title line with the version, the date and the editor names, then one line per change starting with `- ` (settled 2026-10-27, the owner's layout). A blank line separates entries.

```
/*
  AoRMS changelog

  v3   2026-11-02   Bob
  - increased boars per player from 2 to 3
  - reduced neutral gold group size from 5 to 4
  - fixed bugged land spawns due to overcrowding the map with neutral land commands

  v2   2026-10-28   Alice
  - fewer wolves

  v1   2026-10-20   Alice
  - first version
*/
```

The publish dialog's changelog field takes one change per line and adds the `- ` itself, so a pasted list that already starts with `- `, `* ` or `• ` is not doubled. A new version needs at least one change line. Each line is passed through `sanitizeField`, which matters more here than in the header, since change lines are free text and a standalone `*/` in one would end the comment early and leave the rest of the changelog as live code. `map.json` stores the lines as a `changes` array per version, so the catalog can rebuild the block exactly.

The changelog lists this version's line of parents, newest first, rebuilt from the catalog's records on every upload. Rebuilding rather than appending means a changelog lost or mangled in a copy comes back whole, and Carol's v4 edited from v2 lists v4, v2 and v1 but not Bob's v3, which it does not contain. The block belongs to the app, so a hand edit to it is replaced at the next upload, and the upload dialog shows the replacement before it happens.

**What the upload check fixes.** The dialog runs these on the open text before signing, and shows each change. The relay runs the same rules and refuses what does not match (Sec.6.3).

- No AoRMS header. One is written, with the creators in Created by and today as Created.
- Two AoRMS headers stacked at the top. This is what pasting a script into File > New and saving produces today, since the first-save stamp inserts its header above whatever is there (Sec.2). The lower one, the original, is kept, the upper one is removed, and its File and Last modified values move into the kept header.
- A Created by row naming someone other than the creators, typically the uploader after a paste. It is set back to the creators, and the uploader goes to Edited by. A header stamped before the relabel says Author, and the check reads it as the same row and rewrites its label.
- Edited by missing this version's editor names. They are appended.
- Published as missing or naming another map. It is rewritten for the map chosen in the dialog.
- Changelog missing, incomplete or edited. It is rebuilt with this version's entry on top.

**For a brand new map** the creator is whoever the Created by row names (settled 2026-10-28). When the row is blank, reads Unknown or names the uploader, the uploader is the creator. When it names someone else, that name becomes the creator, with no key, and the map records the uploader separately as `uploadedBy`. The pane shows "by Zetnus, uploaded by Bob" and the changelog's v1 title line reads `v1   2026-10-28   Zetnus (uploaded by Bob)`. Nobody is asked to confirm they wrote the map. The owner's view is that context makes it obvious, and Report (reason "not the publisher's work") handles anyone who lies. The header preview in the dialog shows who will be recorded, so a stale Created by row in a script the uploader did write is visible before Publish. The header gets Published as and a changelog with the v1 entry, whose change lines are optional, and `- first version` is written when they are left empty.

Uploading someone else's map grants CC BY 4.0 on their behalf, which only they can actually do. That risk is accepted with the rest of the after-the-fact moderation (Sec.6.9), and a creator who objects reports the map.

This changes the rule that the app never edits an opened file uninvited. Clicking Publish is the invitation, and the dialog shows every change first.

The header and changelog travel with the file into the game folder and to Discord, which is the point of writing them into the script. Anyone can still edit them by hand, so the catalog's records stay what the app trusts, and what the relay checks uploads against.

### 6.8 Licences

**Settled 2026-10-27, the whole catalog is CC BY 4.0.** There is no licence field in the publish dialog, only a line beside the consent box. The table below is the comparison the owner chose from, kept for the record.

| Licence                               | Others may                                                         | Pros                                                                                                              | Cons                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **CC BY 4.0**                         | Play, share, edit, use anywhere, with credit and a note of changes | The best known, and its two duties are exactly Sec.6.6's credit and changelog. Tournaments can tweak a map freely | Allows commercial use, such as a paid map pack. Rare in this community                                               |
| CC BY-SA 4.0                          | As CC BY, and edited copies must stay under CC BY-SA               | Edits can never be locked away                                                                                    | A second licence to explain, and it cannot be mixed into a CC BY catalog in the other direction                      |
| CC BY-NC 4.0                          | As CC BY, but not commercially                                     | Matches the community's free habits                                                                               | "Commercial" is unclear for prize tournaments and sponsored streams, which could make organisers wary of using a map |
| CC BY-ND 4.0                          | Play and share, no edited copies                                   | Authors keep control of their design                                                                              | Blocks new versions by others and tournament tweaks, against Sec.6.6                                                 |
| CC0                                   | Anything, no credit required                                       | No friction at all                                                                                                | Drops the credit the owner wants for edited maps                                                                     |
| All rights reserved, catalog may host | Download and play only                                             | Authors keep everything                                                                                           | No legal right for anyone to edit, so Sec.6.6 would not work                                                         |

With one licence a reader never has to check it, a new version by another scripter is always allowed, and the licence itself requires the credit and change notes that the header and changelog provide (Sec.6.7).

What publishing under it means for a creator, which the consent block says plainly. Anyone may upload new versions of your map, and anyone may use it elsewhere, including commercially, as long as you are credited.

### 6.9 What going without accounts costs

- **A relay to keep alive.** One function on a free tier with one secret. Its token must be rotated if leaked, and with write access a leaked token could vandalise the catalog until rotated, although Git history makes every change reversible.
- **Bad content is public until reported.** Checks catch the mechanical cases. Offensive text that passes the filter, or a lightly changed copy of someone's map claimed as new, stays up until someone reports it and a maintainer hides it.
- **Names are not verified.** Anyone can pick the display name "Zetnus". The key proves that two uploads came from the same person, not who that person is. A maintainer can mark known authors as verified in the index once they confirm on Discord.
- **A lost key is a manual fix.** An author who reinstalls without exporting their key needs a maintainer to reassign their maps.

### 6.10 The catalog as a public API

Settled 2026-10-28. The catalog is designed as a REST style API from the start, so other RMS programs can share the same maps, versions and competitions. It stays unannounced until the owner judges it stable, and the documentation says "unstable" until then.

**Reading.** Static JSON on GitHub Pages, served from the catalog repository by the index workflow, open to requests from any website or program. No server, no key and no account.

| Address                          | Returns                                                    |
| -------------------------------- | ---------------------------------------------------------- |
| `GET /v1/index.json`             | Every visible map's summary, fingerprints and similar maps |
| `GET /v1/maps/{id}.json`         | One map's full record, its versions, editors and changes   |
| `GET /v1/maps/{id}/v{n}.rms`     | One version's script                                       |
| `GET /v1/maps/{id}/v{n}.png`     | One version's thumbnail                                    |
| `GET /v1/competitions/{id}.json` | One competition, its rules, dates, entries and results     |

**Writing.** The relay's routes (Sec.6.1), all under `/v1/`, with documented request and response shapes and stable error codes such as `header_mismatch`, `nothing_changed`, `duplicate_of`, `competition_closed` and `rate_limited`.

**Rules every client follows.** The relay checks content, never the sender (Sec.6.3), so another program's upload is accepted exactly when it follows the same rules as ours. These are the hash rule (Sec.4.2), the fingerprint scheme (Sec.4.6), the header rows and changelog layout (Sec.6.7) and Ed25519 signing (Sec.6.2). They are written up in `docs/community-api.md` in the catalog repository, with test inputs and their expected outputs so another project can check its own code. Our own modules (`mapHash.ts`, `fingerprint.ts` and the header and changelog writer) stay free of React and Tauri, so they can later be published as a small library for programs written in JavaScript.

**Duties of a client**, stated in the same document. Show each map's creators and editors, the CC BY 4.0 notice and a way to report a map or a version. These cannot be enforced, but the catalog's own CI rejects any commit that breaks the data rules, so the shared data stays correct whatever a client displays.

**Versioning.** Inside `v1` changes are additive, new optional fields only. A breaking change starts `v2`, served alongside `v1` for a stated period.

**One announcement, everywhere at once.** A competition appears at its `announces` time, or at `opens` when that is unset (Sec.7.1), which every client compares with its own clock. Its record is public in the repository before then, since the repository is public, but no client shows it early, and the relay accepts entries only inside the window by its own clock. A maintainer commits a competition ahead of time, so it goes live in every program at the same moment however recently each one fetched. Clients check with a conditional request (an ETag) no more than every 15 minutes. GitHub's cache can delay a fresh commit by several minutes, which the scheduled opening absorbs.

**Startup check.** Settled 2026-10-28, on by default with no prompt. The app fetches `index.json` when it starts, so an open competition shows without the pane being opened. It only downloads, the same as the update check the app already makes at every startup (`src/update/useUpdateCheck.ts`), and like that check it stays silent when offline. Settings has a switch to turn it off.

**Address stability.** The GitHub Pages address is free. A custom domain in front of it would let the catalog move host without breaking other programs, at the cost of a yearly domain fee, and can be added before the API is announced.

## 7. Competitions

What the RMS community runs today. A tournament or the RMS Discord announces a scripting competition. A Discord channel opens for submissions, which are public, and anyone can view and comment on them. Submissions close on a date, and the results are announced a week or two later. The app takes over the parts that are about maps and links to Discord for the conversation.

### 7.1 `competition.json`

A maintainer writes this by hand and commits it whenever a competition is announced (settled 2026-10-27). Organisers ask the maintainer on Discord.

| Field              | Meaning                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`       | Stable ID (the folder name) and display name                                                                                                      |
| `host`             | Who runs it, for example the RMS Discord or a tournament's organisers                                                                             |
| `tournament`       | Optional Liquipedia tournament page, when the winners go into that tournament's map pool                                                          |
| `rules`            | Plain text with the brief, the constraints (player counts, settings, anything the host requires) and the prizes                                   |
| `announces`        | Optional UTC timestamp when clients start showing the competition, so it can be announced before submissions open. Defaults to `opens` (Sec.6.10) |
| `opens`, `closes`  | Submission window, as UTC timestamps                                                                                                              |
| `resultsDue`       | Optional expected announcement date, shown as "results expected around"                                                                           |
| `hiddenUntilClose` | Whether entries stay sealed until `closes` (Sec.7.3)                                                                                              |
| `discussionUrl`    | The Discord channel or thread where submissions are discussed                                                                                     |
| `results`          | Absent until posted. Placings (map ID and place), optional honourable mentions, an optional short write up                                        |

### 7.2 Submissions

A submission is a map whose `map.json` names the competition. It goes through `POST /v1/submit`, which refuses it once the close date passes, by the relay's own clock. Before the close date the author can submit new versions, and the version that stands at the close date is the entry. Later versions of the same map show as published after the competition.

An entry is an exception to Sec.6.6. Until the results are posted, only its creators may upload versions of it, so nobody can change another competitor's entry. After results, anyone may, as with any map.

### 7.3 Hidden entries

Settled 2026-10-27, a competition may hide its entries until it closes. A public repository cannot hold a secret in plain text, so the relay seals them.

- The relay keeps one secret key per hidden competition. A sealed submission is committed as an encrypted file under `competitions/<id>/sealed/`, beside a plain record of the author's name, the entry's hash and the relay's timestamp.
- The pane shows the entry count and the authors' names while it is open, with "Entries are revealed when submissions close". An author still has their own copy on their machine.
- At `closes`, a scheduled workflow with the same key decrypts every entry and commits it as an ordinary map. The plain hashes recorded at submission prove nothing was swapped.
- The cost is a second secret held in two places. If it is lost before the close date, the entries are lost too, so the relay's host keeps a backup of it.

Authors' names are not hidden, only the maps (settled 2026-10-27).

### 7.4 Discussion

Comments stay on Discord (settled 2026-10-27). Every submission card has a Discuss button that opens `discussionUrl`.

### 7.5 Results

The organisers announce results on Discord as today, and a maintainer copies the placings into `results` and commits. Once the index is rebuilt, the pane shows the results above the submissions, and each placed map gets a badge such as "1st, RMS Cup 2027" on its card everywhere it appears.

### 7.6 In the pane

A Competitions view beside the maps grid, with three groups. Open, with a countdown to the close date and a Submit button. Judging, closed and waiting for results. Finished, with results. Opening one shows the rules, dates, host, the Discuss link, every submission as a map card (or the sealed count while hidden) and the results when they exist. Submit opens the publish dialog with the competition already chosen and its rules shown beside the form.

## 8. In the app

### 8.1 Community pane

Opened from File > Browse Community Maps. A pane over the editor area, like Generation Settings, not a fourth main tab, since it is visited rather than worked in.

- Maps and Competitions as the pane's two views.
- A search box and tag filters across the top of Maps.
- A grid of cards, each with thumbnail, name, creators, newest version and its editor when that is someone else, a match count badge and any competition placing.
- A "Similar to" chip on a card whose closest match by a different creator is very strong (Sec.4.6).
- Selecting a card shows the details. The version list of Sec.6.6 with Compare, the similar maps list with scores, the match list grouped by tournament, links to the mod site and Liquipedia, and the buttons Open in Editor, Copy to Game and Report.
- Open in Editor downloads the chosen version into a new buffer, so nothing is written to disk until the user saves. The buffer never gets a new header (Sec.6.7).
- Copy to Game writes the file into the game's random map folder (S3) and says where it went. The folder is picked once, with the profile folders under `%USERPROFILE%\Games\Age of Empires 2 DE\` offered first.
- The index is fetched when the pane opens and cached with its ETag, so a reopen costs one conditional request. A failed fetch shows the cached copy with its date, or a plain offline message.

### 8.2 Publish dialog

The New map or New version choice and the fields of Sec.6.4, a thumbnail preview, the header and changelog preview with changed rows highlighted, the licence line, and a consent block that must be ticked before Publish enables. The consent says three things in short sentences. The script and its metadata become public under CC BY 4.0. Published versions cannot be fully erased later, even if hidden. Anyone may upload new versions of a map, credited to them. It does not ask the uploader to state that they wrote the map (settled 2026-10-28).

### 8.3 Draft HelpTips

Every control in the pane and the dialogs wraps in HelpTip. Drafts for the less obvious ones.

| Control         | Tip                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Copy to Game    | Puts this version in your game's random map folder so it shows in the lobby's map list. Local play only                           |
| Open in Editor  | Opens this version as an unsaved file. Nothing is written to disk until you save                                                  |
| New version of  | Uploads your changes as the next version of this map. The creator stays credited in Created by                                    |
| Changelog entry | Required for a new version. Goes into the changelog comment under the header, with today's date and your name                     |
| Compare         | Shows what changed between two versions, side by side                                                                             |
| Similar maps    | Maps whose code overlaps this one's most. A high score means shared code, not necessarily similar gameplay                        |
| Edited by name  | Goes into this version's changelog line and the script's Edited by row. Separate several names with commas                        |
| Startup check   | Checks the community catalog for open competitions when the app starts. Downloads only, nothing about you or your scripts is sent |
| Report          | Tells the maintainers something is wrong with this map, or on a version row, with that version only                               |
| Match badge     | Tournament matches this map was played in, from Liquipedia. Click for the list                                                    |
| Version label   | Shown when the open file is exactly a published version                                                                           |
| Publish consent | Required. Published scripts are public and stay in the catalog's history even if hidden                                           |
| Submit          | Enters this map in the competition. You can send new versions until it closes, and the last one counts                            |
| Discuss         | Opens the competition's Discord channel                                                                                           |
| Export Key      | Saves your key to a file. Without it, a new PC cannot act as the creator of your maps                                             |

## 9. Network and security

- Add `tauri-plugin-http` with its scope limited to the catalog's Pages host and the relay. Nothing else is reachable.
- The index and scripts are data. A downloaded script is never run, only parsed and previewed, which the app already does with any file a user opens.
- Thumbnails are PNG from the catalog and are shown as images only.
- The private key never leaves the Rust side. The webview asks Rust to sign a hash and gets a signature back.
- No telemetry. At startup the app makes two downloads, the existing update check and the competition check of Sec.6.10, which a setting turns off. Nothing is uploaded without a Publish, Submit or Report click.

## 10. Data the relay and catalog hold about people

A display name, a public key, and the maps they chose to publish. No email, no password, no account. The relay sees addresses for rate limiting and keeps them only for the length of the window. A report carries its reason and note, not the reporter's identity.

## 11. Relation to other work

- `CREATION_PLAN.md` Sec.A.3 (local history), see Sec.4.5. Designed in `docs/local-history-design.md` (rev 1, 2026-10-28) as a History panel over a hidden Git store, built alongside this feature from a shared core.
- `src/hooks/scriptHeader.ts` and `useDocument.ts` change in Sec.6.7. The catalog buffer fix is needed by slice A. The new rows, the changelog block and the upload check are slice B.
- The stacked header a paste into File > New produces (Sec.2) is worth fixing on its own, independent of this feature. The first-save stamp could skip a text that already starts with an AoRMS header. The upload check copes either way, so nothing here waits on it.

## 12. Spikes and slices

| Spike | Question                                                                                                                                                | Gates   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S1    | Is LPDB access granted to a free open source project, at what cost, and does the AoE wiki's match data carry the map of each game?                      | Slice D |
| S2    | Do `raw.githubusercontent.com` and the GitHub API answer the webview's requests (CORS), or must every request go through Rust?                          | Slice A |
| S3    | The exact profile folder path for local random maps, and whether a map placed there shows in a multiplayer lobby                                        | Slice A |
| S6    | The folder layout of a random map mod on the official mod site, and whether an exported folder can be uploaded there as is                              | Later   |
| S7    | The relay host, its free tier limits and terms, and a GitHub App scoped to one repository committing from it end to end, including two publishes racing | Slice B |
| S8    | Fingerprint calibration on the corpus. **Done 2026-10-28**, results and thresholds in Sec.4.6                                                           | Done    |

S4 (GitHub sign-in, rev 1) and S5 (aoe2map.net, rev 2) are dropped. S2 now asks the same question of the GitHub Pages host.

- **Shared core, with A.3.** `mapHash.ts` (Sec.4.2), `fingerprint.ts` (Sec.4.6), the version record shape and the diff view (Sec.4.5). Small, pure apart from the diff view, and needed by both features. `fingerprint.ts` follows the settings S8 chose.
- **Slice A, read only.** The catalog repository with schema, CI and the index workflow writing the `v1` read API with fingerprints and similar maps, seeded by the owner with a few maps. In the app, the Maps view with the version list, Compare and similar maps, Open in Editor with the header fix of Sec.6.7, Copy to Game, and recognition by hash and by content. The first draft of `docs/community-api.md`. Gated by S2, S3 and the shared core.
- **Slice B, publishing.** The relay's `v1` routes with publish and report and their error codes, the key and its Settings section, the publish dialog with its map guess, parent choice and Edited by name field, the header rows, the changelog block and the upload check on both sides, the hide list. Gated by S7. Uses A.3 for the parent and changelog prefill if it exists by then.
- **Slice C, competitions.** `competition.json`, the Competitions view, Submit, sealed entries and their reveal workflow, results display, scheduled opening and the startup check with its setting. Needs slice B.
- **Slice D, match links.** The scheduled workflow, `links.json`, the match list in the pane. Gated by S1.

Slice E of rev 3 (header rows) is folded into slice B, since the upload check needs the rows from the start. Inviting other programs to the API is not a slice. It happens when the owner judges `v1` stable.

Each slice gets a run sheet section in `manual-test-run-sheet.md` once built.

## 13. Alternatives considered

- **Pull requests with review before publishing (rev 2).** A human filter before anything is public, but every map waits for a maintainer. Replaced by automatic publishing with reports on the owner's decision.
- **GitHub sign-in for publishing (rev 1).** No relay to run and verified identities, but every author needs a GitHub account.
- **aoe2map.net as the home or a second source (rev 2).** Dropped by the owner.
- **Proving a request came from the app.** Impossible for open source software, so every check is on content (Sec.6.3).
- **Hidden entries kept in the relay host's own storage.** Works, but gives the relay state to back up. Sealing them in the repository keeps the relay stateless apart from its keys.
- **In-app comments on submissions.** Needs identity and moderation the project cannot staff. Discord already hosts the conversation.
- **Edit a copy (rev 3).** Another scripter's changes became a separate map with `basedOn` pointing at the original, and a "Based on Golden Swamp v2 by Alice" credit line. Replaced on the owner's decision by new versions of the map itself, which matches how scripters copy and change scripts and keeps one map's history in one place.
- **Only a map's own authors may publish its versions (rev 3).** Safe against unwanted versions, but blocks the copy, change and upload habit the owner wants smooth. A creator Hide button, the lighter form, was also declined, in favour of Report on each version.
- **An automatic Edited by row on every save of someone else's script.** The app cannot tell an author fixing their own map from someone else changing it, so it would misattribute. Rev 4 writes Edited by at upload instead, where the catalog knows who the creators are.
- **Appending to the changelog instead of rebuilding it.** Keeps hand edits, but a copy with a lost or stale changelog would publish a wrong history, and a branch would inherit entries it does not contain.
- **A hidden marker comment in each downloaded script naming its catalog ID (rev 3).** Rejected then because it changes the user's file and is easy to copy into a different map by accident. Rev 4's Published as row is the visible form of it, written only at upload, and the dialog asks the user to confirm the map it names, which covers the accidental copy.
- **Finding the source map by line differences against every catalog script.** Exact, but needs every script downloaded first. The fingerprint is compared against the cached index alone (Sec.4.6), and line differences are kept for picking the parent among one map's few versions.
- **Typed Created by and Edited by values as the fallback when the header is missing.** A typed Created by on a new version could drop the original creator. The map is picked from a search instead, credit comes from the catalog, and only the editor names are typed (Sec.6.4).
- **Pushing announcements to every program as they happen.** Needs a server holding open connections, against the no-server design. A scheduled `opens` time reaches every program at the same moment without one (Sec.6.10).
- **Git visible beside the script, or an own snapshot store, for local history.** Compared in Sec.4.5. The owner chose a hidden Git store.
- **Calling Liquipedia from the app.** Breaks the rule against sharing LPDB keys and puts every user's requests against one rate limit.

## 14. Open questions

Settled 2026-10-27. A set is one match. aoe2map.net is out. Publishing is automatic, with no pull request review. Parser errors only warn. Competitions may hide entries until they close, and authors' names stay visible. Discussion stays on Discord. Competitions and their results are added by a maintainer by hand. Another scripter's changes are a new version of the map, not a separate map, and anyone may upload one, shown at once, with Report on maps and on each version instead of a creator Hide button. The upload checks the header's Created by and Edited by rows and writes the changelog comment, a title line per version and one `- ` line per change. The whole catalog is CC BY 4.0.

Settled 2026-10-28. The header's Author row is relabelled Created by, done in the app. Anyone may upload someone else's map as a new map, credited to the creator its header names, with no statement of authorship asked for. Local history uses a hidden Git store in the app's data folder, designed next as `CREATION_PLAN.md` Sec.A.3. Scripts are matched by content, and maps list their similar maps. The catalog is a versioned public API from the start, offered to other programs once stable. A new version's uploader enters the editor names for Edited by.

No owner questions are open. The spikes of Sec.12 gate the slices.
