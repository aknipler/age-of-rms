// A user reported "the undo button sometimes undoes a lot of work" in
// Breakdown. Root cause: Monaco's own edit stack APPENDS a new edit onto
// the PREVIOUS undo entry whenever that entry is still open
// (SingleModelEditStackElement.canAppend, monaco-editor's editStack.js),
// and the only thing that closes one is pushStackElement(), which a real
// editor's Cursor controller calls automatically while typing, but that
// controller only exists while CodePane is mounted, i.e. never while the
// user stays on the Breakdown tab. Every Breakdown action used to
// accumulate onto one growing undo entry until it happened to fork fresh,
// and a single Ctrl+Z then reverted the whole streak at once.
//
// The fix is `pushOwnUndoEntry` in src/hooks/useDocument.ts: it closes the
// previous group (pushStackElement) immediately before every edit this app
// pushes, so each discrete action always lands as its own undo entry.
//
// Two things worth testing here, neither reachable the obvious way:
//
// 1. useDocument.ts can't be imported into Vitest at all: it pulls in
//    monaco-editor at module scope, and monaco-editor's package.json
//    declares no Node-resolvable entry point (only a browser "module"
//    field), so the bare specifier fails to resolve, and the explicit ESM
//    subpath (monaco-editor/esm/vs/editor/editor.main.js) that DOES
//    resolve is far too heavy to import per test run. So the first
//    describe block reads the file's own source text instead, the same
//    way src/tools/__tests__/helpCoverage.test.ts checks a HelpTip/
//    ui-help.json pairing it can't reach by rendering the pane either.
// 2. That only proves the wrapper is wired in, not that the underlying
//    algorithm actually fixes the reported symptom. The second describe
//    block reimplements Monaco's own coalescing rule in a small, faithful,
//    dependency-free model (verified line-for-line against editStack.js
//    at the time this was written) and demonstrates the bug and the fix
//    mechanistically: comment out the `pushStackElement()` call in the
//    "grouped" test below and it goes red immediately.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../parser/__tests__/testUtils";

describe("useDocument.ts routes every model edit through pushOwnUndoEntry", () => {
  const source = readFileSync(
    join(REPO_ROOT, "src", "hooks", "useDocument.ts"),
    "utf8",
  );

  it("calls pushEditOperations from exactly one place: inside pushOwnUndoEntry itself", () => {
    // If a future edit adds a new model-mutating helper that calls
    // documentModel.pushEditOperations directly, this count goes to 2 and
    // catches it before that helper can reintroduce the bug.
    const matches = source.match(/\.pushEditOperations\(/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("pushOwnUndoEntry closes the previous undo entry immediately before pushing", () => {
    expect(source).toMatch(
      /documentModel\.pushStackElement\(\);\s*documentModel\.pushEditOperations\(/,
    );
  });

  it("every call site routes through pushOwnUndoEntry: replaceRanges, applyTextEdit, applyTextEdits", () => {
    // 1 definition + 3 call sites. A helper that starts calling
    // pushEditOperations directly again would leave this count unchanged
    // while the test above catches it; a helper that stops calling
    // pushOwnUndoEntry at all (reverting to some other mechanism) is what
    // this count is for.
    const calls = source.match(/pushOwnUndoEntry\(/g) ?? [];
    expect(calls).toHaveLength(4);
  });
});

/**
 * A minimal, faithful model of Monaco's own edit-stack coalescing rule,
 * reimplemented here because the real monaco-editor can't be loaded into
 * this test environment (see the file header). Verified against
 * monaco-editor/esm/vs/editor/common/model/editStack.js:
 * `EditStack._getOrCreateEditStackElement` reuses the last element when
 * `SingleModelEditStackElement.canAppend` is true, which it is until
 * `.close()` runs (only reachable via `pushStackElement()`); `.undo()`
 * replays a whole element's accumulated changes in one call
 * (`model._applyUndo(data.changes, ...)`), not one change at a time.
 */
class FakeUndoStack {
  private entries: string[][] = [];
  private open = false;

  pushStackElement(): void {
    this.open = false;
  }

  pushEditOperations(change: string): void {
    if (!this.open) {
      this.entries.push([]);
      this.open = true;
    }
    this.entries[this.entries.length - 1].push(change);
  }

  undo(): string[] | undefined {
    return this.entries.pop();
  }

  get entryCount(): number {
    return this.entries.length;
  }
}

describe("Monaco's edit-stack coalescing rule (the mechanism behind the bug and the fix)", () => {
  it("without closing the group first, consecutive edits merge into one undo entry (the original bug)", () => {
    const stack = new FakeUndoStack();
    stack.pushEditOperations("delete command A");
    stack.pushEditOperations("add attribute B");
    stack.pushEditOperations("edit value C");
    expect(stack.entryCount).toBe(1);
    // One undo reverts all three actions at once, exactly the reported symptom.
    expect(stack.undo()).toEqual([
      "delete command A",
      "add attribute B",
      "edit value C",
    ]);
  });

  it("closing the group before each push (pushOwnUndoEntry's fix) gives each action its own undo entry", () => {
    const stack = new FakeUndoStack();
    for (const action of [
      "delete command A",
      "add attribute B",
      "edit value C",
    ]) {
      stack.pushStackElement();
      stack.pushEditOperations(action);
    }
    expect(stack.entryCount).toBe(3);
    expect(stack.undo()).toEqual(["edit value C"]);
    expect(stack.undo()).toEqual(["add attribute B"]);
    expect(stack.undo()).toEqual(["delete command A"]);
  });

  it("an N-edit batch (Advanced Tools' applyTextEdits) still lands as one entry, by calling pushEditOperations N times between a single pair of stack-element boundaries", () => {
    const stack = new FakeUndoStack();
    stack.pushStackElement();
    for (const change of ["tool edit 1", "tool edit 2", "tool edit 3"]) {
      stack.pushEditOperations(change);
    }
    expect(stack.entryCount).toBe(1);
    expect(stack.undo()).toEqual(["tool edit 1", "tool edit 2", "tool edit 3"]);
  });

  it("a fresh action after an undo starts its own entry rather than reopening the reverted one", () => {
    // Mirrors why the bug is "sometimes": Monaco's real undoRedoService
    // returns no last element once a redo is pending, so whatever comes
    // right after an undo already starts clean even without this fix.
    // FakeUndoStack doesn't model redo-pending state, so this test pins
    // the narrower, still-relevant fact that pushStackElement alone is
    // enough to guarantee separation regardless of stack history.
    const stack = new FakeUndoStack();
    stack.pushStackElement();
    stack.pushEditOperations("action 1");
    stack.undo();
    stack.pushStackElement();
    stack.pushEditOperations("action 2");
    expect(stack.entryCount).toBe(1);
    expect(stack.undo()).toEqual(["action 2"]);
  });
});
