import type { AttributeNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { renderArgs } from "../renderValue";
import { HelpTip } from "../../components/HelpTip";
import cardStyles from "./cards.module.css";

/**
 * §3.2's table: an AttributeNode at statement level (not inside a `{ }`
 * block) renders as a command-card-shaped shell with an RMS0207 badge
 * ("belongs inside a { } block") rather than as an AttributeRow — it's
 * not part of any command's all-attributes list here.
 */
export function StrayAttributeCard({ attribute }: { attribute: AttributeNode }) {
  const { tokens } = useBreakdownContext();
  const name = tokens[attribute.name].text;
  return (
    <div className={cardStyles.card}>
      <div className={cardStyles.strayHeader}>
        <HelpTip id="breakdown.strayAttribute">
          <span>
            {name} {renderArgs(attribute.args, tokens)}
          </span>
        </HelpTip>
        <span className={`${cardStyles.problemBadge} ${cardStyles["severity-warning"]}`}>
          belongs inside a {"{ }"} block
        </span>
      </div>
    </div>
  );
}
