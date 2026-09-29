// The panel's selection, rendered for real, and at the end its shape
// editor. Two selection promises are pinned here.
// A freshly opened panel selects the first item so an editor is on screen.
// A tab switch (Code or Breakdown and back) keeps whatever the user had
// selected. The second is the one that could regress quietly, since a tab
// switch unmounts this component and a default that ran on every mount
// would look correct in every test that only mounts once.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../../parser/parser";
import { HelpSettingsProvider } from "../../../../../help/HelpSettingsContext";
import { computeApplyEdits } from "../../applyEdits";
import { EMPTY_MODEL, LandPlacementModelProvider } from "../landPlacementModel";
import { PanelPreviewSeedProvider } from "../panelPreviewSeed";
import { LandPlacementPanel } from "../LandPlacementPanel";
import {
  addRing,
  addRole,
  applyGroupEdit,
  setGroupKind,
  setThetaPerCountOverride,
  updateRole,
} from "../modelOps";
import type { AlpModel } from "../../fence";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
}));
// jsdom has no 2D canvas, and the canvas needs the preview worker's context.
// Selection state lives in the panel and the store, not in the canvas.
vi.mock("../LandPlacementCanvas", () => ({
  LandPlacementCanvas: () => null,
}));

afterEach(cleanup);

const lang = loadLanguage();

/** One role and an eight-member circle wearing it. */
function oneRoleRing(): AlpModel {
  const { model: withRole, roleId } = addRole(EMPTY_MODEL);
  return addRing(withRole, roleId).model;
}

/** The script the tool itself writes for `model`. */
function appliedScript(model: AlpModel): string {
  const source = "<PLAYER_SETUP>\ndirect_placement\n";
  const { edits } = computeApplyEdits(
    parseRms(source, lang),
    model,
    lang,
    new Map(),
    8,
  );
  let text = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.newText + text.slice(e.end);
  return text;
}

const defaultSource = appliedScript(oneRoleRing());

/** `shown` stands in for the Advanced Tools tab being active. The store sits above it, as App.tsx places it above `activeTab`. */
function Harness({
  shown,
  source = defaultSource,
}: {
  shown: boolean;
  source?: string;
}) {
  const parseResult = parseRms(source, lang);
  return (
    <HelpSettingsProvider>
      <LandPlacementModelProvider>
        <PanelPreviewSeedProvider>
          {shown && (
            <LandPlacementPanel
              parseResult={parseResult}
              source={source}
              reparseNow={() => {}}
              applyTextEdits={() => {}}
              onJumpToOffset={() => {}}
              playerCount={8}
              mapSize="Normal"
              lang={lang}
            />
          )}
        </PanelPreviewSeedProvider>
      </LandPlacementModelProvider>
    </HelpSettingsProvider>
  );
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * The role editor's label input. Filtered to text inputs because "Role 1" is
 * also the chosen option of the toolbar's "with role" select, and of a land
 * editor's Role select, and a display-value query matches a select by its
 * chosen option. The Roles list row shows the name as a span, which no
 * display-value query matches.
 */
const roleEditorOpen = () =>
  screen
    .queryAllByDisplayValue("Role 1")
    .some((el) => el instanceof HTMLInputElement && el.type === "text");
const shapeEditorOpen = () =>
  screen.queryByText(/^Circle \d+, 8 lands$/) !== null;

describe("Land Placement panel selection", () => {
  it("opens with the first item, the first role, selected", async () => {
    render(<Harness shown />);
    await settled();
    expect(roleEditorOpen()).toBe(true);
    expect(shapeEditorOpen()).toBe(false);
  });

  it("lists roles, shapes and lands in their own sections", async () => {
    render(<Harness shown />);
    await settled();
    expect(screen.getByText("Roles (1)")).toBeTruthy();
    expect(screen.getByText("Shapes (1)")).toBeTruthy();
    expect(screen.getByText("Lands (8)")).toBeTruthy();
  });

  it("clicking a shape opens its editor in place of the role's", async () => {
    render(<Harness shown />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    expect(shapeEditorOpen()).toBe(true);
    expect(roleEditorOpen()).toBe(false);
  });

  it("a land's Edit shape button selects its shape", async () => {
    render(<Harness shown />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^ring_\d+_0_/ }));
    expect(shapeEditorOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit shape" }));
    expect(shapeEditorOpen()).toBe(true);
  });

  it("keeps the selection across a tab switch instead of resetting to the default", async () => {
    const { rerender } = render(<Harness shown />);
    await settled();
    const landRow = screen.getByRole("button", { name: /^ring_\d+_3_/ });
    const landLabel = landRow.querySelector("span")!.textContent!;
    fireEvent.click(landRow);
    expect(screen.queryByDisplayValue(landLabel)).not.toBeNull();

    rerender(<Harness shown={false} />); // to the Code tab
    await settled();
    expect(screen.queryByDisplayValue(landLabel)).toBeNull();

    rerender(<Harness shown />); // and back
    await settled();
    expect(screen.queryByDisplayValue(landLabel)).not.toBeNull();
    expect(roleEditorOpen()).toBe(false);
  });

  it("a shape row names its kind, land count and roles, and each land names its shape", async () => {
    render(<Harness shown />);
    await settled();
    const shapeRow = screen.getByRole("button", { name: /^Circle \d+/ });
    const name = within(shapeRow).getByText(/^Circle \d+$/).textContent!;
    expect(within(shapeRow).getByText("8 lands")).toBeTruthy();
    expect(within(shapeRow).getByText("Role 1")).toBeTruthy();
    for (const row of screen.getAllByRole("button", { name: /^ring_\d+_/ }))
      expect(within(row).getByText(name)).toBeTruthy();
  });

  it("renames a shape everywhere when its kind changes, and never shows 'ring' for it", async () => {
    render(<Harness shown />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle \d+/ }));
    fireEvent.change(screen.getByDisplayValue("Circle"), {
      target: { value: "square" },
    });
    const shapeRow = screen.getByRole("button", { name: /^Square \d+/ });
    const name = within(shapeRow).getByText(/^Square \d+$/).textContent!;
    expect(screen.queryByText(/^Circle \d+$/)).toBeNull();
    expect(within(shapeRow).queryByText(/ring/)).toBeNull();
    const landRow = screen.getAllByRole("button", { name: /^ring_\d+_0_/ })[0]!;
    expect(within(landRow).getByText(name)).toBeTruthy();
  });

  it("the with role picker's (none) makes + Land a roleless anchor and + Shape a shape of points", async () => {
    render(<Harness shown />);
    await settled();
    const picker = screen.getByLabelText("with role") as HTMLSelectElement;
    expect(picker.value).not.toBe(""); // defaults to the first role, not (none)
    // Chosen through the option itself. jsdom accepts a value no option has
    // and still fires change, so setting "" directly passed with no (none)
    // option in the list at all (mutation-tested).
    const none = within(picker).getByRole("option", {
      name: "(none)",
    }) as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: none.value } });
    expect(none.selected).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "+ Land" }));
    // + Land selects what it made, and its Role select reads no role.
    expect(screen.queryByDisplayValue("(none, chain anchor)")).not.toBeNull();
    expect(screen.getByText("Lands (9)")).toBeTruthy();

    // + Shape used to be disabled here. A slot may now have no role, so it
    // makes a shape of points and opens its editor.
    fireEvent.click(screen.getByRole("button", { name: "+ Shape" }));
    expect(screen.getByText(/^Circle \d+, 8 points$/)).toBeTruthy();
    expect(screen.getByText("Lands (17)")).toBeTruthy();
  });

  it("does not carry a half-typed draft from one role's editor to the next", async () => {
    // One editor slot serves every role. Without a key per role, React
    // reuses the instance, and a FormulaField's uncommitted text survives
    // the switch. Base sizes are set apart so each field is findable.
    const first = oneRoleRing();
    const { model: two, roleId: secondId } = addRole(first);
    const model = updateRole(
      updateRole(two, first.roles[0]!.id, { baseSize: { k: "num", v: 11 } }),
      secondId,
      { baseSize: { k: "num", v: 22 } },
    );
    render(<Harness shown source={appliedScript(model)} />);
    await settled();

    // Typed, not committed. FormulaField commits on blur.
    fireEvent.change(screen.getByDisplayValue("11"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Role 2/ }));

    expect(screen.queryByDisplayValue("22")).not.toBeNull();
    expect(screen.queryByDisplayValue("123")).toBeNull();
  });
});

// The shape editor's origin and jitter controls, through the real panel.
// The pure halves are pinned in pointsAndOrigins.test.ts and
// groupJitter.test.ts. These pin the wiring.
describe("Land Placement shape editor", () => {
  it("moves a shape onto a new origin point and selects the point", async () => {
    render(<Harness shown />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    const origin = screen
      .getByText("Origin")
      .parentElement!.querySelector("select") as HTMLSelectElement;
    expect(origin.value).toBe("center");
    // No Frame row while the shape sits on the map centre, where the two
    // frames agree.
    expect(screen.queryByText("Frame")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Origin point" }));
    // The new point is selected, so its own editor is open, and it has no
    // role of its own.
    expect(screen.queryByDisplayValue("(none, chain anchor)")).not.toBeNull();
    expect(screen.getByText("Lands (9)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    const moved = screen
      .getByText("Origin")
      .parentElement!.querySelector("select") as HTMLSelectElement;
    expect(moved.value).not.toBe("center");
    // The Frame row appears, still reading the shape's own frame. It is
    // not switched for the user.
    expect(
      screen.getByDisplayValue("radial (turns with the origin)"),
    ).toBeTruthy();
  });

  it("Add jitter writes a per-player draw that the Random parameters list locks", async () => {
    const ring = oneRoleRing();
    const perPlayer = applyGroupEdit(
      ring,
      ring.groups[0]!.id,
      { perPlayer: true, repeats: 8 },
      parseRms(defaultSource, lang),
      null,
    )!.model;
    render(<Harness shown source={appliedScript(perPlayer)} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));

    // No minimum separation, so half the 8-player gap of 45 degrees.
    fireEvent.click(screen.getByRole("button", { name: "Add jitter ±22°" }));
    expect(
      screen.getByText(
        /^Jitter is ±22°, drawn per player by JITTER_RING_\d+\./,
      ),
    ).toBeTruthy();
    const label = screen.getByDisplayValue(/^JITTER_RING_\d+$/);
    const perPlayerBox = label.parentElement!.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(perPlayerBox.checked).toBe(true);
    expect(perPlayerBox.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove jitter" }));
    expect(screen.queryByDisplayValue(/^JITTER_RING_\d+$/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add jitter ±22°" }),
    ).toBeTruthy();
  });

  // A per player circle, the starting point of the kind change tests below.
  function perPlayerRingScript(): string {
    const ring = oneRoleRing();
    const perPlayer = applyGroupEdit(
      ring,
      ring.groups[0]!.id,
      { perPlayer: true, repeats: 8 },
      parseRms(defaultSource, lang),
      null,
    )!.model;
    return appliedScript(perPlayer);
  }

  // land-placement-per-player-any-kind-escalation.md slice C deleted the
  // interim guard of its section 2, so the Shape select offers every kind
  // on a per player shape. The pure half is pinned in modelOps.test.ts.
  it("a per player circle offers every kind, and picking Square makes a per player square", async () => {
    render(<Harness shown source={perPlayerRingScript()} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    const shape = screen.getByDisplayValue("Circle") as HTMLSelectElement;
    expect(shape.title).toBe("");
    const options = within(shape).getAllByRole("option") as HTMLOptionElement[];
    expect(options).toHaveLength(6);
    for (const option of options) expect(option.disabled).toBe(false);

    fireEvent.change(shape, { target: { value: "square" } });
    expect(screen.getByRole("button", { name: /^Square \d+/ })).toBeTruthy();
    const box = screen.getByLabelText(
      "One land per player",
    ) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it("One land per player stays enabled on a square, ticked or not", async () => {
    render(<Harness shown source={perPlayerRingScript()} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    fireEvent.change(screen.getByDisplayValue("Circle"), {
      target: { value: "square" },
    });
    expect(screen.getByRole("button", { name: /^Square \d+/ })).toBeTruthy();
    const box = screen.getByLabelText(
      "One land per player",
    ) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
  });

  // Doc 5.1 and 5.5. A perimeter has no angle along it, so its jitter is a
  // typed percent with no unit toggle and no minimum separation.
  it("a per player square takes a typed percent jitter, with no unit toggle", async () => {
    render(<Harness shown source={perPlayerRingScript()} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    fireEvent.change(screen.getByDisplayValue("Circle"), {
      target: { value: "square" },
    });
    expect(screen.queryByText("Min. separation (deg)")).toBeNull();
    expect(screen.queryByText("Jitter in")).toBeNull();
    const amount = screen
      .getByText("Jitter amount")
      .parentElement!.querySelector("input") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "35" } });
    fireEvent.blur(amount);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add jitter ±35% of the even gap",
      }),
    );
    expect(
      screen.getByText(
        /^Jitter is ±35% of the even gap, drawn per player by JITTER_RING_\d+\./,
      ),
    ).toBeTruthy();
  });

  // Doc section 6 hides the per count angle list on a perimeter shape. The
  // owner's call (2026-09-29, doc section 3 decision 9) keeps it on screen
  // for a land that already holds an override, carried over from a kind
  // change, so the scripter can see why that land takes no jitter and
  // remove the override. No new override can be added there.
  it("a per player square shows the per count list only for a land that already has one", async () => {
    const ring = oneRoleRing();
    const parse = parseRms(defaultSource, lang);
    const groupId = ring.groups[0]!.id;
    const perPlayer = applyGroupEdit(
      ring,
      groupId,
      { perPlayer: true, repeats: 8 },
      parse,
      null,
    )!.model;
    const p2 = perPlayer.groups[0]!.members[1]!;
    const overridden = setThetaPerCountOverride(perPlayer, p2, 4, {
      k: "num",
      v: 77,
    });
    const square = setGroupKind(
      overridden,
      groupId,
      "square",
      8,
      parse,
      null,
    )!.model;
    render(<Harness shown source={appliedScript(square)} />);
    await settled();

    fireEvent.click(screen.getByRole("button", { name: /^ring_\d+_0_/ }));
    expect(screen.queryByText("Angle overrides by player count")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^ring_\d+_1_/ }));
    expect(screen.getByText("Angle overrides by player count")).toBeTruthy();
    expect(screen.getByText(/takes no jitter at any count/)).toBeTruthy();
    expect(screen.queryByText("+ add override for player count…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Angle overrides by player count")).toBeNull();
  });

  it("a per player circle becomes a per player arc", async () => {
    render(<Harness shown source={perPlayerRingScript()} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    fireEvent.change(screen.getByDisplayValue("Circle"), {
      target: { value: "arc" },
    });
    expect(screen.getByRole("button", { name: /^Arc \d+/ })).toBeTruthy();
    const box = screen.getByLabelText(
      "One land per player",
    ) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  // Doc 5.5. On an arc the scripter types the amount. There is no minimum
  // separation input and no computed bound, and Circle keeps both.
  it("a per player arc takes a typed jitter amount, with no minimum separation", async () => {
    render(<Harness shown source={perPlayerRingScript()} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    expect(screen.getByText("Min. separation (deg)")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Circle"), {
      target: { value: "arc" },
    });
    expect(screen.queryByText("Min. separation (deg)")).toBeNull();

    const amount = screen
      .getByText("Jitter amount")
      .parentElement!.querySelector("input") as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "15" } });
    const unit = screen
      .getByText("Jitter in")
      .parentElement!.querySelector("select") as HTMLSelectElement;
    fireEvent.change(unit, { target: { value: "percent" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add jitter ±15% of the even gap",
      }),
    );
    expect(
      screen.getByText(
        /^Jitter is ±15% of the even gap, drawn per player by JITTER_RING_\d+\./,
      ),
    ).toBeTruthy();
  });

  // Slice B. A line has no angle along it, so its jitter is percent only and
  // the unit toggle is hidden. Switching a degree-jittered shape to Line
  // translates the amount at the previewed count (the owner's call,
  // 2026-09-28), here 8 players.
  it("switching a degree-jittered circle to Line translates the jitter to percent and hides the unit", async () => {
    render(<Harness shown source={perPlayerRingScript()} />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add jitter ±22°" }));
    fireEvent.change(screen.getByDisplayValue("Circle"), {
      target: { value: "line" },
    });
    expect(screen.getByRole("button", { name: /^Line \d+/ })).toBeTruthy();
    // 22 degrees of the 45 degree gap at 8 players is 48.9%, down to 48.
    expect(
      screen.getByText(
        /^Jitter is ±48% of the even gap, drawn per player by JITTER_RING_\d+\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Jitter in")).toBeNull();
    expect(screen.queryByText("Min. separation (deg)")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Update jitter ±48% of the even gap",
      }),
    ).toBeTruthy();
  });

  it("warns under Rotation about a name with no value, while typing and after saving", async () => {
    render(<Harness shown />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /^Circle/ }));
    const rotation = screen
      .getByText("Rotation (deg)")
      .parentElement!.querySelector("input") as HTMLInputElement;
    const warning = /^No #const in this script is named ROTATOIN\b/;

    fireEvent.change(rotation, { target: { value: "ROTATOIN + 45" } });
    expect(screen.getByText(warning)).toBeTruthy(); // before saving
    fireEvent.blur(rotation);
    await settled();
    // After saving the box re-reads the committed value, and the name is
    // still unknown, so the warning is still there to explain the canvas.
    expect(screen.getByText(warning)).toBeTruthy();

    fireEvent.change(rotation, { target: { value: "45" } });
    expect(screen.queryByText(warning)).toBeNull();
  });
});
