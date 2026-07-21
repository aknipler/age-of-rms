import type { Item } from "../../parser/types";
import { AttributeInstanceRow } from "./AttributeRow";
import { ItemCard } from "./ItemCard";

/**
 * Renders one item of a command block's "Other contents" group (§3.3(c)):
 * known-but-unlisted AttributeNodes get the same typed row as a listed
 * attribute but with NO badge (a badge would be Breakdown-invented
 * validation — the parser attaches no diagnostic to this case at all,
 * §5's rule). Everything else (nested conditionals, directives, raw
 * runs, wrong-context commands) uses the normal per-kind card via
 * ItemCard, same as a top-level block item.
 */
export function OtherContentsRow({ item }: { item: Item }) {
  if (item.kind === "attribute" && item.def) {
    return <AttributeInstanceRow node={item} helpId="breakdown.attributeRow.otherContents" />;
  }
  return <ItemCard item={item} />;
}
