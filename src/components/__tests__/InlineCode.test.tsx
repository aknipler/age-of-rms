import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Prose } from "../InlineCode";

afterEach(cleanup);

function codes(text: string): string[] {
  const { container } = render(<Prose text={text} />);
  return [...container.querySelectorAll("code")].map((c) => c.textContent!);
}

describe("Prose inline code", () => {
  it("marks explicit backtick spans and drops the backticks", () => {
    const { container } = render(<Prose text="Use `GRASS` here." />);
    expect(container.textContent).toBe("Use GRASS here.");
    expect(container.querySelectorAll("code")).toHaveLength(1);
  });

  it("finds underscore identifiers and directives without backticks", () => {
    expect(
      codes("Add create_land, then TEAM_POSITIONS. Use #const too."),
    ).toEqual(["create_land", "TEAM_POSITIONS", "#const"]);
  });

  it("does not guess at plain words or file names", () => {
    expect(codes("The zone and RMS are words. See my_map.rms.")).toEqual([]);
  });

  it("does not wrap an identifier twice when it is already in backticks", () => {
    expect(codes("Set `circle_radius` first.")).toEqual(["circle_radius"]);
  });

  it("leaves an unmatched backtick alone", () => {
    const { container } = render(<Prose text="a ` b" />);
    expect(container.textContent).toBe("a ` b");
  });
});
