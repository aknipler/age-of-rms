# Name lookup, autocomplete, confirmation flash and unknown const offer

Rev 1, 2026-10-22. Approved by the owner 2026-10-22, every question in Sec.12 answered. Slice A (the shared lookup) is BUILT, `src/parser/nameLookup.ts` and `src/parser/scope.ts`, with its tests in `src/parser/__tests__/nameLookup.test.ts`. Slice B (the Code editor) is BUILT, never run in the app. Slice C (the Breakdown value field) and slice D (Land Placement and the Add Template field) are BUILT 2026-10-23, never run in the app. Sec.13 (line and block prediction, slice E) was added 2026-10-23 and approved the same day with Q6 and Q7 answered. Slice E is BUILT 2026-10-23, never run in the app.

Three features share one question, "does this name exist here, and what is it". This doc puts that question in one pure module and has every RMS text input ask it.

1. Autocomplete wherever RMS text is typed.
2. A short green flash when a typed name resolves to a real const.
3. An offer to create a `#const` when a typed name matches nothing.

A fourth, Sec.13, asks a different question ("what did this script write here last time") and shares only the Code editor's slot detection.

## Sec.1 Surfaces

Found by listing every `<input>`, `<textarea>` and Monaco editor in `src/`.

| Surface                                               | Where                                                                                                                                                                                                                                       | What is typed         | In scope                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| Code editor                                           | `src/components/CodePane.tsx` (Monaco). The tutorials' Code tracks use this same editor                                                                                                                                                     | Whole script          | Suggestions, flash, create offer                                                            |
| Breakdown value field                                 | `src/breakdown/cards/ValueEditor.tsx`. One component behind command and attribute arguments (`AttributeRow`), `#const`/`#define` values (`DirectiveCard`), `if`/`elseif` conditions (`ConditionalCard`) and `percent_chance` (`RandomCard`) | One argument          | Suggestions, flash, create offer (not in condition slots, Sec.7.1)                          |
| Land Placement formula                                | `FormulaField` in `src/tools/builtin/landPlacement/panel/LandPlacementPanel.tsx`, 16 uses                                                                                                                                                   | Arithmetic over names | Suggestions and flash. No create offer (Q4). Unset names listed after Apply                 |
| Add Template terrain field                            | `src/breakdown/templates/TemplateDialog.tsx`, the field with the `e.g. GRASS` placeholder                                                                                                                                                   | One terrain name      | Suggestions only, since nothing is in the script until the dialog inserts                   |
| Add Command picker, attribute search                  | `CommandPicker.tsx`, `AttributeSearch.tsx`                                                                                                                                                                                                  | Search text           | Out. Both already list commands and attributes through `rankByQuery` and `useSearchListNav` |
| Reference table search, Settings, Generation Settings |                                                                                                                                                                                                                                             | Not RMS               | Out                                                                                         |

The Breakdown field today offers constants through a native `<datalist>`. A datalist cannot be accepted with Tab, cannot rank, and cannot say where a name came from, so it is replaced (Sec.4.2).

## Sec.2 The shared lookup

### Sec.2.1 Where it lives

`src/parser/nameLookup.ts`, a new pure module. It sits in `src/parser/` because everything it reads is already there or is plain JSON (`ParseResult`, `LanguageData`, the game constant rows), and that folder's rule (no React, Monaco or Tauri) is exactly the property it needs. The Code editor, the Breakdown and the Land Placement panel all run on the main thread, so it is imported directly. It does not go through the parser worker, since a suggestion has to answer on the keystroke.

It is built in two halves.

- **A static index** built once from `game-constants.json` and `language.json`. Suggestions come from the same ambient rule `builtinConstantNames()` in `validate.ts` already applies (rows in `NON_AMBIENT_CONSTANT_CATEGORIES` are left out, since a script only sees them through its own `#include`). Measured today there are 2081 named rows. Resolution reads every row, the alias categories included. Settled while building slice A. A constants.inc alias name (BUSH_A, SEAGULLS) is real vocabulary that RMS0205 already accepts in an object slot, so the lookup resolves it as built-in and never offers to create it. It is still left out of suggestions, since it may need an `#include` to work. Commands (41), attributes (95), directives (6) and control keywords (7) come from `language.json`, never hardcoded.
- **A script index** rebuilt from each new `ParseResult`. It holds `result.symbols` grouped by name with each definition's name token offset, which is what scope needs (Sec.9).

### Sec.2.2 What it answers

As built. The module's own doc comments are the authority on each field.

```ts
type SlotKind =
  | { kind: "argument"; def: ArgumentDef } // the whole def, since Sec.8 reads default and min
  | { kind: "condition" } // if / elseif, resolves #define and predefined labels
  | { kind: "formula" } // Land Placement, numeric names only
  | { kind: "lineStart"; enclosing: CommandDef | null; section: string | null };

type Resolution =
  | { kind: "number" }
  | { kind: "builtin"; row: BuiltinRow }
  | { kind: "script"; symbol: SymbolInfo; conditional: boolean; aliasOf?: BuiltinRow }
  | { kind: "definedBelow"; symbol: SymbolInfo } // RMS0303's case
  | { kind: "label" } // a predefined condition label
  | { kind: "otherKind"; category: string } // exists, wrong namespace for this slot
  | { kind: "unknown" };

resolveName(stat, script, name, at, slot): Resolution;
suggest(stat, script, prefix, at, slot, limit?): Suggestion[];
closestBuiltin(stat, typed, def): ClosestBuiltin | undefined; // Sec.8.1
defaultConstValue(stat, typed, slot): DefaultConstValue; // Sec.8
unknownNameOffer(stat, script, text, at, slot): UnknownNameOffer | null; // Sec.7.1
moveUpPlan(script, name, at): MoveUpPlan; // Sec.9.1
```

`stat` is `buildStaticNameIndex(language, constants)`, built once. `script` is `buildScriptNameIndex(parseResult)`, built per parse.

`at` is the offset of the use, so the same name can resolve above a definition and fail below one.

Resolution order copies `resolveTerrainId` in `src/preview/generator/grid.ts`, which is the one resolver the preview already shares. A bare number resolves as itself. A built-in name comes next, then the script's own `#const` (first definition wins, since the engine loads `random_map.def` before the script). Name to name aliases (`#const TERR_CORNER GRASS2`, BUG-015) resolve by following the alias once.

Which categories count for a slot type is read from `validate.ts`'s `CONSTANT_SLOT_CATEGORY` and `CATEGORY_ALIAS_OF`, exported rather than restated, so the lookup and RMS0205 (cross category constant) can never disagree about what fits a terrain slot. Numeric slots accept any ambient built-in name, as `ParseOptions.builtinConstants` already does.

`unknown` is only ever a statement about our data. Sec.7 is shaped around that.

## Sec.3 Ranking

The tiers come from `src/breakdown/pickerRanking.ts`'s `matchRank` (exact, prefix, anywhere in the name), matched without case. The description tier is dropped for constants, since 2723 object descriptions would bury every real hit, and kept for commands and attributes. The inserted text always keeps the name's own case.

Within a tier, ties break in this order.

1. Fits the slot. A terrain name before an object name in a terrain slot.
2. The script's own names before built-in ones. A script that wrote `#const MY_FOREST 10` is far more likely to want `MY_FOREST` than `MOUNTAIN_FOREST`.
3. For script names, the definition nearest above the caret first.
4. Shorter names first, then alphabetical.

The list shows at most 12 rows and scrolls. Built-in objects only join the list once two characters are typed, since one letter matches several hundred of them.

`otherKind` names (an object name in a terrain slot) are left out of suggestions entirely.

## Sec.4 Each surface

### Sec.4.1 Code editor

A completion provider in `src/editor/aoe2RmsCompletion.ts`, registered once for `aoe2-rms` in the same way `aoe2RmsHover.ts` registers its hover. The slot comes from the current line, lexed with the real lexer, plus the enclosing block and section from the last `ParseResult`.

- The first word of a line is offered commands valid in the section, attributes of the enclosing command when inside a block, directives after `#`, and control keywords.
- Later words take the argument type of the command or attribute at that position.
- The name after `#const` or `#define` is a new name, so nothing is offered there.

Each item carries the same text the hover shows (kind, category, the line a script const is defined on).

Editor options added in `CodePane.tsx`.

- `wordBasedSuggestions: "off"`. Otherwise Monaco mixes in every word in the file, comments included, and lists names that resolve to nothing.
- `acceptSuggestionOnEnter: "off"` (Q1). Enter always makes a new line.
- Tab and Right Arrow keep Monaco's defaults. Tab accepts while the list is open and indents when it is closed. Right Arrow moves the caret and closes the list.

The last `ParseResult` can lag the model by a few keystrokes. Only offsets near the caret go stale, and those only matter for the scope test, so the provider treats a definition on the caret's own line as not yet parsed rather than guessing.

### Sec.4.2 Breakdown value field

A new `RmsSuggestInput` (`src/components/RmsSuggestInput.tsx`) replaces the `<input list>` pair inside `ValueEditor`. It stays uncontrolled the way `ValueEditor` is today. The popup keeps its own query state from `onInput`, and no `EditIntent` is produced per keystroke. Accepting a row writes `input.value` and leaves the commit to the existing Enter and blur paths.

The list's arrow keys come from `useSearchListNav`, per the Hard rule. That hook picks on Enter. It gains a `pickKey` option, default `"Enter"` so every existing list is unchanged, and this list passes `"Tab"` (Q1). Enter in the field keeps committing what was typed.

### Sec.4.3 Land Placement formula

Suggestions replace the word at the caret, never the whole field. Sources are the ones `resolveSym` already reads, in its order (the model's own emitted names, then the script's `#const`s), plus RandomParam labels and the formula functions `parseFormula` knows. No commands or attributes. There is no create offer in a formula field (Q4, settled). The panel only writes inside its own fence, and a `#const` made there would be lost on the next Apply. The field keeps its current per field note (`UnknownNameNotes`).

### Sec.4.3.1 Unset names after Apply

As built (2026-10-23), the notice shows whenever the model uses a name with no value, under the Apply button, and not only after an Apply. The text and snippet are as below. Settled with the owner 2026-10-23, it stays that way. Shown before Apply, it warns before a layout that cannot generate as drawn is written, and where Apply is refused it is the only notice that can appear at all.

The reason slice D gave for it was only partly true. It said an unset name always fails Apply's dry run, so an after-Apply notice could never show. A probe through `computeApplyEdits` the same day found the dry run fails for some formulas and not others. An unset name as the whole of Base size, or as the first operand of a radius (`UNSET + 5`), still gave Apply its 2 edits, because both evaluators agree the cell has no value. It failed only where they disagree, with the name after the first operand (`5 + UNSET`, which the engine's reading drops) or in a rotation. So in most cases Apply does run with a name unset, and writes a layout that will not generate as drawn, and the after-Apply notice of the original rule would show. Run sheet 43 step 10 was corrected to match.

Settled with the owner 2026-10-22. Apply and Update still write the fence as they do today. Afterwards the panel checks every formula in the model for names that have no value and, if any remain, tells the person what to set and gives them the lines to set it with.

- **The check.** A new pure `collectUnsetNames(model, resolveSym, params, scriptSymbols)` in `formulaField.ts` walks every `Expr` in the model and runs the existing `findUnknownNames` on each, keeping each name once, in order of first use, with its `UnknownNameReason`. Its test builds a model with one name of each reason and one name that resolves, and fails if the resolved one is listed.
- **The notice.** Under the Apply report, reading "These names have no value yet, so the layouts that use them will not generate as drawn. Set them in Code or Breakdown." It is worked out again on every reparse while it is shown, so it shrinks as the person adds lines and goes away once nothing is left.
- **The snippet.** A read only code block with a Copy button (HelpTip `landPlacement.unsetNames.copy`). One line per name the panel can safely write a line for, valued by Sec.8's formula row.

| `UnknownNameReason` | In the snippet  | Said in words                                                                                                                                                                                                    |
| ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notInScript`       | `#const NAME 0` | Nothing more                                                                                                                                                                                                     |
| `defineOnly`        | `#const NAME 0` | "NAME is a #define on line N, which has no number. Replace that line with this one." Replacing rather than adding keeps the snippet clear of how the game treats a `#define` and a `#const` of one name          |
| `conditional`       | No line         | "NAME is only defined inside the branch on line N. Define it on every path, or move this layout into that branch." A header line would win as the first definition and silently override the branch's own values |
| `noNumber`          | No line         | "NAME is defined on line N but has no number at these settings."                                                                                                                                                 |

The snippet is copied, never inserted. Inserting it would be the panel writing outside its fence, which Q4 ruled out. Copy uses `navigator.clipboard.writeText` from the button's own click. Nothing in the repo uses it yet, so the run sheet checks it works inside the packaged WebView2 window.

### Sec.4.4 Add Template terrain field

Suggestions from the terrain slot of the static index plus script consts. No flash and no create offer.

## Sec.5 Keys

| Key                     | List open                                             | List closed                                                     |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Tab                     | Accepts the highlighted row. Focus stays in the field | Unchanged. Code indents, Breakdown moves to the next field      |
| Shift+Tab               | Closes the list                                       | Unchanged                                                       |
| Enter                   | Unchanged, never accepts (Q1)                         | Unchanged. Code inserts a line, Breakdown commits               |
| Right Arrow, Left Arrow | Moves the caret, list follows the new word or closes  | Unchanged                                                       |
| Up, Down                | Moves the highlight (`useSearchListNav`)              | Unchanged                                                       |
| Ctrl+Up, Ctrl+Down      | Caret to start or end (`useSearchListNav`)            | Unchanged                                                       |
| Escape                  | Closes the list                                       | Unchanged. Breakdown reverts the field                          |
| Ctrl+Space              |                                                       | Opens the list (Monaco's default, added to the Breakdown field) |

One known clash. Some Windows input methods (the Chinese ones in particular) use Ctrl+Space to switch layout, and the system takes the key before the app sees it. The list also opens on typing, so nothing depends on Ctrl+Space.

Tab accepting in Breakdown means a person tabbing through fields with the list open needs a second Tab to move on. The list only opens while typing, so a person who tabs without typing never meets it.

## Sec.6 Confirmation flash

### Sec.6.1 When

- **Breakdown.** After a commit's reparse, when the committed argument resolves as `builtin` or `script`. The row flashes, not the whole card.
- **Code.** When the caret leaves a word it just typed (space, Tab accept, Enter, punctuation, an arrow key) and that word sits in a const slot and resolves. Only that word flashes.

It never fires on opening a file, on undo or redo, on a paste of more than one word, or on a Breakdown edit reaching the Code tab. A flash confirms a person's own keystroke, and twenty flashes on a paste confirm nothing.

`definedBelow`, `otherKind` and `unknown` never flash. A `script` result inside an `if` or `start_random` branch flashes the same as any other (Q5).

### Sec.6.2 Timing

One CSS animation of 700 ms, a tinted background fading to transparent. Short enough to stay out of the way when typing continues, long enough to be seen at the edge of vision. A new flash on the same row or word restarts it. In Code it is one `createDecorationsCollection` per editor, the same pattern `applyCutShading` uses, cleared on a timer.

### Sec.6.3 Accessibility

- The colour is the existing `--success-bg` theme token (Settings > Theme > Status colours, "Success background"), so a custom theme and a dark theme each get a readable tint. It is shared with the raw card's Fix button, so a custom theme cannot set the two apart. Chosen by the owner 2026-10-22 over a separate `resolveFlash` token. Green against red is the most common colour vision deficiency, so the flash never carries meaning on its own. The hover on the word or row states what the name is and where it was defined, with or without the flash.
- Under `prefers-reduced-motion` the fade becomes a flat tint held for the same 700 ms and then removed.
- The Breakdown flash also writes "GRASS is a built-in terrain" to a polite `aria-live` region. Monaco has its own screen reader mode, so the Code flash adds nothing there.
- A setting turns it off (Settings > Code and Settings > Breakdown share one toggle).

## Sec.7 Unknown const offer

### Sec.7.1 When it appears

All of these must hold.

- The slot accepts a const name (`integer`, `percent`, `terrainConstant`, `objectConstant`, `otherConstant`). Never a Land Placement formula (Sec.4.3), never a condition slot, since `if` reads `#define`, and never a command or attribute name.
- The text is one word and not a number.
- `resolveName` returns `unknown`. `otherKind` gets no offer, since the name exists and the problem is the slot. `definedBelow` gets its own message (Sec.9).
- The script has no `#include_drs`. An included file can define any name and we cannot read it, so absence proves nothing there.

The offer is an offer, never a diagnostic. It is neutral in colour, adds no marker, no squiggle and nothing to the status bar count. This is the positive resolver rule applied to a new consumer. Our data knowing nothing about a name is not evidence the game does not either.

When a known name is within edit distance 2 (`editDistanceCapped` from `parser.ts`), "Did you mean GRASS?" comes first and the create choices follow.

### Sec.7.2 What it looks like

- **Breakdown.** A strip under the row after the commit, reading "No const named FOREST_A in this script or the built-in list." The strip holds a value field already filled in (Sec.8), a choice between "Above this command" and "In the header", a Create button and a Dismiss button. Each new control gets a HelpTip and a `ui-help.json` entry.
- **Code.** A code action on the word (the light bulb and Ctrl+.), offering "Create #const above this command" and "Create #const in the header". Monaco cannot ask for a value inside a code action, so the action inserts the line with the default value selected, ready to type over, the same thing a snippet placeholder does. Undo removes it in one step. Monaco draws its own light bulb and menu, so those cannot take a HelpTip, and that exception is noted at the provider.

### Sec.7.3 Where the line goes

- **Above this command.** On the line directly above the command that holds the use, at that command's indent. A use inside a block counts as a use by the block's command, since a directive between attributes is not a shape the Breakdown can show. A command inside an `if` or `start_random` branch gets the line inside the same branch, so the definition runs on exactly the paths the use does. A use in a `#const` value gets the line above that `#const`.
- **In the header.** At the end of the preamble, through `insertIntoPreamble` in `computeEdit.ts`. That is the rule `insertText.headerText` already uses for templates, so "the header" means one place across the app.

Both are one insertion and one undo step, since the name is already in the use. A new intent `addConst { name, value, at: { kind: "above"; command } | { kind: "header" } }` carries it and joins the Sec.4.8 property gate before any UI calls it.

### Sec.7.4 Refusals

- A name that is a built-in constant is never offered, since `resolveName` already found it. A name already defined in the script is not offered either, even when the definition sits below (Sec.9).
- A value of 69 gets a warning beside the Create button. A word valued 69 opens a nested comment wherever it later appears inside a comment (RMS0111). The wording comes from that diagnostic.

## Sec.8 Default value

Read from the slot the use sits in.

| Slot                                             | Default                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `integer`, `percent` with a declared `default`   | That default. 16 of 95 attributes declare one, and `validate:reference` already holds each to its own `min` and `max` |
| `integer`, `percent` with a `min` and no default | `min`                                                                                                                 |
| Other numeric slots                              | `0`                                                                                                                   |
| `terrainConstant`, `objectConstant`              | The numeric id of the closest built-in name (Q2), Sec.8.1                                                             |
| `otherConstant`                                  | `0`                                                                                                                   |
| Formula, for Sec.4.3.1's snippet                 | `0`                                                                                                                   |

### Sec.8.1 Closest built-in name

Settled with the owner 2026-10-22. The value is a number, never a name alias. The closest built-in name is found in this order, within the slot's own categories only.

1. A name within edit distance 2 of the typed text. This is the same candidate "Did you mean" offers.
2. The strongest suggestion for the whole typed text (Sec.3).
3. The strongest suggestion for each underscore part of the typed text, last part first, since RMS names put the kind last (`MY_FOREST`, `BIG_GOLD`).
4. Nothing matched, so `0`.

The strip names what the number means beside the value field, in words and never in the script. A comment holding the built-in name would be unsafe, since a word valued 69 inside a comment opens a nested one (RMS0111).

| Typed in the slot                | Rule | Pre-filled line               | Shown beside the field                                              |
| -------------------------------- | ---- | ----------------------------- | ------------------------------------------------------------------- |
| `create_terrain FORREST`         | 1    | `#const FORREST 10`           | 10 is FOREST (Forest, Oak). "Did you mean FOREST?" is offered first |
| `create_terrain MY_FOREST`       | 3    | `#const MY_FOREST 10`         | 10 is FOREST (Forest, Oak)                                          |
| `terrain_type SNOWY_PINE_FOREST` | 3    | `#const SNOWY_PINE_FOREST 10` | 10 is FOREST (Forest, Oak)                                          |
| `create_object BIG_GOLD`         | 3    | `#const BIG_GOLD 66`          | 66 is GOLD (Gold Mine)                                              |
| `create_terrain MUDDY`           | 2    | `#const MUDDY 111`            | 111 is MUDDY_SHALLOW (Swamp, Shallows)                              |
| `create_terrain LAKE_EDGE`       | 4    | `#const LAKE_EDGE 0`          | 0 is GRASS (Grass 1)                                                |

The third row shows the rule's limit. Matching parts one at a time finds `FOREST` and misses that `SNOW_FOREST` (21) or `PINE_FOREST` (19) was likely meant. The value field is there to be edited, and the words beside it say which forest the number is, so a wrong guess is visible before Create.

## Sec.9 Scope of script consts

The engine's rule decides this, and the repo already states it. A `#const` counts only from its own line down (guide line 148, cited in `validate.ts`'s header). RMS0303 (`checkUseBeforeDefinition`) already tests it as "some definition's name token comes before the use". The lookup exports that same predicate and `validate.ts` calls it, so the flash, the offer and the warning are one rule in one place.

- **Defined above the use, unconditionally.** Resolves. Flashes.
- **Defined above, inside a branch.** Resolves, marked `conditional`. The hover says which branch. It flashes (Q5).
- **Defined only below the use.** `definedBelow`. No flash, no create offer, since a second definition would make the later one a redefinition. The message says "FOREST_A is defined on line 40, below this use, so the game does not see it here." It also offers "Move the #const up here" (Q3, settled), Sec.9.1.
- **Suggestions.** Names defined above the caret are listed normally. Names defined only below are listed after every other row, whatever their match tier, tagged "defined below (line N)" (Q3, settled).
- **Land Placement formula.** Unchanged from today. `resolveSym` reads the script's consts with no position test, because the fence emits as a block and its own placement decides what is above it. Changing that belongs to the fence's design, not this one.
- **Built-in names a script redefines.** The built-in wins (RMS0302), so a suggestion shows it as built-in.

### Sec.9.1 Move the #const up here

Settled with the owner 2026-10-22. Shown beside the `definedBelow` message, as a button on the Breakdown strip and as a code action in Code.

- **What moves.** The first definition below the use, since that is the one the game would keep. The line moves through the existing `moveNode` intent (breakdown-design Sec.4.12), which cuts the source text as written and reindents it, so a trailing comment on that line travels with it and nothing is reprinted. One undo step.
- **Where it goes.** Above the use, at the definition's own depth. An unconditional definition goes directly above the outermost item that holds the use (the command itself, or the `if` or `start_random` that contains it), so it stays unconditional and every use that saw it before still sees it. Placing it inside the use's branch would quietly take the name away from uses below on other paths.
- **When it is not offered.**
  - The definition sits inside an `if` or `start_random` branch. Lifting it out would change which maps define it. The message says so and names the line.
  - The definition's value names another script const whose first definition lies between the new spot and the old one (`#const B (A + 1)` with `A` defined in between). Moving `B` would break it. The message names `A`.
  - The script has an `#include_drs`, for the same reason as Sec.7.1.

Both refusals are worked out by the lookup from the `ParseResult`, so the button is hidden rather than shown and then refused. Its HelpTip id is `breakdown.constOffer.moveUp`.

## Sec.10 Slices

Each slice ends green on `npm test`, `tsc` and Prettier, with a run sheet section for whatever needs the real app.

- **A.** BUILT 2026-10-22. `nameLookup.ts` and its tests, RMS0303 moved onto the shared predicate in `scope.ts`. The mutation test ran. Replacing the position test with a bare existence check turned 9 tests red, three of them RMS0303's own in `validate.test.ts`. No run sheet, since nothing in the app calls it yet.
- **B.** BUILT 2026-10-22. Code editor. Completion provider, flash, code actions, `addConst` behind the code action. Run sheet section 38 (36 and 37 went to other work the same day). `src/editor/caretContext.ts` finds the slot, reusing the last parse for every line above the caret's own, which took a keystroke at the end of the largest local map from 62 ms to 6 ms. `addConst` joined the patch engine and the Sec.4.8 property gate, and a deliberately broken version failed the gate on 42 of 63 maps. The pure halves are `constOffers.ts` and `flashRule.ts`, kept free of Monaco so Vitest can load them. Their mutation tests ran. Stopping `holdingItem` from entering `if` branches turned 2 tests red, and dropping the flash's "an edit before the word" rule turned 1 red. The flash reads the existing `--success-bg` token, the owner's choice over a new `resolveFlash` token, Sec.6.3.
- **C.** BUILT 2026-10-23. Breakdown. `RmsSuggestInput` (`src/components/`), the flash, the create strip and the move offer (`ConstOfferStrip.tsx`), `useSearchListNav`'s `pickKey`. `addConst` was already in the property gate from B. A committed name goes into the pane as a note (`BreakdownContext.tsx`, `CommitNote`) that pairs its offset with the source the edit produced, so the field acts only once that source has rendered, and survives the empty field being replaced by a real one when the argument appears. `constReview.ts` holds the rules and is Monaco-free. `staticNameIndex.ts` now holds the shared indexes so the Breakdown and Land Placement can load them in Vitest. Run sheet section 42. The pickKey mutation (Tab to Enter) turned 4 tests red and treating a defined-below name as a flash turned 3 red.
- **D.** BUILT 2026-10-23. Land Placement formula suggestions and flash, the unset names notice with its snippet (Sec.4.3.1), and the Add Template terrain fields. `collectUnsetNames` walks the model structurally, so a field added later is covered without editing a list. Run sheet section 43. Mutations that turned tests red: dropping the walk's descent into objects (6), writing a snippet line for a branch-only name (2), and listing every name whether or not it resolves (2).
- **E.** BUILT 2026-10-23. Line and block prediction in the Code editor, Sec.13. The three spikes ran first and all held (Sec.13.6). `src/editor/linePrediction.ts`, `blockTemplate.ts` and `blockSkeletons.ts` are pure, `aoe2RmsPrediction.ts` is the Monaco provider. `reference/data/block-skeletons.json` holds 169 skeletons from 57 maps, written by `npm run generate:skeletons` (`vitest.skeletons.config.ts`) and held by `validate:reference` to its schema and to `language.json`. The setting is `codePrediction` in `AppSettingsContext`, and ghost text takes the theme's `textMuted` with Monaco's syntax colouring of it turned off. The replay gate is `predictionReplay.test.ts` (Sec.13.7). Building it found a slice B bug. `caretContext` named a block by the token before its `{`, so inside `create_object GOLD {` the enclosing command was GOLD and the line start lost create_object's attributes. It now names the nearest command before the brace. Run sheet section 44. Mutations that turned tests red: the home key replaced by the first word alone (the one unit test Sec.13.7 names), a two-map floor of one, counting blocks instead of maps for the keep vote (3) and for the value vote (2), a skeleton winning over a script block, the `$` escape removed, and in the gate, the oldest line taken instead of the closest (23.8% against 56.6%) and the same-name block preferred over the same-arguments one (72.0% against 73.5%).

## Sec.11 Not covered

- A const used in many places offered as a single rename.
- Suggestions inside comments, which the lexer marks as trivia and the provider skips.
- An offer to create a `#define` from a condition slot. Sec.7.1 leaves condition slots out. It would be a small extension if wanted.

## Sec.12 Questions for the owner

**Q1. Enter while the list is open.** Settled 2026-10-22. Only Tab accepts a suggestion. Enter makes a new line in Code and commits what was typed in Breakdown, list open or not.

**Q2. Default value in a terrain or object slot.** Settled 2026-10-22. The numeric id of the closest built-in name, Sec.8.1.

**Q3. Names defined below the caret.** Settled 2026-10-22. They are listed last, tagged "defined below" (Sec.9), and a use above its definition offers "Move the #const up here" (Sec.9.1).

**Q4. Land Placement formulas writing a `#const`.** Settled 2026-10-22. No create offer in formula fields. Apply instead reports every unset name with a copyable snippet (Sec.4.3.1).

**Q5. Conditional definitions.** Settled 2026-10-22. A const defined inside a branch above the use flashes green, and the hover says it is conditional.

**Q6. The first block of its kind.** Settled 2026-10-23. A skeleton built from other maps, Sec.13.4.1. The owner judged a line or so to fix per block a fair price. The first figures offered (81% of written lines right) were measured over every block. Re-measured on the blocks the skeleton actually serves, with each map voting once, the chosen rule writes 3.9 lines per block, of which 1.0 is wrong on average and 2.2 more are missing.

**Q7. On by default.** Settled 2026-10-23. On, with the Settings > Code checkbox to turn it off.

## Sec.13 Line and block prediction

Added 2026-10-23 and approved the same day. BUILT 2026-10-23, see Sec.10 E and Sec.13.8. Code editor only. The Breakdown and the Land Placement fields take one argument at a time, so they have no rest of a line to predict.

Two features, both drawn as Monaco ghost text (grey text after the caret that Tab accepts).

1. **Line prediction.** Once the first word of a command or attribute line is typed, the rest of the line, copied literally from the closest earlier line of the same kind in the script.
2. **Block template.** Once a block command's line is complete, its whole block, copied from the script's last block of the same command, with every value a placeholder the person can keep with Tab or type over.

Both copy from the script being edited. Other maps are a source in one case only, a block command the script has not used yet (Sec.13.4.1). Sec.13.1 shows why they are not a source anywhere else.

### Sec.13.1 Measurements

A replay of 57 maps from `test-maps/` and `test-maps/local/`, leaving out the app's own fixtures (`sample.rms`, `test*.rms`, `new_map.rms`, `tour.rms`, `gold.rms`, `golden_hill.rms`, `ALP_test.rms`). Each map was read top to bottom, and at each line or block the sources were asked what they would show using only the text above it. Lines are the parser's command and attribute statements (a statement on a shared line counts on its own), compared as their tokens joined by single spaces, so spacing and comments never count against a prediction. 115,245 statements have something after their first word, and 16,680 blocks hold 6.2 items on average. One map (Arena.rms, 29,367 statements) is a quarter of the pooled total, so the median map is given beside it.

| Line, after the first word                                           | Offered | Exactly right | Median map | Right apart from the numbers |
| -------------------------------------------------------------------- | ------- | ------------- | ---------- | ---------------------------- |
| Closest earlier line, same first word in the same command or section | 97.6%   | 60.5%         | 47.3%      | 85.5%                        |
| Most common form in other maps (at least two maps)                   | 96.5%   | 15.8%         | 15.6%      | 51.0%                        |
| Script first, other maps when the script has none                    | 99.9%   | 61.0%         | 49.6%      | 87.1%                        |

Of the offered predictions from the script, 67.3% have the first word right.

| Line, after more is typed                                            | Lines  | Exactly right |
| -------------------------------------------------------------------- | ------ | ------------- |
| First word and one argument typed (lines with two or more arguments) | 19,946 | 21.5%         |
| First word and two arguments typed (lines with three or more)        | 8,290  | 78.6%         |

The second row is low because two argument lines are mostly coordinates (`land_position 85 68` then `land_position 85 69`). Stepping each number by the difference between the last two such lines was tried. It moved the exact rate from 62.0% to 64.6% and fired on a quarter of lines, too little for a rule a person would have to predict, so it is not used.

| Block, after its command line                        | Offered | Exactly right | Same attribute names in the same order |
| ---------------------------------------------------- | ------- | ------------- | -------------------------------------- |
| Last block above with the same command and arguments | 88.7%   | 14.6%         | 78.6%                                  |
| Last block above with the same command name          | 98.5%   | 15.1%         | 80.6%                                  |
| Most common block in other maps (at least two maps)  | 72.4%   | 1.8%          | 2.7%                                   |

Where the names match in order (80.6% of blocks), 84.4% of the 126,573 values are already right. The median block needs one value retyped, the mean 1.5, and 18.8% need none. 8.8% of blocks hold an `if` or `start_random`. A copied block is exactly right too seldom to insert as is, and its shape is right often enough to insert as a template, which is the reason for Sec.13.4's placeholders. Other maps' whole blocks are one shared template that two maps happened to copy, which is why that row is near zero.

**The first block of its kind.** 257 blocks are the first of their command in their map, about four per map, and for them the script has nothing to copy. For these the skeleton was measured leaving the block's own map out, with each other map voting once (its vote for an attribute is the share of its own matching blocks that use it), so a heavily copied map such as Arena.rms (3,967 blocks) cannot decide alone. Keyed by command and arguments when at least three maps have that head, else by command name.

| Attributes kept, by share of maps using them | Lines written | Right | To delete | To add | Exact set | Pairs in the right order |
| -------------------------------------------- | ------------- | ----- | --------- | ------ | --------- | ------------------------ |
| At least 30%                                 | 7.4           | 4.2   | 3.2       | 0.9    | 12.0%     | 88.0%                    |
| At least 50% (chosen)                        | 3.9           | 2.9   | 1.0       | 2.2    | 16.3%     | 90.8%                    |
| At least 70%                                 | 2.9           | 2.5   | 0.5       | 2.6    | 15.5%     | 90.2%                    |

The person's block has 5.1 attributes on average. Keyed by command name alone, the 50% row writes 3.4 lines, 2.5 right. Counting every block once instead of every map once, the 50% row's lines are 69% right rather than 74%. For the attributes it gets right, the most common value in other maps is the person's value 25% of the time. Sec.8's numeric default is right 17% of the time where it applies, against 31% for the most common value on the same attributes.

The probes were throwaway scripts outside the repo. Slice E's replay gate (Sec.13.7) re-derives the line and block figures for the tracked maps, so nothing above rests on a file that no longer exists.

### Sec.13.2 Where the code lives

- `src/editor/linePrediction.ts` and `src/editor/blockTemplate.ts`, pure, with no Monaco import, for the reason `constOffers.ts` gives (Vitest cannot load `monaco-editor`).
- `src/editor/aoe2RmsPrediction.ts`, one `registerInlineCompletionsProvider` for `aoe2-rms`, registered once in `main.tsx` beside the completion provider.
- A statement index built once per parse, keyed by first word and home (the enclosing command's name for an attribute, the section for a command), the same caching pattern as `getScriptNameIndex`. The caret's own line comes from `caretContext`, which already lexes it.

### Sec.13.3 Line prediction

**When it shows.** All of these hold.

- The caret is at the end of the line, with only whitespace after it.
- `caretContext` puts the caret in an argument of a command or attribute, after its first word and a space. Never a directive (a `#const` name is new by definition), never an `if` or `elseif` condition, never `percent_chance`, never inside a comment.
- An earlier statement exists above the caret with the same first word and the same home, whose arguments start with what is already typed and continue past it. What is typed counts as whole tokens plus a last token that may be partial, which must be the start of the candidate's next token.
- The setting is on (Sec.13.5).

**What it shows.** The rest of the closest such statement above the caret, its tokens joined by single spaces. A trailing comment on the source line is not copied.

**Keys.** Tab accepts all of it. Ctrl+Right Arrow accepts one word, Monaco's own accept next word action, which suits the 67% of predictions whose first word is right. Typing on replaces it, and the ghost text either narrows to what still matches or goes away. Escape dismisses it.

**With the word list.** The prediction is at its best right after the first word's space, where nothing is typed and the word list is closed, so Tab goes to the ghost text. Once a character is typed in an argument slot the word list opens, and while it is open Tab belongs to the list as Q1 settled. Spike S1 checks that Monaco 0.53 gives Tab to the list. If it does not, the provider returns nothing while the list is open.

**Indenting.** The ghost text never shows in a line's leading whitespace, since it needs the first word typed, so Tab still indents a blank line.

### Sec.13.4 Block template

**When it shows.** All of these hold.

- The caret is at the end of a command line whose command is a block command in `language.json` (`kind: "block"`, 12 commands), with its arguments typed.
- No `{` follows on that line or on the next line that is not blank.
- The script has a block of the same command above the caret. The last one with the same command and arguments is used, otherwise the last one with the same name. With none, the skeleton from other maps is used (Sec.13.4.1, Q6).
- The setting is on.

**What it shows.** The source block rebuilt as a Monaco snippet.

- Fixed text is the braces, every attribute name, and every `if`, `elseif`, `else`, `endif`, `start_random`, `percent_chance` and `end_random` keyword with the conditions after `if` and `elseif`.
- Every argument of every attribute, and every `percent_chance` number, is a placeholder whose starting value is the source block's own value. Each gets its own tab stop in reading order. None mirror each other, since two equal values in one block are not the same value.
- The final tab stop is after the closing brace.
- Comments are left out, since a comment describes the block it was written for.
- The layout follows the source block. A block written on one line comes back on one line. Otherwise `{` goes where the source put it, each item on its own line, one indent unit (Settings > Code) deeper than the command, and a branch's items one more. The command line's own indent is added to every line (spike S2).
- A `$`, `}` or backslash inside a value is escaped as snippet syntax requires. Build artefacts carry `$` words (CLAUDE.md, BUG-002), and an unescaped one would turn into a tab stop.

An example. With this block above the caret,

```
create_object GOLD {
  number_of_objects 7
  set_gaia_object_only
  min_distance_to_players 13   /* far from TCs */
  max_distance_to_players 15
}
```

typing `create_object GOLD` on a new line shows the same block in grey without the comment. Tab inserts it with `7` selected. Typing `5` replaces it, Tab moves to `13` and selects it, Tab keeps it and moves to `15`, and one more Tab leaves the caret after `}`. Shift+Tab goes back a value. Escape leaves the template with every value as it stands.

**With the word list.** Typing a value can open the word list, and Tab then accepts the highlighted name (Q1). A second Tab moves to the next value. Spike S3 checks that accepting a word keeps the template's tab stops alive.

**Undo.** One Ctrl+Z removes the whole inserted block, values typed afterwards being their own undo steps as usual.

**After a line prediction.** Accepting a line prediction on a block command leaves the caret at the end of a complete command line, so the block template shows next by the rule above. Two Tabs write a whole command.

### Sec.13.4.1 Skeleton from other maps

Used when the script has no block of the same command name above the caret (Q6).

**Data.** `reference/data/block-skeletons.json`, with its schema in `reference/schemas/`. One entry per key. A key is a command name, or a command with its arguments such as `create_object GOLD`. Each entry lists attribute names in order, each with a starting value, and records how many maps stand behind it.

**Generator.** `npm run generate:skeletons`, under its own Vitest config as `measure:checker` is. It parses every map on the maintainer's disk with the real parser (tracked maps, untracked ones and `local/`, the app's own fixtures left out) and writes the file through Prettier. The output is committed, and the app never reads a map file for this. It is regenerated when the corpus grows, as `game-constants.json` is regenerated from an install.

**Rule.**

- Each map votes once per key. Its vote for an attribute is the share of its own blocks under that key that use it.
- An attribute is kept when its votes reach half the maps that have the key.
- A key needs at least three maps. A command with arguments uses its own entry when there is one, else its name's entry.
- Attributes are ordered by their mean position within those blocks, measured as a fraction of each block's length.
- An attribute's starting value is its most common argument text, each map's blocks weighted to one vote between them. An attribute with no arguments has no value.
- Only a block's direct attributes count. A skeleton never holds an `if` or `start_random`.

**What it shows.** The same snippet as a copied block, every value a placeholder. The `{` goes where most of the script's blocks above put it, on the command's own line when there are none, with one attribute per line one indent unit deeper.

**Why one vote per map.** A count is not a conclusion until its uses are independent (CLAUDE.md). Arena.rms alone holds 3,967 blocks, and shipped maps repeat no-op attributes through copied templates (`avoidance_distance`'s 320 uses were one template). One vote per map and the three map floor keep any single template from deciding. A skeleton is a suggestion the person edits, never a claim about what the game needs, so a line in it says only that other maps wrote it.

### Sec.13.5 Setting and colour

- One checkbox in Settings > Code, "Predict the rest of a line and whole blocks", HelpTip `settings.code.prediction` with its `ui-help.json` entry, stored beside `resolveFlash` in the app settings. Read on every request, so turning it off takes effect at once. On by default (Q7).
- Ghost text uses Monaco's `editorGhostText.foreground`, set in `monacoTheme.ts` from the theme's `textMuted` token, so a custom theme and a dark theme each get a readable grey. Monaco's default is a fixed grey that does not follow the theme.

### Sec.13.6 Spikes before building

Each one is a Monaco behaviour this section relies on and nobody has run. Each takes a few minutes in `npm run tauri dev` with a stub provider, and a different answer changes a rule above.

- **S1.** With ghost text showing and the word list open, Tab accepts the list's row, not the ghost text. Ctrl+Right Arrow is bound to accepting one word of the ghost text in the standalone editor, as it is in VS Code (Sec.13.3).
- **S2.** A multi-line snippet returned as `insertText: { snippet }` previews as grey text across lines with its default values, accepting it starts the snippet session with the first value selected, and the command line's own indent is added to every inserted line (Sec.13.4). The typings in `editor.api.d.ts` promise the first two, which is a claim about intent, not an observation.
- **S3.** Inside the snippet session, accepting a word from the list with Tab and then pressing Tab again moves to the next value rather than ending the session (Sec.13.4).

**Results, 2026-10-23.** Run in the browser pane against Monaco 0.53 from the app's own Vite server, with a stub completion provider and a stub inline provider on a throwaway language, driven by real key presses. All three held, so no rule above changed.

- S1 held. With the list open and ghost text showing, Tab took the list's row and closed the list, and the ghost text stayed. Ctrl+Right took one word of the ghost text (`7`, then the space, then `13`), and Tab took the rest.
- S2 held. The snippet previewed as grey text over several lines with its starting values. Tab inserted it with `7` selected, each `\t` became the editor's indent unit, and the command line's own indent was added to every line. One difference from the preview: the grey lines are drawn without the command's indent, which the inserted text then has.
- S3 held. Typing `GR` over `7` opened the list, Tab took GRASS, and the next Tab selected the next value.

One thing the spikes showed that the rules above did not say. At the end of a block command's line the last word was just typed, so the word list is usually open there. The first Tab takes the list's row (normally the same word) and the second inserts the block.

### Sec.13.7 Tests

- Unit tests for both pure modules, one per rule in Sec.13.3 and Sec.13.4, including the partial last token, the home key (an attribute of `create_land` never predicts from one of `create_terrain`), the one line block, a branch inside a block, and a `$` value.
- A replay gate over the tracked maps in `test-maps/` (not `local/`, which CI does not have) that runs the real `linePrediction.ts` and `blockTemplate.ts` the way Sec.13.1 ran the probe. It pins the exact rate for lines and the names-in-order rate for blocks at the figures measured on the day it is written, within one point. A gate written from the probe's code rather than the shipped code would only test the probe.
- A mutation test, replacing the home key with the first word alone. The replay gate cannot see that mutant, since Sec.13.1 measured 60.5% with the home key and 60.6% without it, so the unit test that names the case is the one that must turn red.
- Keystroke cost on Arena.rms at its last line, against slice B's 6 ms for `caretContext`.
- For the skeleton, unit tests of the fallback from head to name, of a head entry needing three maps, and that a script block of the same name always wins over a skeleton. `validate:reference` holds `block-skeletons.json` to its schema, and to every command and attribute name in it existing in `language.json`.

### Sec.13.8 As built

Measured 2026-10-23 through the shipped modules (`predictionMaps.ts`'s replay), on the same fixture exclusions as Sec.13.1.

| Population                  | Line statements | Offered | Exactly right | Median map | Blocks | Offered | Same names in order |
| --------------------------- | --------------- | ------- | ------------- | ---------- | ------ | ------- | ------------------- |
| All 57 maps on this disk    | 114,410         | 96.2%   | 61.4%         | 47.3%      | 16,680 | 94.5%   | 77.4%               |
| The 12 tracked maps (gated) | 35,146          | 98.0%   | 56.6%         | 60.3%      | 4,561  | 98.6%   | 73.5%               |

The whole-disk row sits within a point of Sec.13.1's probe on lines and on the median map, over the same 16,680 blocks. Two choices made while building account for the rest, both readings of the rules above rather than departures.

- A statement only predicts from statements on lines above the caret's line, never from earlier ones on the same line (Sec.13.3's "above the caret"). Machine-written maps that chain several blocks on one line (TL Cape of Storms writes 2,659 statements on a few dozen lines) lose most of their offers to this, which is most of the 1.4 point gap in lines offered.
- A block template needs its command to be the line's first word (Sec.13.4's "a command line"), which those same chained lines are not. Blocks offered fall from 98.5% to 94.5% on that, and same names in order is counted over every block, offered or not, and through the inserted text parsed back, branches included, so it reads 77.4% against Sec.13.1's 80.6%. The probe is gone, so how it counted branch names cannot be checked.

The gate pins the tracked row's 56.6% and 73.5% within one point. It takes about 32 s, most of it `caretContext` on AK_Vanguard's 9,138 statements.

**Keystroke cost** on Arena.rms at its last line, the parse covering every line above. `caretContext` alone 4.9 ms median, with line prediction 5.2 ms, with a block template 7.7 ms. The statement index is built once per new parse, 36 to 46 ms warm on Arena.rms, the largest map, and far less on any other. Tracking it per parse rather than per keystroke is what keeps the per-keystroke figure at a few tenths of a millisecond.

**Skeletons.** 169 keys from 57 maps. Starting values are whatever other maps most often wrote, so many are a map's own `#const` names (`BASE_TERRAIN`, `CENTER_FOREST_TERRAIN`) that the person's script may not define. That was the measured trade in Q6, a line or so to fix per block, and every value is a tab stop to type over. A key whose kept attributes come to none is not written, so the template falls back to the command name's entry, or shows nothing.
