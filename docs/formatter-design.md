# Script Formatter — design

CREATION_PLAN 5.2b, first candidate: _script formatter / pretty-printer (AST → clean code)_. A built-in Advanced Tool, `id: "script-formatter"`, and the first tool in the registry to declare `edit-source`.

Spec status: rev 2 (2026-08-24). Section numbers here are this document's. Where it names another doc's section it says so.

**Every corpus figure below is re-derived by `npx vitest run src/tools/builtin/formatter/__tests__/formatter.measure.test.ts --disableConsoleIntercept`**, which prints them in the order this document uses them. Rev 1's figures were hand-probed and three of them were wrong in a way no reader could have checked, so the instrument is now committed beside the spec. It runs inside the normal suite — the whole corpus formats in about a second — so it cannot rot the way a probe deleted at the end of a session does.

### Changelog

**rev 2 (2026-08-24), written with the implementation running and its output read against real scripts.**

1. **Rev 1's denominator was wrong in every section that used it.** It said 56 scripts, "32 top level plus 24 under `local/`". `local/` holds **19**, so the corpus is **51** (plus `test-maps/broken/`'s one deliberately malformed file, which the property gate reads and the census does not). Every figure quoted against 56 has been re-derived and several moved by more than the denominator explains, because rev 1's instruments were text scans and the reporter's are AST walks.
2. **Sec.5.0 is new, and it is the substantive change.** Rev 1 pinned section bodies at column 0 as a corpus fact. It is not one: **87 of 263** section bodies are stepped in under their header, and the split is per script — 13 always, 32 never, 3 mixed, with eleven of the thirteen being DE official maps. Flattening them was the single largest thing the tool did at its own all-preserve default (`local/Arena.rms`: **4,746 of 5,403 lines**), which is the one behaviour Sec.3 exists to prevent. `sectionIndent` now classifies per section, and the corpus-wide changed-line share at the defaults drops from **49.4% to 19.4%**.
3. **The indent-unit detector was reading comment prose as code.** It measured every raw line, so a header comment's own inset decided the file's unit — `test-maps/sample.rms` is a 4-space script that detected three. It now counts only lines a token starts, excluding the interior of a multi-line comment. One corpus file changes answer; it is fixed anyway because the failure scales with how much of a script is header comment, and a new map is mostly header comment.
4. **Sec.9 gained the blank-lines-only branch.** Eight corpus scripts produce edits with zero changed lines, because `changedLines` compares line text and a deleted blank line has neither text nor a token. They were rendering an empty preview block and an empty table directly under "Edits proposed: 18".

---

## Sec.1 — What it is, and the one thing it is not

It re-lays-out an RMS script: indentation, line breaks, blank lines, and the choice between "this command's attributes go one per line" and "this whole command goes on one line". It proposes the result as `TextEdit`s through the tools API's existing Apply path (tools-api-design.md Sec.4.5), so it lands as one undoable action on the shared Monaco model.

**It is not "AST → clean code" in the literal sense, and the brief's phrasing has to be corrected before anything else can be designed.** A printer that walks the AST and emits fresh text loses every comment in the file, because comments are not AST nodes — the lexer marks them `isTrivia` and the parser skips them entirely (`src/parser/lexer.ts`'s `markComments`, `parser.ts:132`'s non-trivia index). It would also lose every unparseable region, which is a `RawNode` with a token range and no structure. Both are hard-rule violations ("never silently drop content").

So the formatter is **AST-guided, token-driven**. See Sec.2.

### Sec.1.1 — Why this does not contradict "never re-print code"

CLAUDE.md's hard rule — _"Code is the only source of truth for Breakdown. No parallel model; every user action becomes a `TextEdit` against the source, then a re-parse re-renders. Never re-print code."_ — is scoped to Breakdown, and breakdown-design.md:63 names this tool as the sanctioned exception: _"reformatting/pretty-printing existing code (that's a future Advanced Tool ... Breakdown preserves formatting, it does not normalize it)"_.

The distinction that makes it safe: Breakdown re-prints as a **side effect** of an unrelated edit, where the user never asked for their layout to change and would have no way to see that it had. The formatter re-prints because reformatting _is the request_, the output is shown before it is applied, nothing happens without pressing Apply, and one Ctrl+Z reverses all of it.

---

## Sec.2 — The central invariant

> **The formatter never changes a token. It only changes the whitespace between tokens.**

Every other property in this document falls out of that one.

A `ParseResult` carries `tokens: Token[]` covering every non-whitespace character of the source in order, trivia included (lexer.ts's splitter is whitespace-only). So a script is exactly

```
gap[0] + tokens[0].text + gap[1] + tokens[1].text + … + gap[n-1] + tokens[n-1].text + gap[n]
```

where `gap[i]` is `source.slice(tokens[i-1].end, tokens[i].start)` and is pure whitespace by construction. **Formatting is choosing a new `gap[]`.** The token array is never touched.

What this buys, none of it by good intentions:

- **Nothing can be dropped.** Comments, `RawNode` contents, a `#const` the parser did not recognise, the leading BOM. They are tokens, and every token is re-emitted.
- **Nothing can be invented.** No token text is ever synthesized, so the formatter cannot "helpfully" add a missing `}`.
- **Minimal edits are free.** Compare each new `gap[i]` against the original. Emit an edit only where they differ, so an already-clean file produces zero edits and the tool says so honestly.
- **Correctness is checkable in three lines.** Re-tokenize the output; the array of token texts must be identical to the input's. Sec.8.

The two ways to break the invariant are both mechanical, so both are guarded:

1. **An empty gap merges two tokens.** Guarded: a gap between two tokens is never written empty. The single legitimate exception is the gap after a leading byte-order mark, which the lexer emits as its own token and which may legally abut the next one.
2. **A token is emitted twice, or not at all.** Guarded: the writer records the last index it placed and refuses a non-increasing one, and the final pass asserts every index 0..n-1 was written exactly once.

---

## Sec.3 — Two philosophies, and why `preserve` is the default

The brief states the observation this whole design turns on: RMS authors use two layouts deliberately, and which one they use carries meaning.

**Expanded** — the command header, then a brace, then one attribute per indented line:

```
create_object GOLD
{
    terrain_to_place_on OUTSIDE_NEUTRAL_LAND_TERRAIN
    number_of_objects   6
    set_gaia_object_only
}
```

**Inline** — the whole command on one line, used when the command fills a space entirely, or when the same command is repeated dozens of times and vertical space is the scarce resource:

```
create_land { terrain_type MOD_LAND land_position 6 93 base_size 1 number_of_tiles 0 }
```

### Sec.3.1 — The measurement

Counted over the 51 scripts in `test-maps/` (32 top level plus 19 under `local/`, which includes the DE official maps), by walking the AST, 2026-08-24:

|                                                         | blocks     |
| ------------------------------------------------------- | ---------- |
| whole command on one line ("inline")                    | **11,162** |
| command header and block spread over lines ("expanded") | **4,692**  |

(Rev 1 said 11,226 / 5,417 from a brace-matching text scan over a corpus it counted as 56 files. The inline figure survives almost intact; the expanded one does not, because a text scan counts every `{ … }` including those inside an unparseable region, and the AST counts blocks the formatter will actually lay out.)

Three things in that table decide the design.

**One. Inline is not a niche.** It is the majority form on this corpus. A formatter shipping "expand everything" as its behaviour would rewrite 11,226 blocks against their authors' intent on the first run.

**Two. The split is per author, not per script, and it is bimodal.** Per-file inline share: `local/Arena.rms` 98%, `24hr_A Heart Map.rms` 100%, `AK_Vanguard_v1.2.rms` 94% — against `local/Acclivity.rms`, `local/Haboob.rms`, `local/Enclosed.rms`, `local/nomad.rms`, `24hr_Mont Saint Michel.rms`, `TL Team Acropolis.rms` and eighteen others at **0%**. Twelve files sit in a genuinely mixed 30–80% band. There is no majority style to normalise toward; there are two communities and a mixed middle.

**Three. There is no third shape to preserve.** Of the single-line blocks, the number whose `{` sits on a line of its own while the block still closes on that same line is **0**. And of the multi-line blocks, all but 54 are canonically braced (`{` opening a line or ending the header line, `}` opening the closing line) against 54 that are not. So the brief's two philosophies are exhaustive in practice, and the fallback it asks for — _"if it is not already one of these behaviours then apply default of laying the attributes out one each line"_ — is reachable but rare.

**Conclusion: `blockLayout` defaults to `preserve`**, classifying each block from the source. `expanded`, `inline` and `compact` are available and are choices the user makes, not defaults they inherit.

### Sec.3.2 — Classification

For a `CommandNode` (or `OrphanBlockNode`) with a block:

```
sourceIsInline(node) = lineOf(tokens[node.firstToken].start) === lineOf(tokens[node.lastToken].start)
```

`lastToken` is the closing brace for a closed block. `lineOf` is `src/parser/lineIndex.ts`'s `lineOfOffset`, already the one place that conversion lives.

Anything not inline is treated as expanded, which is the brief's stated fallback and, per Sec.3.1's third finding, also what 99% of non-inline blocks already are.

### Sec.3.3 — When inline is refused regardless of policy

`canInline(node)` is false, and the block is expanded whatever the policy says, when any of:

- the block is unclosed (`block.close === undefined`), so there is no `}` to put at the end of the line;
- the block contains a `RawNode` at any depth, which is reproduced verbatim and may be multi-line;
- a comment inside the block's token range spans more than one source line.

Note what is _not_ on that list: a block containing `if` / `elseif` / `else` / `endif` or `start_random`. **1,069 of the 11,162 single-line blocks contain one** (rev 1 said 810, from the text scan), `AK_Vanguard_v1.2.rms` and `TL Cape of Storms.rms` most of all, and refusing to preserve those would silently expand a tenth of the inline corpus. Conditionals inside an inline block stay inline.

The `inline` and `compact` policies do decline to _create_ an inline block out of one containing a conditional, since that is a layout the user did not write and probably did not want. `preserve` keeps what is there. The asymmetry is deliberate: preserving is faithful, imposing is opinionated.

---

## Sec.4 — Comments

Comments are the reason this tool is token-driven, and they get three separate rules.

### Sec.4.1 — A trivia run is one opaque unit

Take a maximal run of consecutive `isTrivia` tokens. Reproduce every gap **inside** it verbatim, adjusting only indentation (Sec.4.2). Do not re-flow, do not re-wrap, do not normalise spacing inside a comment.

Treating the whole run as opaque, rather than splitting it into individual `/* … */` comments, avoids having to recompute comment nesting depth outside the lexer. That matters because depth is not recomputable from token kinds alone: `LexOptions.commentOpenAliases` means an ordinary word (a constant whose engine id is 69, measured 2026-08-11/12 — see `src/parser/types.ts`) opens a nested comment _while inside one_, and the set comes from reference data the formatter does not otherwise need. The lexer already did the work and recorded it as `isTrivia`. Trust that, and never second-guess it.

The cost is that a run holding two comments separated by four blank lines keeps four blank lines rather than being capped by `maxBlankLines`. Accepted.

### Sec.4.2 — Re-indenting a multi-line comment

An ASCII-art box or an aligned table inside a comment must survive a change of indent level with its internal alignment intact. So indentation is _shifted_, never recomputed:

- `oldIndent` = the whitespace prefix of the source line on which the run starts.
- `newIndent` = the indent string of the output line the run lands on.
- Every subsequent line inside the run that begins with `oldIndent` has exactly that prefix replaced by `newIndent`. A line that does not begin with it is left alone.

Uniform shift preserves relative columns exactly, and it needs no tab-width arithmetic, which is the trap in the obvious alternative (expand tabs, re-emit, hope the reader's tab stop matches yours).

### Sec.4.3 — Attachment

For a trivia run sitting between a placed token `p` and the next token to place:

- **Trailing** if the run starts on the same source line as `tokens[p]` ends on. It joins the current output line.
- **Own line** otherwise. It starts a new line at the indent of what follows, so a comment introducing an attribute is indented with that attribute rather than left at the outer level.

A run before a container's closing token (`}`, `endif`, `end_random`) is indented at the _inner_ level, because a comment written last inside a block belongs to the block.

### Sec.4.4 — Comment-headed indentation groups

The brief's second observation: _"some comments can signify a code block and hence the code that 'belongs' to that comment should be indented"_. This one is real, it is not structural, and the AST cannot see it:

```
/* corners */
    /* left corner */
        create_land
        {
            terrain_type TERR_CORNER
            …
        }
        create_land
        …
    /* bottom corner */
        create_land
        …
```

(`24hr_Battle Lines 1.0.rms`, which uses the idiom systematically and nests it two deep.)

**Detection is a sibling-list rule, not a line rule**, and that is what makes it safe. Inside one item list — a section's items, a block's items, one `if` branch's items — every sibling sits at the same structural depth, so structural indentation is constant across them and any _remaining_ difference in source column is authorial. Within one list:

1. A comment entry that starts its source line opens a candidate group.
2. The group is the run of following siblings whose source start column is strictly greater than the comment's.
3. The group ends at the first sibling whose column is less than or equal to the comment's, or at the end of the list.
4. A group with at least one member is emitted at `level + 1`, recursively, so nesting works with no extra machinery.

**Measured incidence, 2026-08-24:** 1,490 own-line comment units; **53** of them open a group of two or more deeper-indented lines, in **15 of the 51 files**, including the DE official `Acclivity`, `Enclosed`, `Fortress` and `Haboob`. (Rev 1 said 87 in 27 files against a 2,169 denominator, from a text scan over a corpus miscounted as 56 files. The shape of the finding is unchanged: it is a real idiom, used systematically by a minority.) The reporter's count is a loose upper bound — it scans tokens, where the implemented rule scans one SIBLING LIST at a time, which is what stops a command's own indented block from reading as a group.

**Known false positive, stated rather than engineered around.** An author who leaves a heading comment at column 0 and indents the body under it, inside a construct the formatter already indents, gets one extra level:

```
if DEATH_MATCH
/* the extra resources */
    create_object GOLD
    …
endif
```

Here `create_object` is deeper than the comment for a structural reason the formatter has already accounted for, and the rule reads it as authorial. The result is cosmetic, and it is **idempotent** — reformatting the output re-detects the same group and produces the same text, so it does not drift. `commentGroups` turns the rule off.

---

## Sec.5 — Layout rules

Indentation level `L` starts at 0. `indent(L)` is the indent unit repeated `L` times.

| Node                    | Rule                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SectionNode` header    | own line, `L = 0`, one blank line before it unless it is the first thing in the file (`blankLineBeforeSections`)                                                   |
| section items           | `L = 0` or `L = 1`, per `sectionIndent` — see Sec.5.0.                                                                                                             |
| `DirectiveNode`         | own line at `L`, arguments on the same line                                                                                                                        |
| `AttributeNode`         | own line at `L`, arguments on the same line                                                                                                                        |
| `CommandNode`, no block | own line at `L`, arguments on the same line                                                                                                                        |
| `CommandNode`, inline   | every token from the name through `}` on one line at `L`                                                                                                           |
| `CommandNode`, expanded | header at `L`; `{` per `braceStyle`; items at `L + 1`; `}` at `L`                                                                                                  |
| `OrphanBlockNode`       | as a command's block, with no header                                                                                                                               |
| `IfNode`                | `if` / `elseif` / `else` / `endif` at `L`; branch items at `L + 1` when `indentConditionals`                                                                       |
| `RandomNode`            | `start_random` and `end_random` at `L`; preamble items and `percent_chance` at `L + 1`; branch items at `L + 2`; all the `+1`s conditional on `indentConditionals` |
| `RawNode`               | first token on its own line at `L`; every gap inside reproduced verbatim with the Sec.4.2 shift                                                                    |

Two of those rows are measured rather than chosen, and the reporter counts ITEMS where rev 1 counted lines. `indentConditionals` defaults on because **24,317 of 26,108** items inside an `if` branch are indented relative to their keyword, against 1,791 at the same column. `percent_chance` is indented relative to its `start_random` in **1,253 of 1,364** cases. `braceStyle` defaults to `preserve`, falling back to `ownLine`, because among multi-line blocks the brace opens its own line **4,011** times against **587** on the header line.

### Sec.5.0 — Section bodies, the third philosophy

Rev 1's table put section items at `L = 0` and justified it in six words: _"matching the corpus"_. It does not match the corpus, and this was the most expensive sentence in the document.

**Measured 2026-08-24, over the same 51 scripts:**

|                                    | sections |
| ---------------------------------- | -------- |
| body flush with the header         | **176**  |
| body stepped in one level under it | **87**   |

Per script: **32** never indent a section body, **13** indent every single one, **3** are mixed. Eleven of the thirteen are DE official maps — `Arena`, `CoastalForest`, `Arabia`, `Migration`, `nomad`, `Glade`, `Graupel`, `Acclivity`, `Enclosed`, `Haboob`, `fortified_clearing`.

That is the same shape as Sec.3.1's inline/expanded split, arriving one level up, and it gets the same answer. **`sectionIndent` defaults to `preserve`**, with `flat` and `indented` available as choices.

**What it cost while it was pinned.** `local/Arena.rms` changed **4,746 of its 5,403 lines** at the all-preserve default, and the whole corpus changed **49.4%** of its lines. With the policy in, Arena changes **21** and the corpus changes **19.4%**. Six DE official maps go from thousands of changed lines to zero. Nothing else about the tool moved — the same blocks are kept inline, the same blocks stay expanded — which is what identifies this as one rule rather than a general excess of enthusiasm.

**Classification is per section, not per file**, for the same reason `braceStyle: preserve` is per block: the three mixed scripts keep both halves of what they wrote, and there is no whole-file pass to get wrong.

**The test is the minimum column over everything in the section that starts a line, and it counts tokens rather than `section.items`.** Two shapes force that, and both are live:

- A leading comment group (Sec.4.4) indents its own members, so _"the first item is indented"_ is true of a flat section that merely opens with one. Only a minimum separates a stepped-in body from a group inside a flat body.
- **A comment is not an `Item`.** `24hr_Battle Lines 1.0.rms` puts every item of a section under a heading comment at column 0, so an items-only scan sees a fully indented body and steps the whole thing in a second time. This was caught by a unit test written for Sec.4.4 in rev 1, which is the argument for keeping a rule's own fixture around after the rule is implemented.

The interior lines of a multi-line comment are excluded, same rule and same reason as Sec.5.3's indent detection: an ASCII-art box is prose, not indentation.

**Idempotent by construction.** The output indents those same lines by exactly one unit, so a re-run re-detects `indented` and emits identical text. The corpus gate checks this on every file at every option set, which matters more here than anywhere else in the design: a `preserve` rule that classifies from its own output is the one failure mode that makes a file drift a little further on each run.

### Sec.5.1 — Blank lines

The number of blank lines before an entry is `(newlines in the original gap) − 1`, clamped to `[0, maxBlankLines]`, default max 1. Blank lines vanish inside an inline block, which is the point of an inline block.

### Sec.5.2 — Spacing inside a line

`intraLineSpacing` defaults to `preserve`: when two tokens were on the same source line and end up on the same output line, the original horizontal gap is kept exactly.

This is not laziness. **9,354 of 90,945 non-blank corpus lines (10.3%)** carry an internal run of two or more spaces or a tab BETWEEN two words — the leading indent is excluded, since every indented line has one — and reading a sample of them shows deliberate column alignment:

```
    terrain_to_place_on               OUTSIDE_NEUTRAL_LAND_TERRAIN
    number_of_objects                 6
```

Collapsing that to single spaces is destructive, irreversible from the user's point of view, and orthogonal to what the user asked for when they asked for their indentation fixed. `intraLineSpacing: "collapse"` is there for people who want it.

The consequence to be aware of: a gap that was vertical and becomes horizontal (inlining a block) has no original horizontal text to preserve, so it becomes a single space. Preservation only applies where it means something.

### Sec.5.3 — Indent unit, line endings, file edges

- **`indentStyle: "preserve"` (default)** detects the script's own unit, and it does so **only from lines a token starts, excluding the interior of a multi-line comment**. That exclusion is rev 2's: measuring every raw line let a header comment's own inset decide the file's unit, and `test-maps/sample.rms` is a 4-space script that came out as three. An own-line comment still counts, because authors indent those with the code they introduce and Sec.4.4 depends on that being deliberate.

  If as many evidence lines start with a tab as with spaces, or more, the unit is one tab; otherwise it is the **smallest** space-indent width with real support (5% of indented lines or two lines, whichever is larger), clamped to 1..8. Smallest rather than modal, and rev 1's text said modal while the code has always said smallest: in a 4-space file indented three levels deep the most common prefix is easily 8 or 12, so taking the mode invents a unit nobody typed. Fallback when nothing is detectable is one tab. Corpus, by this detector: **29 of 51** files come out as tabs. Explicit `tab`, `2 spaces`, `4 spaces` are available, and the output header always states which unit was used, since a "preserve" that silently picks something has to be auditable.

- **Line endings are always preserved, with no user-facing option.** 48 of 51 corpus files are CRLF. Emitting LF into a CRLF document would make every single line differ, turning a five-edit reformat into a whole-file rewrite. The dominant ending is detected from the source and used for every break the formatter emits.
- **Trailing whitespace on a line is always removed.** It is invisible and 3,727 corpus lines carry it.
- **The final newline is preserved as-is**, present or absent. 30 of 51 corpus files end without one, and adding one would be an unrequested edit at the bottom of every such file.

---

## Sec.6 — The user preference surface

The brief's requirement (b): _"allow for users to alter the pretty printer to match their own preferences."_ Three layers, in increasing order of effort.

### Sec.6.1 — Manifest params, rendered by the host

The primary answer. Every knob is a `ToolParamDef`, so the host renders the form, validates the values, clamps the integers and rejects an out-of-range default at registration (`src/tools/protocol.ts`).

| key                  | type            | default    | what it does                                              |
| -------------------- | --------------- | ---------- | --------------------------------------------------------- |
| `blockLayout`        | select          | `preserve` | `preserve` / `expanded` / `inline` / `compact` (Sec.3)    |
| `inlineMaxWidth`     | integer 40..400 | 100        | the width `compact` fits against                          |
| `alwaysExpand`       | multiSelect     | `[]`       | block commands always laid out expanded                   |
| `alwaysInline`       | multiSelect     | `[]`       | block commands always laid out inline                     |
| `indentStyle`        | select          | `preserve` | `preserve` / `tab` / `2 spaces` / `4 spaces`              |
| `sectionIndent`      | select          | `preserve` | `preserve` / `flat` / `indented`, per section (Sec.5.0)   |
| `braceStyle`         | select          | `preserve` | `preserve` / `ownLine` / `sameLine`, expanded blocks only |
| `indentConditionals` | boolean         | `true`     | indent `if` and `start_random` bodies (Sec.5)             |
| `commentGroups`      | boolean         | `true`     | keep comment-headed indent groups (Sec.4.4)               |
| `intraLineSpacing`   | select          | `preserve` | `preserve` / `collapse` (Sec.5.2)                         |
| `maxBlankLines`      | integer 0..5    | 1          | consecutive blank lines kept                              |

`alwaysExpand` and `alwaysInline` are **built from `reference/data/language.json`**, filtered to `kind === "block"` — 12 commands today — rather than hardcoded, per CLAUDE.md's "vocabulary is data-driven, hardcode no RMS vocabulary". They match on the _resolved_ command name (`CommandNode.def.name`), so `#const L 32` followed by `L { … }` is recognised as `create_land`. That idiom is live in `24hr_Holler.rms`.

A command named in both lists is expanded. Cross-param constraints are not expressible in a manifest, so the rule is documented rather than validated.

These two params are also the first real exercise of `multiSelect` outside the consistency checker's player-count matrix, which is one of the things CREATION_PLAN 5.2b asks a second tool to be good for.

### Sec.6.2 — `FormatOptions`, for whoever edits the code

`src/tools/builtin/formatter/options.ts` exports the whole option set as a plain interface with a frozen default. The tool maps its params onto it and does nothing else with them, so the layout engine has no idea a params form exists and can be driven from a test, a script, or a future settings page with no change.

### Sec.6.3 — Writing your own

The engine is pure, imports nothing but `src/parser` types, and is reachable as `formatScript(parseResult, options)`. A v1.1 external tool author who wants a formatter this one will not become writes their own against the published contract and registers it. That is the point of "one contract, two transports" and it costs this design nothing.

### Sec.6.4 — What is deliberately not here

**Param values do not persist across sessions.** `ToolsPane` holds them in component state, keyed by the selected tool, and resets on tool switch. A user whose preference is "always 4 spaces" re-picks it each session. Fixing it properly means a settings.json family for tool params plus a host-side change, which is a tools-API change and not a 5.2b tool's business. Filed as a follow-up, not worked around here.

---

## Sec.7 — Edits

The formatter emits **one `TextEdit` per changed gap**, not one whole-file replacement.

- An already-formatted file produces zero edits, and the tool reports "no changes needed" rather than a no-op Apply button.
- Adjacent changed gaps separated by fewer than 80 unchanged characters are **coalesced** into one edit spanning both, with the intervening token texts included in `newText`. Uncoalesced, a badly-indented 4,000-line map produces tens of thousands of edits, and `pushEditOperations` has to sort and apply every one. Coalescing costs a little payload and takes the typical count down by roughly an order of magnitude.
- Edits are non-overlapping and in ascending order by construction, which is what `protocol.ts`'s `validateEdits` requires and what `useDocument.applyTextEdits` relies on to make Apply a single undo entry.

The host already refuses edits from a tool that did not declare `edit-source` (`host.ts:294`), and already marks a result stale when the document changed under it, with "re-run before applying, tool edits are never rebased" (`ToolsPane.tsx:273`). Nothing new is needed for either.

---

## Sec.8 — Verification, and what happens when it fails

Before returning, the formatter re-tokenizes its own output and compares `tokens.map(t => t.text)` against the input's.

This is sound without knowing anything about comments or reference data, because the lexer's _splitting_ is purely whitespace-based (`lexer.ts`: split on the C `isspace` set, then classify). `commentOpenAliases` and `nestedComments` change only which tokens are marked trivia, never where the boundaries fall. So an identical token-text array proves that no character of content was added, dropped, merged or split.

**On mismatch the tool emits no edits at all** and reports an `error`-severity block naming the first differing index with both texts. A formatter that cannot prove it preserved the script does not get to modify it. This is the operational form of the "never silently drop content" hard rule, and it is checkable rather than aspirational.

Adjacent failure modes and their handling:

| situation                                 | behaviour                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| parse has `error` diagnostics             | format anyway, and add a warning block saying how many, and that regions the parser could not read are reproduced exactly. `RawNode`s make this safe.                                                                                           |
| unclosed comment at EOF                   | everything from the opener is one trivia run, reproduced verbatim. The file is effectively unchanged from there down.                                                                                                                           |
| unclosed block or `if`                    | the container has no closing token; items are still emitted at their indent and nothing is invented.                                                                                                                                            |
| a non-trivia token belongs to no AST node | emitted verbatim in index order where it falls, and counted in the output as an unplaced token. This should be impossible (parser-design Sec.12's coverage property) and is handled rather than asserted, because the alternative is losing it. |
| empty file                                | zero tokens, zero edits.                                                                                                                                                                                                                        |

---

## Sec.9 — Output

`ownsSettingsHeader` is not set. The formatter does not read generation settings, so the pane's `Run at N players` echo is harmless and consistent with the other read-only tools.

Blocks emitted, in order:

1. `heading` — "Script formatter".
2. `severity: error` and nothing else, if Sec.8's verification failed.
3. `keyValue` — the settings actually used (resolved indent unit, line ending, block policy), then the counts: blocks left inline, blocks left expanded, blocks changed from one to the other, lines whose text changed, edits proposed.
4. `severity: warning` — if the parse had errors.
5. `text` — a capped unified-diff-style preview of the first changed hunks, so the user can see what Apply will do before pressing it. Capped well under `LIMITS.maxTextLengthPerBlock` (100,000).
6. `table` — the first changed lines with 1-based line numbers and `rowSpans` for click-to-jump, capped at 200 rows with the total stated.

**Blocks 5 and 6 are replaced by one sentence when there are edits but no changed line.** `changedLines` compares line TEXT, and a deleted blank line has neither text nor a token, so the token-keyed diff cannot see it — eight corpus scripts land here at the defaults, `local/Arabia.rms` with 18 edits and zero changed lines. Rendering the normal shape gives a preview block holding the empty string and a table with no rows, immediately under "Edits proposed: 18", which reads as a broken tool rather than as a small change. The replacement says what actually moved and how many lines the file gains or loses.

Locations in prose are **1-based line numbers**, never offsets. `rowSpans` and any `codeRef` carry the offsets. That split is tools-api-design's Sec.2 rule and the mistake it exists to prevent has shipped in this repo before.

---

## Sec.10 — Module layout

```
src/tools/builtin/formatter/
  options.ts   FormatOptions, DEFAULT_FORMAT_OPTIONS, resolveIndentUnit, detectLineEnding
  writer.ts    GapWriter — the gap array, placement primitives, edits, verification
  layout.ts    the AST walk: entries, comment groups, section levels, per-node rules
  index.ts     formatScript() — orchestration, stats, the diff preview
  __tests__/format.test.ts              the unit gates (Sec.11)
  __tests__/corpus.test.ts              the three corpus properties (Sec.11)
  __tests__/formatter.measure.test.ts   the reporter behind this document's figures
src/tools/builtin/scriptFormatter.ts   the ToolImplementation and its manifest
```

`options.ts`, `writer.ts` and `layout.ts` import only from `src/parser` (types plus `lineIndex` and `lexer`) and are pure in the same sense `src/parser/**` is — no React, no Monaco, no Tauri, runnable in plain-Node Vitest and in a worker. `scriptFormatter.ts` additionally imports `language.json` to build its two `multiSelect` option lists (Sec.6.1) and the tools-api types.

It runs in-process, not in a tool worker. The work is one pass over the token array; the whole corpus formats in well under the `DEADLINES.runWatchdogMs` budget and there is no Monte Carlo layer to yield around. No entry in `WORKER_RUNTIME_TOOL_IDS`.

---

## Sec.11 — Tests

Unit, in `src/tools/builtin/formatter/__tests__/`:

- classification: inline/expanded per policy, the `canInline` refusals of Sec.3.3, `alwaysExpand` beating `alwaysInline`, resolution through `#const L 32`.
- comments: trailing versus own-line attachment, multi-line shift preserving internal alignment, a comment before a closing brace indenting inward, comment groups including nesting and the documented false positive.
- edges: empty file, comment-only file, unclosed block, unclosed comment, `RawNode` verbatim, CRLF in, CRLF out, BOM preserved, no-final-newline preserved.
- edits: zero edits on already-formatted input, coalescing, ascending and non-overlapping.

Section bodies (Sec.5.0) get their own group: a body kept indented, a body kept flush, a mixed script keeping both, the minimum-column rule refusing to read a leading comment group as an indented body, and both impositions.

Corpus gate, over every `.rms` in `test-maps/` including `local/` and `broken/`, at the default options and at one set that overrides every `preserve` rule at once:

- **token preservation** — Sec.8's check, on every file. Non-negotiable.
- **idempotence** — `format(format(x)) === format(x)`. This is what catches a classification rule that is not stable under its own output, which is the failure mode a `preserve`-heavy design is most exposed to.
- **no parse regression** — the formatted text parses with no _new_ `error`-severity diagnostic. The formatter cannot fix errors and must not create them.

Both gates degrade to the tracked file set on a clone, the same way `src/parser/__tests__/corpus.test.ts` does.

Alongside them, **`formatter.measure.test.ts` is a REPORT, not a gate.** It asserts only that it had files to read, and prints every figure this document pins. It exists because rev 1's figures came from probes that were deleted before anyone could re-run them, and three of those figures were wrong.

---

## Sec.12 — Follow-ups, not in this rev

1. **Persisting param values** (Sec.6.4). Needs a tools-API decision about where tool preferences live.
2. **Format selection, not the whole file.** `read-selection` is already a capability and `ToolSelection` is already an offset anchor with the enclosing `Item`'s span. The gap model handles it directly — format the sub-range, leave every gap outside it untouched. Left out only to keep this rev to one behaviour.
3. **Aligning attribute values into columns** as an active feature rather than only preserving existing alignment. Wanted by the same 10% of lines that motivated Sec.5.2, and a different job: it needs a width model and a decision about what to do when one value is enormous.
4. **A "format on save" setting.** Deliberately last. It is a preference plus a hook into the save path, and it should not exist until the formatter has been run by hand enough times to be trusted.
