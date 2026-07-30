import { missingRequiredSection } from "./diagnostics";
import type { Diagnostic, Item, ParseResult } from "./types";

function visitItems(items: Item[], visit: (item: Item) => void): void {
  for (const item of items) {
    visit(item);

    if (item.kind === "command" && item.block) {
      visitItems(item.block.items, visit);
    } else if (item.kind === "if") {
      for (const branch of item.branches) visitItems(branch.items, visit);
    } else if (item.kind === "random") {
      visitItems(item.preamble, visit);
      for (const branch of item.branches) visitItems(branch.items, visit);
    } else if (item.kind === "orphanBlock") {
      visitItems(item.block.items, visit);
    }
  }
}

/**
 * Runs cross-node checks that need the complete AST. Parsing remains
 * syntax-only; callers opt into semantic diagnostics after parseRms().
 */
export function validateRms(result: ParseResult): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const presentSections = new Set(
    result.script.sections.map((section) => section.name),
  );
  const reportedDependencies = new Set<string>();

  const checkItem = (item: Item): void => {
    if (item.kind !== "attribute" || !item.def?.requiresSections) return;

    for (const sectionName of item.def.requiresSections) {
      const dependency = `${item.def.name}\0${sectionName}`;
      if (
        presentSections.has(sectionName) ||
        reportedDependencies.has(dependency)
      )
        continue;

      reportedDependencies.add(dependency);
      diagnostics.push(
        missingRequiredSection(result.tokens[item.name], sectionName),
      );
    }
  };

  visitItems(result.script.preamble, checkItem);
  for (const section of result.script.sections)
    visitItems(section.items, checkItem);

  return diagnostics;
}
