import { useAppSettings } from "../settings/AppSettingsContext";
import { isShortened, shortenName } from "../settings/nameDisplay";
import styles from "./ScriptName.module.css";

interface ScriptNameProps {
  /** The name exactly as the script wrote it, e.g. "SHORE_FISH" or a script `#const`. */
  name: string;
}

/**
 * One RMS constant name, shortened per the General setting.
 *
 * The full name is carried on the native `title` attribute rather than through
 * a HelpTip, and that is a deliberate exception to the wrap-everything-in-
 * HelpTip convention. HelpTip is gated on the help-mode setting, so with tips
 * off the full name would be unreachable — and shortening is the one place
 * where the tooltip is not an explanation of a control but the DATA ITSELF.
 * A hidden value has to stay recoverable no matter how the help system is
 * configured.
 *
 * `<abbr>` rather than `<span>` because that is exactly what this is: an
 * abbreviation with its expansion, which screen readers announce from `title`.
 */
export function ScriptName({ name }: ScriptNameProps) {
  const { shortenLongNames } = useAppSettings();
  const shown = shortenName(name, shortenLongNames);
  if (!isShortened(name, shortenLongNames)) return <span>{name}</span>;
  return (
    <abbr className={styles.abbreviated} title={name}>
      {shown}
    </abbr>
  );
}
