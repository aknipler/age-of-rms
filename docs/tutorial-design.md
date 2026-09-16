# Tutorial & Onboarding Design (Rev 1)

Spec for the first-run welcome pane and the guided tutorials in `src/tutorial/`.
Written to be implemented in one pass without further design decisions — where
something is genuinely open it is listed in Sec.14 rather than left implicit.

**Read first:** `docs/breakdown-design.md` Sec.3.1–3.2 (section tabs, Add
Command), `docs/preview-design.md` Sec.5 (Current vs Final), and
`src/components/HelpTip.tsx` (the popup positioning this reuses). `CLAUDE.md`'s
rule — "All new interactive UI elements get wrapped in HelpTip as they're built"
— applies to everything this spec adds.

## 0. Goals and non-goals

Three deliverables, one engine:

1. **Welcome pane** on first launch. Routes the user into a tutorial, or out of one.
2. **Tutorial A — "New to RMS"**: builds a small map called Golden Hill from empty,
   step by step, in the Breakdown editor. The user types and clicks; the tutorial
   watches the parse and confirms.
3. **Tutorial B — "New to Age of RMS"**: a tour of the app for someone who
   already writes RMS — preview pane, reference table, status bar, generation
   settings, Advanced Tools.

Plus the standing requirement that makes this worth building as an engine rather
than two hardcoded flows: **feature announcements**. When a release adds a
feature we want a "What's new in 0.4" popup plus spotlights pointing at the new
controls. That is the same step engine with a different trigger (Sec.11), so
adding a future feature tour should mean adding a content file and nothing else.

**Non-goals for rev 1.** No auto-apply ("do it for me") buttons — the tutorial
never edits the user's document (Sec.2.3). No branching flows. No video, audio or
animation beyond the spotlight's own fade. No progress persistence _inside_ a run
(quitting mid-tutorial restarts it; only completion is remembered).

**Reversed post-rev-1 (2026-09-01):** a step can now declare `autoFill` — an
"Add them for me" button that DOES edit the user's document. Sec.14 open
question 2 called this "worth revisiting after watching someone use this over
their shoulder"; Ash's own use of the tutorial found the one step (§9.1 row 12,
"Everyone else's resources") where the exclusion cost more than it protected —
four near-identical hand-typed `create_object` blocks that teach nothing new
the third and fourth time. Scoped to that one step, not a blanket auto-apply
for every check step: see Sec.5.1's `autoFill` field and the build log's
2026-09-01 entry for the mechanism.

## 1. Vocabulary

| Term          | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| **Tutorial**  | A named, ordered list of steps with an id, title and kind. `TutorialDefinition`.                     |
| **Step**      | One callout: some copy, an optional anchor to spotlight, and a rule for when it is satisfied.        |
| **Anchor**    | A DOM element a step points at, addressed by a stable string, not a CSS class (Sec.4).               |
| **Spotlight** | The dimmed overlay + ring drawn around an anchor.                                                    |
| **Callout**   | The card holding the step's copy, its Next/Back/Exit controls and the step counter.                  |
| **Tour**      | A tutorial whose kind is `"feature"` — triggered by a version bump rather than by the user (Sec.11). |

## 2. Decisions locked before implementation

**2.1 One engine, three kinds of content.** `TutorialDefinition.kind` is
`"rms" | "app" | "feature"`. Kind affects only where the tutorial is offered
(welcome pane, Help menu, version trigger), never how it runs.

**2.2 The spotlight is non-modal.** The scrim is `pointer-events: none`; only the
callout card takes pointer events. The user can click anything at any time,
including things the tutorial is not pointing at. A modal overlay that forces the
"correct" click is how tutorials trap people, and this one asks the user to do
real work in a real editor — they must be able to scroll, undo, and change their
mind. The spotlight's job is to say _look here_, not to enforce it.

**2.3 The tutorial never writes to the document.** Every step in Tutorial A is
satisfied by the user's own edit, detected by re-reading the parse. This is the
pedagogical point (they must find `+ Add command` themselves once), and it keeps
the engine free of the patch engine — no `EditIntent`, no `applyTextEdit`,
nothing that can corrupt a script. The cost is that a step can be gotten wrong;
it is never enforced, only left unconfirmed, and Next is always available.

**2.4 Steps are code, not data.** Completion rules are predicates over the AST, so
the content lives in TypeScript modules under `src/tutorial/content/`, not in
`reference/data/`. `ui-help.json` stays what it is: one-line hover text for
chrome. A tutorial step is a different thing with a different lifetime.

**2.5 Anchors are derived from HelpTip ids where they exist.** The app already has
~85 stable, semantically-named anchor points — every `HelpTip id`. One line added
to `HelpTip.tsx` (Sec.4.1) turns all of them into tutorial targets, and it means
the CLAUDE.md rule that every new control gets a HelpTip is simultaneously the
rule that every new control is tutorial-addressable. Only _containers_ (the
section tab bar, the preview pane, the status bar's resource row) need a bespoke
attribute, and there are six of them (Sec.4.2).

**2.6 The tutorial may navigate, but only view state.** Switching the top tab to
Code, or the section tab to Objects, is not an edit and losing it costs the user
nothing — so a step may do it, via the navigator registry in Sec.5.3. Anything
that touches the document, the file system or persisted settings is out.

## 3. File map

New files, all under `src/tutorial/`:

```
src/tutorial/
  tutorialConstants.ts     store file + keys + guards, in helpConstants.ts's shape
  types.ts                 TutorialDefinition, TutorialStep, StepContext, Anchor
  TutorialContext.tsx      run state, persistence, navigator registry, provider
  TutorialOverlay.tsx      spotlight + callout, rendered via portal
  TutorialOverlay.module.css
  WelcomeDialog.tsx        first-run pane
  WelcomeDialog.module.css
  welcomePhrases.ts        the randomised "let me loose" strings
  scriptChecks.ts          AST predicates the steps are written against
  registry.ts              all TutorialDefinitions, keyed by id
  content/
    rmsBasics.ts           Tutorial A
    appTour.ts             Tutorial B
    whatsNew.ts            feature tours, one exported const per release
  __tests__/
    scriptChecks.test.ts
    registry.test.ts
    rmsBasics.test.ts
    TutorialContext.test.tsx
    fixtures/goldenHill.rms
```

Touched files (small, surgical — see Sec.4 and Sec.6 for the exact change):

- `src/components/HelpTip.tsx` — emit `data-help-id` on the wrapper span.
- `src/breakdown/SectionTabs.tsx` — container anchor on the tab bar.
- `src/breakdown/SectionView.tsx` — container anchor on the card list.
- `src/components/preview/PreviewPane.tsx` — container anchor on the pane root.
- `src/components/sidepanel/ReferenceTable.tsx` — container anchor on the section root.
- `src/components/StatusBar.tsx` — container anchor on `.scrollArea`.
- `src/tools/ToolsPane.tsx` — container anchor on the pane root.
- `src/components/TitleBar.tsx` — three Help-menu items (Sec.6).
- `src/App.tsx` — provider + overlay + welcome dialog mounting, navigator registration.
- `src/breakdown/BreakdownPane.tsx` — register the section-tab navigator.
- `reference/data/ui-help.json` — help text for the new Help-menu items and the
  callout controls.

## 4. The anchor system

### 4.1 HelpTip-derived anchors

In `HelpTip.tsx`, the wrapper span gains one attribute:

```tsx
<span ref={anchorRef} className={styles.wrapper} data-help-id={id} …>
```

That is the entire change. It is inert for every existing user of HelpTip (no
styling hooks off it, no behaviour reads it), and it makes `[data-help-id="…"]` a
stable selector for every wrapped control in the app.

One caveat to respect: some HelpTips wrap a _label_ rather than the control
(`statusBar.total` wraps the word "Total", not the bucket — see the comment in
`StatusBar.tsx`). Where a step wants the wider region, use a container anchor
rather than moving the HelpTip.

### 4.2 Container anchors

For regions with no single wrapped control, add `data-tutorial-anchor="<id>"` to
the region's root element. Six in rev 1, plus `code.editor` added post-rev-1
(2026-09-01, alongside `extraAnchors` below):

| Anchor id               | Element                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `breakdown.sectionTabs` | `SectionTabs.tsx`, the `div[role="tablist"]`                                                                                                                          |
| `breakdown.cardList`    | `SectionView.tsx`, `div.view` (the Add-command button plus the card list — every step using this anchor asks the user to add a command, so the button stays in frame) |
| `sidePanel.preview`     | `PreviewPane.tsx`, `div.pane` (~line 246)                                                                                                                             |
| `sidePanel.reference`   | `ReferenceTable.tsx`, the outer `div.section` (~line 307)                                                                                                             |
| `statusBar.resources`   | `StatusBar.tsx`, `div.scrollArea`                                                                                                                                     |
| `tools.pane`            | `ToolsPane.tsx`, the pane root                                                                                                                                        |
| `code.editor`           | `CodePane.tsx`, `div.editorFrame` (the Monaco frame, not the whole pane — that also carries the side panel)                                                           |
| `breakdown.main`        | `BreakdownPane.tsx`, `div.main` (the tabs + card list column — deliberately excludes `MapSidePanel`, so a step spotlighting this doesn't also undim the preview)      |

#### 4.2.1 Multiple regions per step (`extraAnchors`)

A step can name more than one region at once: `anchor` still positions the
callout, but `extraAnchors?: Anchor[]` (any mix of `help`/`region`) adds more
cutouts to the same spotlight. Added post-rev-1 because several steps pointed
at only one of two things the user actually needed to see at once — e.g. "add
random_placement" highlighted the Player Setup tab but not the Add command
button it was telling the user to press. The overlay resolves every anchor
each frame and dims everything _except_ their union; see Sec.5.2 for why that
needs an SVG mask rather than more band-divs once there is more than one rect.

A step can also carry `calloutNudge?: { x?; y? }` (added to the otherwise-
computed position, clamped to the same viewport margins as everything else)
and `calloutMaxWidthPx?: number` (overrides the callout's default 320px). Both
exist for the one case the beside/below/above algorithm can't see on its own:
a step whose anchor is fine, but whose default callout position lands on top
of something a DIFFERENT control on the same step opens (a dropdown), which
isn't the anchor being pointed at and so never enters the placement math.

**A nudge only fixes the CALLOUT's position — a dropdown that opens outside
the spotlight hole needs its own z-index above the dim layer too, or it
still reads as dimmed even once nothing overlaps it (post-rev-1, found on
step 1's File dropdown).** The dim SVG and ring sit at `z-index: 900`/`901`
(Sec.5.2); any popup a step can cause to open — `TitleBar.module.css`'s
`.dropdown`, `CommandPicker.module.css`'s `.panel` — needs a higher one, or
the translucent dim rect paints over it regardless of the spotlight hole's
shape (the hole only ever covers the anchor ITSELF — the File button, the
Add-command button — never a popup that doesn't exist until the anchor is
clicked). Both are now above the dim layer (`910`/`920`); a future dropdown
introduced into a step's reachable UI needs the same treatment, checked
against the full inventory in the CSS comment at each site rather than
picked ad hoc.

### 4.3 Resolution

```ts
export type Anchor =
  | { kind: "help"; id: string } // [data-help-id="id"]
  | { kind: "region"; id: string } // [data-tutorial-anchor="id"]
  | { kind: "selector"; css: string }; // escape hatch, avoid
```

`resolveAnchor(anchor): HTMLElement | null` does one `document.querySelector`.

A step whose anchor resolves to `null` is **not** an error: the callout renders
centred with no spotlight, and the copy still reads correctly (this is what
happens when the anchor lives on a tab the user has navigated away from). The
overlay retries resolution on every frame it is already measuring on (Sec.5.2),
so an anchor that appears later simply lights up when it appears.

## 5. The engine

### 5.1 Types (`src/tutorial/types.ts`)

```ts
export interface StepContext {
  parseResult: ParseResult | null;
  source: string;
  activeTab: TabId;
  activeSectionId: string | null;
  hasFile: boolean;
}

export type StepCompletion =
  | { kind: "manual" } // Next only
  | { kind: "check"; test: (ctx: StepContext) => boolean };

export interface TutorialStep {
  id: string; // stable; used by tests
  title: string; // callout heading, <= 6 words
  body: string[]; // one string per paragraph; plain text, no markdown
  anchor?: Anchor;
  /** Sec.4.2.1 — more regions to spotlight alongside `anchor`; only `anchor` positions the callout. */
  extraAnchors?: Anchor[];
  /** Sec.4.2.1 — nudges the computed callout position, for a step whose default position covers a dropdown the anchor doesn't account for. */
  calloutNudge?: { x?: number; y?: number };
  /** Sec.4.2.1 — overrides the callout's default max-width (320px) for one step. */
  calloutMaxWidthPx?: number;
  /** View state this step needs. Applied once when the step becomes active. */
  navigate?: { tab?: TabId; section?: string };
  completion: StepCompletion;
  /**
   * An extra button beside Next that performs the step FOR the user (e.g.
   * "Add them for me" on a step that is otherwise four hand-typed commands).
   * `buildEdit` runs against the live StepContext and returns the one
   * TextEdit to push, or null when the step isn't in a state the shortcut
   * can act on. Added post-rev-1 for the per-player-resources step.
   */
  autoFill?: {
    label: string;
    buildEdit: (
      ctx: StepContext,
    ) => { start: number; end: number; newText: string } | null;
  };
  /** Shown under the body while a `check` step is still unsatisfied. */
  hint?: string;
  /**
   * An extra button beside Next that advances the step, labelled for the reason
   * someone would want it. `Next` already advances an unsatisfied check step
   * (Sec.2.2), so this adds no capability — it names the choice, which is the
   * whole point. See Sec.5.5.
   */
  bypass?: { label: string };
}

export interface TutorialDefinition {
  id: string; // "rms-basics", "app-tour", "whats-new-0.4.0"
  kind: "rms" | "app" | "feature";
  title: string; // "Your first random map"
  blurb: string; // one line, shown on the welcome pane / Help menu
  steps: TutorialStep[];
  /** Feature tours only — the app version that introduces it (Sec.11). */
  version?: string;
}
```

### 5.2 Overlay

`TutorialOverlay` renders through a portal into `document.body`, same as
`HelpTip`'s popup and for the same two reasons that file records (ancestor
`overflow` clipping, and transformed ancestors becoming the containing block for
`position: fixed`). Reuse its placement logic rather than reinventing it.

Structure:

- A `position: fixed` SVG covering the viewport, `pointer-events: none`, with a
  `<mask>` holding one white full-viewport rect plus one black rect per
  spotlighted region (Sec.4.2.1), and a single dim-coloured rect painted
  through that mask. Rev 1 shipped this as four plain `<div>`s per anchor
  (top/bottom/left/right bands covering everything but the rect) rather than
  an SVG mask, reasoned as avoiding "a mask-support question" — that holds for
  exactly one rect. It stops working the moment a step spotlights two disjoint
  regions: two independent four-band systems double-dim everything outside
  both rects (two stacked `rgba` layers), and a pixel inside spotlight A is
  still covered by spotlight B's "everything but B" bands. Only one dim layer
  with N holes composes correctly for N ≥ 1, so the SVG mask replaced the
  bands post-rev-1 rather than growing a special case for N = 1 vs N > 1.
- A 2px ring div per spotlighted region, inset to its rect, `border-radius`
  4px, `pointer-events: none`.
- The callout card, `pointer-events: auto`, positioned beside the anchor with the
  same prefer-below / flip-above / pin-inside-viewport algorithm `HelpTip.place()`
  uses. Centred in the viewport when there is no anchor.

Measurement: `useLayoutEffect` on step change, plus `resize` and capture-phase
`scroll` listeners, exactly as `HelpTip` does. Additionally poll with
`requestAnimationFrame` while a `check` step is pending, because the anchor can
move for reasons neither event fires on (a card list growing as the user adds
commands). Cancel the rAF loop when the step is manual or the tutorial exits.

**The mount-effect's dependency list also includes `activeTab` (post-rev-1),
purely to re-trigger `place()`, not because `place()` reads it.** A step's
`navigate.tab` is applied by `TutorialContext`'s own `useEffect` (a passive
effect, not layout), which runs AFTER this component's placement layout
effect in the SAME commit that makes the step active. For a step whose
anchor/`extraAnchors` live in the tab being switched TO — "This is what it
really is" pointing at `code.editor`, which doesn't exist until `CodePane`
mounts — the very first `place()` call finds nothing, because the tab switch
hasn't happened yet. A `check` step's rAF loop papers over this by re-measuring
every frame; a `manual` step has no such loop, so without this dependency its
spotlight for that region would simply never resolve. Once `navigate.tab`
actually flips `activeTab` a render later, the effect re-runs against the
now-mounted DOM.

Callout contents, top to bottom: step counter (`4 / 18` — Tutorial A is eighteen steps, 0 through 17), title, body paragraphs,
hint (only while an unsatisfied `check` step is active), then a row of
`Back` · `Next` · the step's `bypass` button when it has one · `Exit tutorial`. `Back` is disabled on step 1. `Next` is always
enabled (Sec.2.2/2.3). `Exit tutorial` ends the run without marking it complete.
`Escape` exits. Every one of these controls is wrapped in `HelpTip`, per CLAUDE.md.

A `check` step that becomes satisfied _while the user is on it_ advances
automatically, after a ~1.1s pause (`AUTO_ADVANCE_DELAY_MS`; raised from the
rev-1 ~600ms post-rev-1 — 600ms read as too quick to actually register the
tick before the callout moved on) showing a tick beside the title — instant
advance reads as the callout having been dismissed by accident. A step already
satisfied on arrival does not auto-advance at all; Sec.5.5 has the reasoning.

### 5.3 Context and navigator registry

`TutorialProvider` owns:

```ts
interface TutorialValue {
  active: { definition: TutorialDefinition; stepIndex: number } | null;
  start: (id: string) => void;
  next: () => void;
  back: () => void;
  exit: () => void; // abandons; does not mark complete
  welcomeOpen: boolean;
  dismissWelcome: () => void; // marks welcomeSeen, closes
  completed: ReadonlySet<string>;
  registerNavigator: (
    key: NavigatorKey,
    fn: (target: string) => void,
  ) => () => void;
}
type NavigatorKey = "appTab" | "breakdownSection";
```

The registry is a `useRef<Map<NavigatorKey, (t: string) => void>>` inside the
provider, not module scope: a module-level map survives React StrictMode's
double-mount in ways that are easy to get subtly wrong, and a ref in the provider
has exactly the lifetime we want. `useRegisterNavigator(key, fn)` registers in an
effect and unregisters on cleanup.

Two registrations in rev 1:

- `AppContent` registers `"appTab"` → `setActiveTab`.
- `BreakdownPane` registers `"breakdownSection"` → `setActiveTabId`.

`BreakdownPane` unmounts on a top-tab switch, so a step that needs both must set
`tab` and `section` together; the engine applies `tab` first, then `section` on
the next frame (`requestAnimationFrame`), so the pane exists by the time the
section navigator is called.

`start()` applies the first step's `navigate` immediately. Advancing past the last
step calls `complete()`, which adds the id to `completed` and persists it.

### 5.4 Where things mount (`App.tsx`)

```
HelpSettingsProvider
  AppSettingsProvider
    ThemeSettingsProvider
      HotkeySettingsProvider
        GenerationSettingsProvider
          PreviewViewProvider / PreviewViewportProvider / SidePanelLayoutProvider
            TutorialProvider          <- new, innermost of the providers
              AppContent
```

`TutorialProvider` goes innermost so a future step can read generation settings or
preview state, and because nothing above it needs to read tutorial state.

Inside `AppContent`, `<TutorialOverlay />` renders **inside**
`PreviewResultProvider` (a sibling of `<main>`), so `StepContext` can be built
from `useParsedDocumentContext()`. `<WelcomeDialog />` renders at the same level.
Both portal to `document.body`, so their position in the tree is about context
access only, not layout.

### 5.5 Getting past a step you do not want to do

Three related behaviours, specified together because they only make sense as a
set. The user this serves is not the beginner following along — it is the person
who ran the tutorial to re-read one thing they half-remember, and the person who
wants the walkthrough against the map they already have open.

**A check step only auto-advances on a transition.** The engine records whether
the step's `test` was true at the moment the step became active. If it was
already true on arrival, the step **renders normally with a tick beside its title
and waits for Next** — it does not advance itself. Without this rule, running
Tutorial A against a finished map would fire every check at once and rocket the
user through eighteen steps in a second, which is precisely the case someone
paging back through to find one step is in. Auto-advance is a reward for doing the
thing, so it should only fire for someone who just did it.

**A step may offer a named bypass.** `TutorialStep.bypass` renders one more button
beside Next, worded for the specific reason to press it. Step 0's is
**"Carry on with my own map"**. Mechanically it is Next; `Next` on an unsatisfied
step has always advanced (Sec.2.2). What it adds is that the user does not have to
guess whether the tutorial will let them past, or whether skipping breaks
something later. An unlabelled escape hatch that works is still an escape hatch
nobody trusts.

**Paging is a supported way to use this.** Next and Back are enabled on every
step, so the step counter doubles as an index: someone who remembers "there was a
bit about putting gold on a specific land" can page to step 11 and read it. That
costs nothing to support and is why neither control is ever gated on a check.
Rev 1 adds no step-list or jump-to menu; if paging turns out to be how people
actually use this, that is the feature to add next.

## 6. Help menu integration

`TitleBar.tsx` calls `useTutorial()` directly rather than taking new props — the
same reasoning App.tsx already records for `HelpTip`/`SettingsDialog` calling
`useHelpSettings()` themselves. The Help dropdown becomes:

```
DE RMS Guide
────────────
Tutorial: Your first random map
Tutorial: Tour of Age of RMS
What's new
```

Each new item is a `HelpTip`-wrapped `button` using `onMouseDown` (the existing
items' comment explains why: mousedown beats the menu's own `onBlur`). New
`ui-help.json` entries required: `titleBar.help.tutorialRms`,
`titleBar.help.tutorialApp`, `titleBar.help.whatsNew`.

"What's new" runs the newest feature tour in the registry; when none exists for
the current version it runs the most recent one that does, and when the registry
holds none at all the item is omitted rather than rendered dead.

Starting a tutorial from the menu always starts at step 1, whether or not it has
been completed before. This is the recovery path for someone who clicked out of a
tutorial by accident, so it must never be gated on `completed`.

## 7. Welcome pane

### 7.1 Trigger

On mount, `TutorialProvider` loads `settings.json` and reads
`tutorialWelcomeSeen`. Absent or `false` → `welcomeOpen` is true. Any of the four
dismissal paths sets it to `true` and persists. The store-load pattern is
`HelpSettingsContext.tsx`'s verbatim (`load(file, { autoSave: true, defaults: {} })`,
cancelled-flag guard).

**First launch only.** `tutorialWelcomeSeen` is never cleared, so the pane shows
once per profile and never again — not on an upgrade, not on a reinstall over the
same settings store. A version change is the _feature tour's_ trigger (Sec.11) and
that surface is deliberately a different, smaller thing: an existing user being
told what changed, not a new user being asked who they are. Nothing should ever
re-arm this flag; if a future release wants to re-introduce the app, that is a
feature tour.

**Launching by opening a `.rms` file does not suppress the pane.** The file
loads normally behind it — parse, preview, breakdown, all of it — and the user
dismisses the pane onto a fully loaded app. This is deliberate: it is still that
person's first run, and a one-time pane is cheap next to never learning the tool
exists. Nothing about the load path needs to know the pane is there.

### 7.2 Layout

Modal — this one _is_ modal (the overlay swallows clicks), because it has no
"correct thing to click" behind it. Reuses `dialog.module.css` for the overlay and
box, the same way `GenerationSettingsDialog` does.

```
                 Welcome to Age of RMS

  A free tool for writing Age of Empires II random map scripts.
  Where would you like to start?

  ┌───────────────────────────────────────────────────────┐
  │  I'm new to RMS mapmaking                             │
  │  Build a working map from scratch, step by step.      │
  └───────────────────────────────────────────────────────┘
  ┌───────────────────────────────────────────────────────┐
  │  I'm new to the Age of RMS tool                       │
  │  A quick tour of the preview, reference and tools.    │
  └───────────────────────────────────────────────────────┘

              <randomised skip phrase>

           You can reopen these any time from Help.
```

The two primary buttons show `TutorialDefinition.title` + `.blurb` read from the
registry — not hardcoded strings — so a retitled tutorial updates here for free.

### 7.3 The skip phrase

`welcomePhrases.ts` exports a frozen array; the dialog picks one with
`Math.random()` **once per mount** (`useState(() => pick())`, not a bare call in
the render body — a re-render must not reshuffle the button label under the
user's cursor).

```ts
export const WELCOME_SKIP_PHRASES = [
  "I know what I'm doing, let me loose!",
  "I'm a professional, 14!",
  "Close enough to Chrazini, I'm ready to rumble.",
  "I'm like the MadCADer, I make tutorials, I don't need them.",
  "I've hand-edited Arabia. Twice.",
  "My scripts have more start_random than a Nomad opening.",
  "I sleep with Zetnus's guide on my bedside table. No tutorial needed.",
  "How do you think I lost my hair? I'm clearly not a beginner.",
  "Straight to Post-Imperial thanks.",
] as const;
```

The first four are the ones supplied with the brief; the last five are new. The
list is deliberately a plain exported array so a contributor can add one in a
two-line PR — worth naming in `CONTRIBUTING.md` as an easy first contribution.

### 7.4 What each button does

| Button                 | Action                                         |
| ---------------------- | ---------------------------------------------- |
| New to RMS             | `dismissWelcome()`, then `start("rms-basics")` |
| New to the tool        | `dismissWelcome()`, then `start("app-tour")`   |
| Skip phrase            | `dismissWelcome()` only                        |
| Overlay click / Escape | `dismissWelcome()` only                        |

## 8. Predicate helpers (`scriptChecks.ts`)

Steps must never hand-roll AST walks. This module is the vocabulary they are
written in, and it is the piece with real unit tests.

`CommandNode.name` and `AttributeNode.name` are **token indices**, not strings —
resolve through `parseResult.tokens[node.name].text` (see `AttributeRow.tsx:58`).
Every helper takes `ParseResult | null` and returns `false` on `null`.

```ts
/** True when `section` contains a command called `command` (any nesting depth). */
hasCommand(parse, section: string, command: string): boolean

/** As above, but also requires the command's block to contain `attribute`. */
hasCommandWithAttribute(parse, section, command, attribute): boolean

/** As above, plus a predicate over the attribute's argument texts. */
hasCommandWithAttributeWhere(parse, section, command, attribute,
                             test: (args: string[]) => boolean): boolean

/** As `hasCommand`, plus a predicate over the COMMAND's own (positional)
 *  argument texts — for a standalone command like `max_number_of_cliffs`,
 *  not a nested attribute. Added post-rev-1, see the note below. */
hasCommandWhere(parse, section, command,
                test: (args: string[]) => boolean): boolean

/** How many commands named `command` live in `section`. */
countCommand(parse, section, command): number

/** True when any create_object in OBJECTS_GENERATION names `objectConstant`. */
hasObject(parse, objectConstant: string): boolean

/** hasObject, narrowed to placements whose block carries `attribute`. */
hasObjectWith(parse, objectConstant, attribute): boolean

/** hasObjectWith, plus a predicate over the attribute's argument texts.
 *  Added post-rev-1, see the note below. */
hasObjectWithAttributeWhere(parse, objectConstant, attribute,
                            test: (args: string[]) => boolean): boolean
```

**A presence-only check is not enough when the body names a specific value,
because `computeEdit` never leaves an argument blank.** `renderCommand` and
`renderAttribute` both go through `renderNamed`, which fills every argument
with `placeholderFor(def)` — `default ?? min ?? 0` for a numeric type, else
`"TODO"` — the instant a command or attribute is created, whether from
CommandPicker or the `+` on an absent attribute row. So `hasCommand` /
`hasCommandWithAttribute` / `hasObjectWith` (all presence-only) are satisfied
the moment the user clicks, before they have typed the real number — for a
`check` step with the auto-advance timer running (Sec.5.2), that could be
under a second to fix a value that defaulted to something else entirely.
Every step whose body names a value now checks that value with
`*Where`, not just that the slot exists; rows 3/4/6/7/8/10/11 of Sec.9.1 name
which placeholder each one was catching. A step is safe with a presence-only
check ONLY when the placeholder already equals the desired value — the two
`base_terrain` checks (rows 6 and 8) still use `*Where` for consistency but
would pass the instant the attribute is added either way, since its declared
default is `GRASS`, which is what both of those steps ask for. Which
attributes are "safe" this way has to be verified per attribute against
`language.json`, not assumed.

**This swept in three passes before it was actually complete, and the
pattern each miss shared is worth naming.** The first pass added `*Where`
checks for whichever attribute a step's check ALREADY named (e.g. row 3
checked only `circle_radius`, the last of the three attributes the body
lists — a "check the final one" shorthand rows 6 and 8 also used). The
second pass went back and checked every ATTRIBUTE the body names, not just
the last one (Ash: "doesn't check for land percent"). The third pass found
that a COMMAND's own positional argument (`create_elevation`'s height,
`create_terrain`'s terrain constant) is subject to the identical
`placeholderFor` treatment as any attribute — `renderCommand` calls the same
`renderNamed` — and had been checked by NEITHER of the first two passes,
because both were scoped to "attributes of the command" and a command's own
argument isn't one. Rows 6 and 8 now use `hasCommandWhere` (same helper
Cliffs' standalone commands use) for exactly this. The generalizable
takeaway: when auditing a step's completion check against its body text,
enumerate BOTH the command's own arguments AND its attributes' arguments —
checking "the attributes" is a proper subset of what a body can name a value
for.

Implementation notes for all of them:

- Walk `Item[]` recursively, descending into `IfNode.branches[].items`,
  `RandomNode.branches[].items` and `OrphanBlockNode`. A user who wraps their
  first `create_object` in an `if` has still done the step.
- Match sections by `SectionNode.name` (no angle brackets), aggregating across
  duplicate sections of the same name — `buildSectionTabs` already treats those as
  one tab, so the checks must agree with it.
- Argument text comes from `ArgNode`, read through the tokens the same way.
- The lexer does not fold case. Compare command, attribute and constant names
  case-insensitively.

## 9. Tutorial A — "Your first random map" (`content/rmsBasics.ts`)

id `rms-basics`, kind `rms`, title **"Your first random map"**, blurb
_"Build a small map called Golden Hill from scratch — about ten minutes."_

The map is **Golden Hill**: everyone starts on grass around the edge, there is
one raised dirt hill in the middle with the gold on it, and a road runs to it.
That is the whole idea, and the script below is deliberately the smallest thing
that expresses it. Every attribute in it is one the tutorial explains; nothing is
there because a real map would have it. A beginner who finishes this should be
able to read back every line they wrote.

The finished script is the acceptance target. Keep a copy at
`src/tutorial/__tests__/fixtures/goldenHill.rms` and assert that every step's
`check` returns true against it (Sec.13).

```rms
<PLAYER_SETUP>
random_placement

<LAND_GENERATION>
base_terrain GRASS

create_player_lands {
  terrain_type GRASS
  land_percent 20
  circle_radius 35
}

create_land {
  terrain_type DIRT
  land_percent 8
  base_elevation 3
  land_position 50 50
  land_id 10
}

<ELEVATION_GENERATION>
create_elevation 4 {
  base_terrain GRASS
  number_of_clumps 10
  number_of_tiles 600
}

<CLIFF_GENERATION>
min_number_of_cliffs 3
max_number_of_cliffs 6
min_length_of_cliff 4
max_length_of_cliff 8

<TERRAIN_GENERATION>
create_terrain FOREST {
  base_terrain GRASS
  land_percent 10
  number_of_clumps 12
  set_avoid_player_start_areas 8
}

<CONNECTION_GENERATION>
create_connect_all_players_land {
  replace_terrain GRASS ROAD
  replace_terrain DIRT ROAD
}

<OBJECTS_GENERATION>
create_object TOWN_CENTER {
  set_place_for_every_player
  min_distance_to_players 0
  max_distance_to_players 0
}

create_object VILLAGER {
  set_place_for_every_player
  number_of_objects 3
  min_distance_to_players 2
  max_distance_to_players 3
}

create_object SCOUT {
  set_place_for_every_player
  number_of_objects 1
  min_distance_to_players 5
  max_distance_to_players 7
}

create_object GOLD {
  number_of_objects 8
  number_of_groups 4
  place_on_specific_land_id 10
  set_gaia_object_only
}

create_object FORAGE_BUSH {
  number_of_objects 6
  set_tight_grouping
  set_place_for_every_player
  set_gaia_object_only
  min_distance_to_players 8
  max_distance_to_players 12
}

create_object GOLD {
  number_of_objects 5
  set_tight_grouping
  set_place_for_every_player
  set_gaia_object_only
  min_distance_to_players 12
  max_distance_to_players 16
}

create_object STONE {
  number_of_objects 4
  set_tight_grouping
  set_place_for_every_player
  set_gaia_object_only
  min_distance_to_players 12
  max_distance_to_players 16
}

create_object OAKTREE {
  number_of_objects 2
  set_place_for_every_player
  set_gaia_object_only
  min_distance_to_players 4
  max_distance_to_players 6
}
```

Every constant above was checked against `reference/data/game-constants.json` and
every attribute against `reference/data/language.json`. `GOLD`/`STONE` are the
mine objects (constIds 66 and 102), `SCOUT` is 448, `OAKTREE` is the straggler
tree. Do not substitute `GOLD_MINE`/`STONE_MINE`: they are aliases for the same
ids, and the short names are what the community writes.

**Do not add to this script.** It is missing plenty that a shipped map would want
— `border_fuzziness`, `clumping_factor`, `base_size`, `set_zone_by_team`,
`set_scale_by_size`, `terrain_cost`, `group_placement_radius`, spacing rules —
and every one of those
was cut on purpose. Each attribute added is another line the beginner did not ask
about and cannot explain afterwards. If a future revision wants to teach one of
them, it goes in a follow-on tutorial, not in this one.

**`base_size` is the one cut worth explaining**, because it looks arbitrary next
to `circle_radius`. Both are radii and a block carrying both invites the beginner
to conflate them, so the tutorial teaches exactly one — and `circle_radius` is the
one they will want on day one. It is the ring every player's land sits on, so it
sets how far apart players start, and it is the first number anyone reaches for
when a map plays too close or too spread out. `base_size` shapes an individual
land and `land_percent` is already doing enough of that job here.

**One expected wobble.** `base_elevation` needs an `<ELEVATION_GENERATION>`
section to exist, and step 4 adds it before step 6 creates that section, so the
problem count will show a diagnostic between those two steps. Step 4's copy says
so in one sentence — a beginner watching a warning appear because they followed
instructions needs to be told it is expected and will clear itself.

### 9.0 Step 0 — start from a new file, always

This tutorial always begins by asking for a fresh file, whether or not one is
already open. Two reasons. `BreakdownPane` renders a placeholder unless
`doc.filePath !== null`, so `File > New` alone is not enough — the file has to be
saved once before Breakdown will show anything. And every step after this one
says "add X", which reads as nonsense against someone's half-finished map. A new
file is the only starting state the rest of the copy is true for.

**Step 0 — "Start a new script"**. Anchor `help:titleBar.file`, tab `breakdown`.
`calloutNudge: { x: 300 }` (post-rev-1) — the File button sits at the far left
of the title bar, so the default beside-the-anchor placement landed the
callout on top of where the File dropdown opens directly below it. Unlike
CommandPicker's fixed `22rem` panel, `TitleBar.module.css`'s `.dropdown` is
content-driven (`min-width: 170px`, actual width set by "Save As…" plus its
hotkey hint) with no single CSS literal to derive an exact clearance from —
300px is a generous estimate, not a measured figure.

Body: "We'll build this from nothing, so start a fresh file. Open the File menu,
choose New, then Save As and call it something like `golden_hill`. Age of RMS
needs the file on disk before the Breakdown editor will show it. If you have a
map open already, it is safe to save it first — this will not touch it."

Completion: `check` → `ctx.hasFile && isEmptyScript(ctx.parseResult)`, where
`isEmptyScript` (in `scriptChecks.ts`) is true when the script has no sections and
no preamble items other than comments. A user who already had an empty saved file
open arrives with the step satisfied, so it renders ticked and waits for Next
(Sec.5.5) — correct, and deliberately not a step that vanishes before it is read.

Hint: "Waiting on a new, saved, empty script — File ▸ New, then File ▸ Save As."

Bypass: **"Carry on with my own map"**. Someone who wants the walkthrough against
a script they already have gets the whole tutorial from here, with copy that
occasionally does not match what they see — an acceptable trade for not being
made to abandon their work to read a tutorial.

### 9.1 Step table

Anchors are written `help:<id>` or `region:<id>`. "Section" in the Navigate column
is the Breakdown section tab id. Bodies below are précis — write the final copy in
the content file, in the same plain, unhurried voice as `docs/user-guide.md`.

| #   | Title                      | Anchor / Navigate                                                                                                                                                                                                                                                                                      | Body (précis)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Completion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The order of a map         | `region:breakdown.sectionTabs` · tab `breakdown`                                                                                                                                                                                                                                                       | A random map script runs top to bottom, and these seven numbered tabs are that order: 0. Header, 1. Player Setup, 2. Land, 3. Elevation, 4. Cliff, 5. Terrain, 6. Terrain Connection, 7. Objects. The game finishes each stage before starting the next, which is why you place land before you place gold on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | Random or direct placement | `help:breakdown.tab.playerSetup` + `help:breakdown.addCommand` + `region:breakdown.main` · section `PLAYER_SETUP` (nudged +368px right, widened to 380px — clears CommandPicker's dropdown, Sec.4.2.1)                                                                                                 | Two ways to decide where players start. `random_placement` lets the generator scatter the player lands for you — one line, and it is what most maps use. `direct_placement` hands you the controls instead: you position every land yourself with `land_position`, which is more power and a lot more work. We'll use random placement. Press `+ Add command` and pick `random_placement`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `hasCommand(PLAYER_SETUP, "random_placement")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | Give the players some land | `help:breakdown.addCommand` + `region:breakdown.main` · section `LAND_GENERATION` (nudged +368px right, widened to 380px — same CommandPicker clearance as step 2, Sec.4.2.1)                                                                                                                          | Add `create_player_lands`. It makes one land per player, all identical, which is the easy way to keep a map fair. Three attributes is enough: `terrain_type GRASS` for what the land is made of, `land_percent 20` for how much of the map the lands take between them, and `circle_radius 35` for how far out from the centre they sit. That last one is the number you will reach for most often — it is the ring everybody starts on, so it decides how far apart players are, and nudging it is the quickest way to change how a map plays.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `terrain_type` present as `GRASS` **and** `land_percent` present with value `20` **and** `circle_radius` present with value `35` — presence alone is satisfied by the placeholder `computeEdit` fills in the instant `+` is pressed (`circle_radius`'s first argument has no declared default, so `placeholderFor` falls back to its `min`, `-50`; `land_percent`'s declared default is `100`), which is not what the step asks for. `land_percent` was the one still missing a value check post-rev-1 ("doesn't check for land percent" — Ash's own report) — `circle_radius` alone had been checked since the very first value-check pass, on the reasoning that it's the LAST attribute the body lists (same "check the final one" shorthand row 6 and row 8 used before their own gaps were found); that shorthand is retired now, this row checks everything the body names |
| 4   | A hill in the middle       | same anchor/`extraAnchors`/nudge as row 3 (`help:breakdown.addCommand` + `region:breakdown.main`, +368px/380px) — literally the same element, so the callout lands in the same spot for both steps rather than jumping for what reads as a continuation of the same action · section `LAND_GENERATION` | Now add `create_land` — the same attributes, but one land instead of one per player. Make it `terrain_type DIRT` with `land_percent 8`, `land_position 50 50` to pin it to the map's centre, `base_elevation 3` to raise it, and `land_id 10` so we can find it again when we put the gold on it. Expect a warning to appear at the bottom of the window: raised land needs an elevation section, and we add that next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `terrain_type` present with value `DIRT` **and** `land_percent` present with value `8` **and** `land_position` present with values `50`/`50` **and** `base_elevation` present with value `3` **and** `land_id` present with value `10` — every attribute the body names, same placeholder-timing reasoning as row 3 (`terrain_type`'s default is `GRASS`, `land_percent`'s is `100`, `land_position`'s two arguments have no default and fall back to their shared `min`, `0`/`0`, `base_elevation`'s is `0`, `land_id` falls back to its `min`, `-10` — none matches). `land_percent`/`land_position` were the two still missing after the row's first value-check pass added `terrain_type`                                                                                                                                                                                    |
| 5   | Watch it appear            | `region:sidePanel.preview`                                                                                                                                                                                                                                                                             | The preview regenerates as you edit. Your player lands and the centre hill should be there now. It is an approximation rather than the game — the notes drawer lists everything it could not model exactly — but it is fast enough to try an idea and see it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | Hills                      | `help:breakdown.tab.elevationGeneration` + `region:breakdown.cardList` · section `ELEVATION_GENERATION`                                                                                                                                                                                                | `create_elevation` raises clumps of ground, and its argument is the height to build up to. Add `create_elevation 4` with `base_terrain GRASS` (only grass gets raised), `number_of_clumps 10` and `number_of_tiles 600`. The warning from the last step should clear as soon as this section exists. `create_elevation`'s own positional argument (the height) present with value `4` **and** `base_terrain` present as `GRASS` (its declared default, so this one was never actually at risk) **and** `number_of_clumps` present with value `10` **and** `number_of_tiles` present with value `600` — the height and both of the latter two default to something else the instant `+`/the command is created (`create_elevation`'s own argument declares `default: 0`; `number_of_clumps`'s declared default is `1`; `number_of_tiles` has no default and falls back to its `min`, `0`), so a presence-only check (rev 1 shipped bare `hasCommand`, then a mid-session revision shipped presence-only attribute checks, then a value-check pass that covered the three ATTRIBUTES but missed the command's own positional argument) is satisfied before the user retypes any of them. The height check uses `hasCommandWhere`, same as Cliffs (row 7) — it's the command's own argument, not a nested attribute                                                                                                                                                                              |
| 7   | Cliffs                     | `help:breakdown.tab.cliffGeneration` + `region:breakdown.cardList` · section `CLIFF_GENERATION`                                                                                                                                                                                                        | Cliffs are the odd section out: no block, just a handful of standalone settings. Add `min_number_of_cliffs 3` and `max_number_of_cliffs 6`, then `min_length_of_cliff 4` and `max_length_of_cliff 8`. Cliffs block movement, so a few go a long way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | All four settings present with their stated value — `min_number_of_cliffs` `3`, `max_number_of_cliffs` `6`, `min_length_of_cliff` `4`, `max_length_of_cliff` `8` (`hasCommandWhere`, reading each COMMAND's own argument — these are standalone commands, not attributes of anything). Every command argument gets the identical `default ?? min ?? 0` placeholder on creation; `min_number_of_cliffs`'s default (`3`) happens to already match, the other three (`8`, `5`, `9`) do not. The first post-rev-1 revision of this row only checked the first two ("only the commands are checked" — Ash's own words for the gap, since all four read as "attributes" of the section to someone not reading the AST)                                                                                                                                                                 |
| 8   | Trees                      | `help:breakdown.tab.terrainGeneration` + `region:breakdown.cardList` · section `TERRAIN_GENERATION`                                                                                                                                                                                                    | `create_terrain FOREST` paints forest over what is already there. `base_terrain GRASS` says what it may paint over, `land_percent 10` how much, `number_of_clumps 20` how broken up it is (10/20 = 0.5 land percent per group), and `set_avoid_player_start_areas 8` keeps it off everybody's town centre. `create_terrain`'s own positional argument (the terrain constant) present as `FOREST` **and** `base_terrain` present as `GRASS` (its default, never at risk) **and** `land_percent`/`number_of_clumps`/`set_avoid_player_start_areas` each present with their stated value (`10`/`20`/`8`) — none of the checked-by-value ones has a default that happens to match (`create_terrain`'s own argument has no default at all and falls back to the literal string `"TODO"` per `placeholderFor`'s non-numeric branch; `land_percent`'s default is `100`; `number_of_clumps`'s is `1`; `set_avoid_player_start_areas` has none and falls back to `0`), so presence alone (rev 1, then a mid-session revision that still checked only `base_terrain`, then one that checked all four ATTRIBUTE names but no values, then one that checked their values but missed the command's own positional argument) was satisfied by the wrong value every time. `FOREST` is checked with `hasCommandWhere`, same reasoning as Hills (row 6). The fixture's `number_of_clumps` was `12` through all of that — inconsistent with the copy's own "10/20 = 0.5" arithmetic — and is now `20` to match |
| 9   | A road to the hill         | `help:breakdown.tab.connectionGeneration` + `region:breakdown.cardList` · section `CONNECTION_GENERATION`                                                                                                                                                                                              | `create_connect_to_nonplayer_land` walks a path from every player to every neutral land, paving as it goes. Two lines of paving is all we need: `replace_terrain GRASS ROAD` and `replace_terrain DIRT ROAD`, so the road shows up on the grass and again where it climbs the dirt hill.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `hasCommand(CONNECTION_GENERATION, "create_connect_to_nonplayer_land")` **and** a `replace_terrain GRASS ROAD` attribute **and** a `replace_terrain DIRT ROAD` attribute — rev 1 named `create_connect_all_players_land` here (and checked only its presence, no attributes); that command connects player lands to EACH OTHER and only incidentally passes through neutral land "if the cost is favorable" (guide:1757-1760), so it cannot guarantee reaching the hill the step is titled after. `create_connect_to_nonplayer_land` is guide-documented as "Connect all player lands to all neutral lands" (guide:1858-1861) and is what the shipped `content/rmsBasics.ts` actually used — the design doc and the test fixture (`fixtures/goldenHill.rms`) had silently drifted from the implementation; both are now corrected to match it                                    |
| 10  | Starting units             | `help:breakdown.tab.objectsGeneration` + `region:breakdown.cardList` · section `OBJECTS_GENERATION`                                                                                                                                                                                                    | Three `create_object` commands: `TOWN_CENTER` (`max_distance_to_players 0`), `VILLAGER` with `number_of_objects 3` (min/max `7`/`9`), and `SCOUT` (min/max `7`/`9`). Each needs `set_place_for_every_player`, plus `min_distance_to_players` / `max_distance_to_players` to say how far from the centre of the player land they spawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `set_place_for_every_player` on all three (flags, no placeholder-timing risk) **plus** every value the body names: `TOWN_CENTER`'s `max_distance_to_players` `0`; `VILLAGER`'s `number_of_objects` `3`, `min_distance_to_players` `7`, `max_distance_to_players` `9`; `SCOUT`'s `min_distance_to_players` `7`, `max_distance_to_players` `9` (all via `hasObjectWithAttributeWhere`). Post-rev-1, the flags alone were checked ("the object attributes are also not checked" — Ash's own report); the fixture's `VILLAGER`/`SCOUT` distances (`2`/`3` and `5`/`7`) were stale against the body's own `7`/`9` and are now corrected to match                                                                                                                                                                                                                                      |
| 11  | Gold on the hill           | `region:breakdown.cardList` (nudged +368px right, widened to 380px, Sec.4.2.1 — same clearance as the LAND_GENERATION steps, this step's own Add command press opens the identical dropdown) · section `OBJECTS_GENERATION`                                                                            | This is the bit the map is named after. Add `create_object GOLD` with `number_of_objects 8`, `number_of_groups 4`, `set_gaia_object_only`, and `place_on_specific_land_id 10` — the id you gave the hill in step 4. There is more than one way to hit that hill: `place_on_specific_land_id` targets the land itself, `terrain_to_place_on DIRT` targets whatever terrain the hill is made of, and `find_closest_to_map_center` just works inward until it finds room. Which one is right depends on what you want to stay true every time the map regenerates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `place_on_specific_land_id` present on the `GOLD` placement **with value `10`**, **plus** `number_of_objects` `8`, `number_of_groups` `4` (all `hasObjectWithAttributeWhere`) and `set_gaia_object_only` present (a flag, `hasObjectWith`) — post-rev-1 only `place_on_specific_land_id` was checked, "some of the attributes are not checked" in Ash's own report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 12  | Everyone else's resources  | `region:breakdown.cardList` (nudged +368px right, widened to 380px, Sec.4.2.1 — same reason as row 11) · section `OBJECTS_GENERATION`                                                                                                                                                                  | Now the per-player gaia: `FORAGE_BUSH`, a `GOLD` group, `STONE`, and `OAKTREE` stragglers. All take `set_place_for_every_player`, so one command covers all eight players. All also need `set_gaia_object_only` — without it the objects belong to the player rather than to Gaia, and a player-owned gold mine is not a gold mine. An **"Add them for me"** button (`autoFill`, post-rev-1) builds all four blocks in one edit, for anyone who would rather see the result than hand-type a fourth near-identical command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `hasObjectWith("FORAGE_BUSH", "set_gaia_object_only")`, and the same for `STONE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 13  | This is what it really is  | `help:tabBar.code` + `region:code.editor` · tab `code`                                                                                                                                                                                                                                                 | Everything you just clicked is text, and the text is the file. Breakdown is a view over it — every edit you made became a small change here, with your comments and layout untouched. If you already write RMS by hand, this tab is where you will live.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 14  | Looking things up          | `region:sidePanel.reference` · tab `code`                                                                                                                                                                                                                                                              | Terrains, objects, commands and the attributes each command takes. The Preview Obj. List tab is the useful one when something did not appear: it lists every object your script asks for beside how many the last generation actually placed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 15  | Resources at a glance      | `region:statusBar.resources`                                                                                                                                                                                                                                                                           | Totals for the whole map, split into what players start with and what is neutral. They update as you edit, and they are the fastest way to notice you have given one side twice the gold.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 16  | Player count and map size  | `help:statusBar.generationSettings`                                                                                                                                                                                                                                                                    | The cog sets the player count, map size and team layout that the preview and those totals are calculated for. They belong to the script you are writing rather than to the app, which is why they live here and not in Settings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 17  | You made a map             | —                                                                                                                                                                                                                                                                                                      | That is a complete, playable script. Save it into your game's random map folder and it will appear in the map list. Come and say hello in the RMS Discord — bring the map, people will tell you what to try next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Step 17's callout replaces `Next` with a single `Finish` button, and shows the
Discord invite as a real link opened with `openUrl` — same as the DE RMS guide
item, and for the reason `TitleBar.tsx` already records (a Tauri webview has no
address bar, no back button and none of the user's session). The URL is
`RMS_DISCORD_URL` in `content/rmsBasics.ts` (Sec.14 open question 1, resolved
2026-08-31).

## 10. Tutorial B — "Tour of Age of RMS" (`content/appTour.ts`)

id `app-tour`, kind `app`, title **"Tour of Age of RMS"**, blurb
_"Preview, reference, status bar, settings and tools — about three minutes."_

Written for someone who already writes RMS, so it explains _this app's_ surfaces
and nothing about the language. Every step but the first is `manual` — it is a
tour, not an exercise, and there is nothing to check beyond that one gate.

**This tour changes no document, but it still needs SOME file open.** Rev 1
reasoned "runs against whatever the user already has open, including nothing…
unlike Tutorial A it asks for no file, so it never needs a step 0" — that
conflated two different things. Not requiring a NEW, EMPTY file (Tutorial A's
own requirement) is correct: this tour never edits anything, so any existing
map does fine. But "including nothing" does not: `BreakdownPane` renders a bare
`PlaceholderPane` instead of its real layout whenever `hasFile === false`, so
`MapSidePanel` (carrying `sidePanel.preview`/`sidePanel.reference`), the preview
toggle, the notes drawer and the resource totals do not exist in the DOM AT ALL
with nothing open — and nothing in this tour, or anywhere else, ever opens a
file on the user's behalf. Starting it from a clean install left every one of
those anchors permanently unresolvable for the whole run. **Step 1, "Open a map
to explore"** (`check` — `ctx.hasFile`, anchor `help:titleBar.file`, added
post-rev-1) closes that gap; every step after it can assume a file is open, the
same way Tutorial A's step 0 lets every step after IT assume one is too.

That still leaves one constraint on the copy for every step from 2 onward:
**no step may assert what is on screen.** Write "the preview shows what your
script generates", never "your map is on the left" — the second is false with a
brand-new empty file (fine to open per step 1's own copy), false with a preview
still generating, and faintly wrong with a map that looks nothing like the tour
author's. Same for the reference table (a mode the user may have changed) and
the resource totals (zeroed on an empty file). Each step describes what the
surface is _for_; the user supplies the example by looking at it.

Step 2's precis below is written to that rule and is the model for the rest.

| #   | Title                  | Anchor / Navigate                                                                                                 | Body (précis)                                                                                                                                                                                                                                                                                             | Completion    |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Open a map to explore  | `help:titleBar.file` (nudged +300px right, same File-dropdown clearance as Tutorial A's step 0) · tab `breakdown` | The rest of this tour points at panes that need a script open to mean anything — the preview, the reference table, the resource totals. Open one of your own maps if you have one handy, for real numbers to look at. Nothing open? File ▸ New works too, the panes just start at zero.                   | `ctx.hasFile` |
| 2   | The map preview        | `region:sidePanel.preview` · tab `breakdown`                                                                      | An approximate render of what your script generates, updated as you edit. It reproduces the engine's rules where those have been measured in game, and marks what it cannot model rather than drawing a confident guess. Drag to pan, wheel to zoom, click a tile for its terrain, elevation and objects. | manual        |
| 3   | Current vs Final       | `help:breakdown.sidePanel.previewToggle`                                                                          | Final generates the whole script. Current generates only up to the line you are on, so you can watch the map being built stage by stage — pin a line and step through elevation, then terrain, then objects.                                                                                              | manual        |
| 4   | The notes drawer       | `help:preview.notesDrawer`                                                                                        | Every approximation the preview made, and every placement that failed. When an object is missing from the map this is the first place to look; the Preview Obj. List below then says how many of each object actually landed.                                                                             | manual        |
| 5   | The reference table    | `region:sidePanel.reference`                                                                                      | Terrains, objects and commands with the attributes each one takes, searchable. Beats alt-tabbing to a guide for "what were the arguments to `terrain_size` again".                                                                                                                                        | manual        |
| 6   | Resources and problems | `region:statusBar.resources`                                                                                      | Live resource totals split into total, player and neutral, and a live problem count from 48 diagnostic codes — including things the game reports no error for, such as an attribute whose required partner is missing.                                                                                    | manual        |
| 7   | Generation settings    | `help:statusBar.generationSettings`                                                                               | Player count, map size and team layout. Properties of the script rather than preferences about the app, which is why they are here and not in Settings. Everything above is computed for whatever you set here.                                                                                           | manual        |
| 8   | Advanced Tools         | `region:tools.pane` · tab `advanced-tools`                                                                        | Tools that read or rewrite your script: a generation consistency checker, a constants auditor, a balance summary, a formatter and script statistics. Each proposes edits you review before applying — nothing is written without an Apply.                                                                | manual        |
| 9   | Help as you go         | `help:titleBar.settings` · tab `breakdown`                                                                        | Almost every control in the app explains itself on hover. Settings ▸ General switches that between always on, ALT only, and off. Both tutorials are in the Help menu whenever you want them again.                                                                                                        | manual        |

## 11. Feature tours

`content/whatsNew.ts` exports one `TutorialDefinition` per release that has
something to announce: `kind: "feature"`, `version: "0.4.0"`, id
`whats-new-0.4.0`. `registry.ts` collects them.

Trigger, evaluated once in `TutorialProvider` on mount, after the welcome check:

1. Read `tutorialLastSeenVersion` from the store.
2. If it is absent, write `__APP_VERSION__` and stop — a fresh install gets the
   welcome pane, not a changelog for a version it never ran.
3. If it differs from `__APP_VERSION__`, look for a feature tour whose `version`
   equals `__APP_VERSION__`. If there is one, open its **first step** as an
   announcement callout: centred, no spotlight, with "Show me" (starts the tour at
   step 2) and "Not now" (dismisses). Write the new version to the store either
   way, so the announcement never repeats.

By convention the first step of a feature tour is that announcement (no anchor,
summarises the release) and the remaining steps spotlight the new controls. That
convention is the only thing an author needs to know in order to add one, which is
the point of Sec.2.1.

The welcome pane wins if both would fire on the same launch — a first run is never
also an upgrade.

## 12. Persistence (`tutorialConstants.ts`)

Same file and shape as `helpConstants.ts`, for the same reason it gives (one
persisted store, agreed keys, guards beside them):

```ts
export const TUTORIAL_STORE_FILE = "settings.json";
export const WELCOME_SEEN_KEY = "tutorialWelcomeSeen"; // boolean
export const COMPLETED_KEY = "tutorialCompleted"; // string[]
export const LAST_SEEN_VERSION_KEY = "tutorialLastSeenVersion"; // string
```

All three are read once on mount and written through `store.set` with
`autoSave: true`. A store that fails to load must not block the app: catch, log,
and behave as though nothing was seen — **except** that `welcomeOpen` stays
`false` in that case. A welcome pane that reappears on every launch because the
store is broken is worse than one that never appears.

## 13. Testing

Vitest, jsdom, `src/tutorial/__tests__/`. `npm test` runs
`scripts/check-test-floor.mjs` — do not regress the count.

1. **`scriptChecks.test.ts`** — the real coverage. Parse the `goldenHill.rms`
   fixture with the actual parser and assert every helper against it, plus the
   negative cases: an empty script; the command present but in the wrong section;
   a command wrapped in `if` / `start_random` (must still match); and case
   variants (`CREATE_OBJECT`).
2. **`registry.test.ts`** — for every definition: ids unique; step ids unique
   within a tutorial; every `kind: "help"` anchor id exists among the HelpTip ids
   in `src/**/*.tsx` or in `ui-help.json`; every `kind: "region"` id appears in a
   `data-tutorial-anchor` attribute somewhere in `src/`. This is the test that
   stops a refactor silently breaking a tutorial. Grep the source tree with `fs`
   and a regex, the way `scripts/check-breakdown-prereqs.mjs` already does.
3. **`rmsBasics.test.ts`** — every `completion.test` in Tutorial A returns `true`
   against the finished fixture, and step _n_'s test returns `false` against a
   fixture truncated before step _n_'s edit. The second half is what makes the
   first half meaningful.
4. **`TutorialContext.test.tsx`** — start / next / back / exit transitions;
   a check satisfied on arrival rendering ticked rather than auto-advancing, and
   the same check satisfied while active auto-advancing; `bypass` advancing an
   unsatisfied step; completion writing to the store (mock
   `@tauri-apps/plugin-store` the way the existing settings tests do); and the
   welcome-versus-upgrade precedence rule.

Not unit tested: overlay geometry. Same call as `HelpTip`'s placement, which is
also untested — jsdom returns zeroed rects, so such a test would only assert the
mock.

## 14. Open questions for the maintainer

1. ~~**The RMS Discord invite URL** for Tutorial A step 17.~~ — **Resolved
   2026-08-31**: `RMS_DISCORD_URL` in `content/rmsBasics.ts` holds the real
   invite, rendered on step 17's callout as a link (`TutorialOverlay.tsx`,
   `openUrl`, same reasoning as `TitleBar.tsx`'s DE RMS Guide item).
2. **A "do it for me" button per check step.** Deliberately excluded (Sec.2.3):
   it would need the Breakdown patch engine and each step's target expressed as an
   `EditIntent`. Worth revisiting after watching someone use this over their
   shoulder — we do not yet know which steps people get stuck on. **Partially
   resolved 2026-09-01**: rather than the patch engine, one step
   ("Everyone else's resources") gained a narrow `autoFill` field that builds
   one text edit directly from the live parse — see the Sec.0 amendment above.
   Still not a general per-check-step mechanism; the other sixteen check steps
   have no such button.

Settled during review, recorded here so they are not reopened:

- **Launching by opening a file does not suppress the welcome pane.** The file
  loads behind it (Sec.7.1).
- **Tutorial A always starts from a new file**, asked for in step 0 rather than
  detected and skipped (Sec.9.0). The tutorial still does not call `newFile()`
  itself — Sec.2.6 stands, the user does it.
- **Tutorial B is fine to run against an open map**, provided its copy never
  asserts what is on screen (Sec.10).

## 15. Implementation order

Each step leaves the app working and testable.

1. `tutorialConstants.ts`, `types.ts`, `scriptChecks.ts` and its tests. No UI.
   This is the part with real logic in it, so it goes first and lands green.
2. `data-help-id` in `HelpTip.tsx`, plus the six container anchors. Zero behaviour
   change; confirm the existing suite still passes.
3. `TutorialContext.tsx` with the navigator registry and persistence; register both
   navigators; no overlay yet. Drive it from a temporary button.
4. `TutorialOverlay.tsx` + CSS. Verify against a two-step throwaway definition.
5. `content/appTour.ts` — all-manual steps, the cheapest end-to-end proof.
6. `content/rmsBasics.ts`, `registry.test.ts`, `rmsBasics.test.ts`.
7. `WelcomeDialog.tsx`, `welcomePhrases.ts`, first-run trigger.
8. Help menu items and the new `ui-help.json` entries.
9. `content/whatsNew.ts` scaffold and the version trigger.

## 16. Acceptance criteria

- A fresh profile (no `settings.json`) shows the welcome pane once, with a skip
  button whose wording varies between launches.
- Each of the three welcome buttons does exactly what Sec.7.4 says, and the pane
  never appears again.
- Help ▸ either tutorial item starts that tutorial from step 1, at any time,
  whether or not it has been completed.
- In Tutorial A, performing a step's edit in the Breakdown editor advances the
  tutorial without the user clicking Next.
- `Next` advances an unsatisfied check step anyway; `Back` returns to it and it is
  still unsatisfied.
- Running Tutorial A against a finished Golden Hill does NOT race to the end: each
  step renders ticked and waits for Next, so it is readable as a reference.
- Step 0's "Carry on with my own map" advances into step 1 with the user's own
  file untouched.
- `Escape` and `Exit tutorial` end a run cleanly, with no overlay left behind.
- With the tutorial open, every control behind the scrim is still clickable.
- The spotlight follows its anchor when the pane is scrolled or the window
  resized, and degrades to a centred callout when the anchor is not on screen.
- Following Tutorial A end to end on an empty file produces a script that parses
  with zero errors and renders a recognisable map in the preview.
- `npm test`, `npm run typecheck`, `npm run lint` and `npm run validate:reference`
  all pass.
