import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "../../components/HelpTip";
import dialogStyles from "../../components/dialog.module.css";
import styles from "./TemplateDialog.module.css";
import {
  BERRY_OPTIONS,
  HERDABLE_OPTIONS,
  HUNTABLE_OPTIONS,
  LURABLE_OPTIONS,
  FOREST_MAKER_CONST,
  T1_DEFAULTS,
  T2_DEFAULTS,
  T3_DEFAULTS,
  T4_DEFAULTS,
  T5_DEFAULTS,
  forestTerrainOptions,
  isNameOrId,
  isValidIdentifier,
  playerForestsObjectsProblems,
  playerForestsTerrainProblems,
  renderPlayerForestsObjects,
  renderPlayerForestsTerrain,
  renderStandardPlayerObjects,
  renderStandardPlayerResources,
  renderStandardWaterResources,
  templatesFor,
  treeOptions,
  type NamedOption,
  type RenderedTemplate,
  type T1Options,
  type T2Options,
  type T3Options,
  type T4Options,
  type T5Options,
  type TemplateConstant,
  type TemplateId,
  type TemplateSection,
} from "./templates";

/** What the dialog knows about the script, read off the parse by the caller. */
export interface TemplateScriptContext {
  /** create_player_lands' terrain_type, the terrain template's default player land. */
  playerLand?: string;
  /** The script already defines MAKE_FOREST_TERRAIN, see T4Context. */
  forestSetupPresent: boolean;
}

interface TemplateDialogProps {
  /** Which tab opened the dialog. Each offers its own templates. */
  section: TemplateSection;
  script: TemplateScriptContext;
  /** game-constants.json rows, for the forest terrain and tree lists. */
  constants: readonly TemplateConstant[];
  onClose: () => void;
  /** `text`/`caretOffset`/`setupText` are templates.ts's own untranslated
   * shape (see templates.ts's header comment); the caller passes them
   * straight through to an `insertText` intent, computeEdit.ts owns
   * reindenting them to the target file's style. */
  onInsert: (rendered: RenderedTemplate) => void;
}

// docs/object-templates-brief.md Sec.3: a left column of the three
// template names (radio), a right column of that template's own options,
// a live read-only preview of the exact text Insert would produce (the
// cheapest teaching aid available and doubles as the manual test), and
// Insert/Cancel at the bottom. Escape cancels, same convention as every
// other dialog in the app (UnsavedChangesDialog, CommandPicker).
//
// Deliberately its own component rather than folded into SectionView:
// GenerationSettingsDialog is the sibling shape this follows, a focused
// dialog with its own local option state, opened from one button.
export function TemplateDialog({
  section,
  script,
  constants,
  onClose,
  onInsert,
}: TemplateDialogProps) {
  const templates = templatesFor(section);
  const [selected, setSelected] = useState<TemplateId>(templates[0].id);
  const [t1, setT1] = useState<T1Options>(T1_DEFAULTS);
  const [t2, setT2] = useState<T2Options>(T2_DEFAULTS);
  const [t3, setT3] = useState<T3Options>(T3_DEFAULTS);
  const [t4, setT4] = useState<T4Options>(T4_DEFAULTS);
  // A lazy initializer (a function passed to useState) because the default
  // depends on a prop. It runs once, on mount, which is what we want, the
  // imported terrain is a starting value the user can then overwrite. If
  // the script changes underneath an open dialog the field keeps what the
  // user typed rather than snapping back.
  const [t5, setT5] = useState<T5Options>(() => ({
    ...T5_DEFAULTS,
    playerLand: script.playerLand ?? "",
  }));
  // Derived from reference data, so memoized on the array identity. The
  // constants table is ~3900 rows and never changes while the app runs,
  // there is no reason to refilter it on every keystroke.
  const forestTerrains = useMemo(
    () => forestTerrainOptions(constants),
    [constants],
  );
  const trees = useMemo(() => treeOptions(constants), [constants]);
  const t4Context = { setupPresent: script.forestSetupPresent };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // A switch over a union of string literals. With every case returning,
  // TypeScript checks it is exhaustive, so a sixth TemplateId added to
  // templates.ts without a case here is a compile error rather than a
  // dialog that silently renders nothing.
  const rendered = useMemo((): RenderedTemplate => {
    switch (selected) {
      case "standardPlayerObjects":
        return renderStandardPlayerObjects(t1);
      case "standardPlayerResources":
        return renderStandardPlayerResources(t2);
      case "standardWaterResources":
        return renderStandardWaterResources(t3);
      case "playerForestsObjects":
        return renderPlayerForestsObjects(t4, {
          setupPresent: script.forestSetupPresent,
        });
      case "playerForestsTerrain":
        return renderPlayerForestsTerrain(t5);
    }
  }, [selected, t1, t2, t3, t4, t5, script.forestSetupPresent]);

  // Sec.3's own rule: Insert is disabled while any field holds an invalid
  // value. T1-T3 can only go wrong in a terrain_to_place_on field; the
  // forest templates have number fields too, and say what is wrong in
  // words below the options rather than only greying the button out.
  const terrainInvalid =
    (selected === "standardPlayerObjects" &&
      t1.terrainToPlaceOn !== "" &&
      !isValidIdentifier(t1.terrainToPlaceOn)) ||
    (selected === "standardPlayerResources" &&
      t2.terrainToPlaceOn !== "" &&
      !isValidIdentifier(t2.terrainToPlaceOn));
  const problems =
    selected === "playerForestsObjects"
      ? playerForestsObjectsProblems(t4, t4Context)
      : selected === "playerForestsTerrain"
        ? playerForestsTerrainProblems(t5)
        : [];
  const insertDisabled = terrainInvalid || problems.length > 0;
  // Only the preview labels where each part goes. The comments are not
  // inserted, onInsert gets `rendered` untouched.
  const previewText = rendered.setupText
    ? `/* Goes at the end of PLAYER_SETUP */\n${rendered.setupText}\n\n/* Goes here */\n${rendered.text}`
    : rendered.text;

  return (
    <div className={dialogStyles.overlay} onMouseDown={onClose}>
      <div
        className={`${dialogStyles.dialog} ${styles.wide}`}
        role="dialog"
        aria-modal="true"
        aria-label="Add a template"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className={dialogStyles.title}>Add Template</h2>

        <div className={styles.body}>
          <div
            className={styles.templateList}
            role="radiogroup"
            aria-label="Template"
          >
            {templates.map((t) => (
              <HelpTip key={t.id} id={`template.choice.${t.id}`}>
                <label className={styles.templateOption}>
                  <input
                    type="radio"
                    name="template"
                    checked={selected === t.id}
                    onChange={() => setSelected(t.id)}
                  />
                  {t.label}
                </label>
              </HelpTip>
            ))}
          </div>

          <div className={styles.options}>
            {selected === "standardPlayerObjects" && (
              <T1Fields options={t1} onChange={setT1} />
            )}
            {selected === "standardPlayerResources" && (
              <T2Fields options={t2} onChange={setT2} />
            )}
            {selected === "standardWaterResources" && (
              <T3Fields options={t3} onChange={setT3} />
            )}
            {selected === "playerForestsObjects" && (
              <T4Fields
                options={t4}
                onChange={setT4}
                setupPresent={script.forestSetupPresent}
                forestTerrains={forestTerrains}
                trees={trees}
              />
            )}
            {selected === "playerForestsTerrain" && (
              <T5Fields
                options={t5}
                onChange={setT5}
                imported={script.playerLand}
                forestTerrains={forestTerrains}
              />
            )}
            {problems.length > 0 && (
              <ul className={styles.problems}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <HelpTip id="template.preview">
          <pre className={styles.preview}>{previewText}</pre>
        </HelpTip>

        <div className={dialogStyles.actions}>
          <HelpTip id="template.cancel">
            <button
              type="button"
              className={dialogStyles.closeButton}
              onClick={onClose}
            >
              Cancel
            </button>
          </HelpTip>
          <HelpTip id="template.insert">
            <button
              type="button"
              className={`${dialogStyles.closeButton} ${styles.primary}`}
              disabled={insertDisabled}
              onClick={() => {
                if (insertDisabled) return;
                onInsert(rendered);
              }}
            >
              Insert
            </button>
          </HelpTip>
        </div>
      </div>
    </div>
  );
}

function T1Fields({
  options,
  onChange,
}: {
  options: T1Options;
  onChange: (next: T1Options) => void;
}) {
  return (
    <>
      <HelpTip id="template.t1.quickStart">
        <label className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            checked={options.quickStart}
            onChange={(e) =>
              onChange({
                ...options,
                quickStart: e.target.checked,
                advanced: e.target.checked && options.advanced,
              })
            }
          />
          Quick-start (9 villagers)
        </label>
      </HelpTip>
      <HelpTip id="template.t1.advanced">
        <label className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            disabled={!options.quickStart}
            checked={options.advanced}
            onChange={(e) =>
              onChange({ ...options, advanced: e.target.checked })
            }
          />
          Advanced implementation (precise villager placement)
        </label>
      </HelpTip>
      <TerrainField
        helpId="template.t1.terrain"
        value={options.terrainToPlaceOn}
        onChange={(v) => onChange({ ...options, terrainToPlaceOn: v })}
      />
    </>
  );
}

function T2Fields({
  options,
  onChange,
}: {
  options: T2Options;
  onChange: (next: T2Options) => void;
}) {
  return (
    <>
      <HelpTip id="template.t2.seasonal">
        <label className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            checked={options.seasonal}
            onChange={(e) =>
              onChange({ ...options, seasonal: e.target.checked })
            }
          />
          Seasonal variation
        </label>
      </HelpTip>
      <HelpTip id="template.t2.berryType">
        <label className={dialogStyles.optionRow}>
          Berry type
          <select
            value={options.berryType}
            disabled={options.seasonal}
            onChange={(e) =>
              onChange({
                ...options,
                berryType: e.target.value as T2Options["berryType"],
              })
            }
          >
            {BERRY_OPTIONS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </HelpTip>
      <HelpTip id="template.t2.wildlife">
        <label className={dialogStyles.optionRow}>
          Herdable
          <select
            value={options.herdable}
            disabled={options.seasonal}
            onChange={(e) =>
              onChange({
                ...options,
                herdable: e.target.value as T2Options["herdable"],
              })
            }
          >
            {HERDABLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </HelpTip>
      <HelpTip id="template.t2.wildlife">
        <label className={dialogStyles.optionRow}>
          Huntable
          <select
            value={options.huntable}
            disabled={options.seasonal}
            onChange={(e) =>
              onChange({
                ...options,
                huntable: e.target.value as T2Options["huntable"],
              })
            }
          >
            {HUNTABLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </HelpTip>
      <HelpTip id="template.t2.wildlife">
        <label className={dialogStyles.optionRow}>
          Lurable
          <select
            value={options.lurable}
            disabled={options.seasonal}
            onChange={(e) =>
              onChange({
                ...options,
                lurable: e.target.value as T2Options["lurable"],
              })
            }
          >
            {LURABLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </HelpTip>
      <TerrainField
        helpId="template.t2.terrain"
        value={options.terrainToPlaceOn}
        onChange={(v) => onChange({ ...options, terrainToPlaceOn: v })}
      />
    </>
  );
}

function T3Fields({
  options,
  onChange,
}: {
  options: T3Options;
  onChange: (next: T3Options) => void;
}) {
  return (
    <>
      <HelpTip id="template.t3.oysters">
        <label className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            checked={options.oysters}
            onChange={(e) =>
              onChange({ ...options, oysters: e.target.checked })
            }
          />
          Oysters
        </label>
      </HelpTip>
      <HelpTip id="template.t3.whales">
        <label className={dialogStyles.optionRow}>
          <input
            type="checkbox"
            checked={options.whales}
            onChange={(e) => onChange({ ...options, whales: e.target.checked })}
          />
          Whales
        </label>
      </HelpTip>
    </>
  );
}

// The two forest templates have more text fields than T1-T3, so the label,
// input and HelpTip wrapper live in one place. `invalid` only colours the
// box; the reason is written out in the dialog's problems list.
function TextField({
  helpId,
  label,
  value,
  onChange,
  invalid = false,
  disabled = false,
  placeholder,
}: {
  helpId: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <HelpTip id={helpId}>
      <label className={dialogStyles.optionRow}>
        {label}
        <input
          type="text"
          className={`${styles.shortInput} ${invalid ? styles.invalidInput : ""}`}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </label>
    </HelpTip>
  );
}

// The <option> value that means "let me type my own". Parentheses can't
// appear in an RMS name, so no real constant can ever collide with it, which
// is the whole requirement for a sentinel (an empty string would collide
// with a cleared field).
const CUSTOM_OPTION = "(custom)";

function SelectField({
  helpId,
  label,
  value,
  options,
  onChange,
  disabled = false,
  customHelpId,
}: {
  helpId: string;
  label: string;
  value: string;
  options: readonly NamedOption[];
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Set to offer a "Custom…" entry that opens a text box for any name or id. */
  customHelpId?: string;
}) {
  // Custom mode is its own piece of local state rather than derived from
  // "is the value in the list". Derived, typing FOREST on the way to
  // FOREST_TERRAIN would match a list entry for one keystroke, flip the
  // select back to it and unmount the text box under the user's cursor.
  // The initializer still derives it once, so a value that is already off
  // the list opens in custom mode when the template is reselected.
  const [custom, setCustom] = useState(
    () => customHelpId !== undefined && !options.some((o) => o.value === value),
  );
  return (
    <>
      <HelpTip id={helpId}>
        <label className={dialogStyles.optionRow}>
          {label}
          <select
            value={custom ? CUSTOM_OPTION : value}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === CUSTOM_OPTION) {
                // Keep the current choice as the text box's starting value,
                // so picking Custom… on FOREST gives something to edit.
                setCustom(true);
                return;
              }
              setCustom(false);
              onChange(e.target.value);
            }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {customHelpId !== undefined && (
              <option value={CUSTOM_OPTION}>Custom…</option>
            )}
          </select>
        </label>
      </HelpTip>
      {custom && customHelpId !== undefined && (
        <TextField
          helpId={customHelpId}
          label="Name or id"
          value={value}
          onChange={onChange}
          invalid={!isNameOrId(value)}
          disabled={disabled}
          placeholder="e.g. MY_FOREST"
        />
      )}
    </>
  );
}

const notWhole = (s: string) => !/^\d+$/.test(s);

function T4Fields({
  options,
  onChange,
  setupPresent,
  forestTerrains,
  trees,
}: {
  options: T4Options;
  onChange: (next: T4Options) => void;
  setupPresent: boolean;
  forestTerrains: readonly NamedOption[];
  trees: readonly NamedOption[];
}) {
  // `keyof T4Options` narrows `field` to the object's own property names,
  // so a typo in a call below is a compile error. The computed key
  // `[field]` then writes whichever one was named.
  const set = (field: keyof T4Options) => (value: string) =>
    onChange({ ...options, [field]: value });
  return (
    <>
      {setupPresent && (
        <p className={styles.note}>
          This script already defines {FOREST_MAKER_CONST}, so only the
          create_object is inserted. The stand-in id and forest terrain come
          from the existing lines.
        </p>
      )}
      <TextField
        helpId="template.t4.standInId"
        label="Stand-in object id"
        value={options.standInId}
        onChange={set("standInId")}
        invalid={!setupPresent && notWhole(options.standInId)}
        disabled={setupPresent}
      />
      <SelectField
        helpId="template.t4.forestTerrain"
        customHelpId="template.t4.forestTerrainCustom"
        label="Forest terrain"
        value={options.forestTerrain}
        options={forestTerrains}
        onChange={set("forestTerrain")}
        disabled={setupPresent}
      />
      <SelectField
        helpId="template.t4.tree"
        customHelpId="template.t4.treeCustom"
        label="Tree"
        value={options.tree}
        options={trees}
        onChange={set("tree")}
      />
      <TextField
        helpId="template.t4.forestsPerPlayer"
        label="Forests per player"
        value={options.forestsPerPlayer}
        onChange={set("forestsPerPlayer")}
        invalid={notWhole(options.forestsPerPlayer)}
      />
      <TextField
        helpId="template.t4.treesPerForest"
        label="Trees per forest"
        value={options.treesPerForest}
        onChange={set("treesPerForest")}
        invalid={notWhole(options.treesPerForest)}
      />
      <TextField
        helpId="template.t4.minDistance"
        label="Minimum distance to player"
        value={options.minDistance}
        onChange={set("minDistance")}
        invalid={notWhole(options.minDistance)}
      />
      <TextField
        helpId="template.t4.maxDistance"
        label="Maximum distance to player"
        value={options.maxDistance}
        onChange={set("maxDistance")}
        invalid={notWhole(options.maxDistance)}
      />
      <TerrainField
        helpId="template.t4.terrain"
        value={options.terrainToPlaceOn}
        onChange={set("terrainToPlaceOn")}
      />
    </>
  );
}

function T5Fields({
  options,
  onChange,
  imported,
  forestTerrains,
}: {
  options: T5Options;
  onChange: (next: T5Options) => void;
  /** What the script's create_player_lands uses, shown so an override is visible as one. */
  imported: string | undefined;
  forestTerrains: readonly NamedOption[];
}) {
  const set = (field: keyof T5Options) => (value: string) =>
    onChange({ ...options, [field]: value });
  return (
    <>
      <TextField
        helpId="template.t5.playerLand"
        label="Player land terrain"
        value={options.playerLand}
        onChange={set("playerLand")}
        invalid={options.playerLand === ""}
        placeholder="e.g. GRASS"
      />
      <p className={styles.note}>
        {imported === undefined
          ? "No create_player_lands terrain_type found in this script."
          : options.playerLand === imported
            ? `Read from create_player_lands.`
            : `The script's create_player_lands uses ${imported}.`}
      </p>
      <SelectField
        helpId="template.t5.forestTerrain"
        customHelpId="template.t5.forestTerrainCustom"
        label="Forest terrain"
        value={options.forestTerrain}
        options={forestTerrains}
        onChange={set("forestTerrain")}
      />
      <TextField
        helpId="template.t5.forestTiles"
        label="Forest tiles per player"
        value={options.forestTiles}
        onChange={set("forestTiles")}
        invalid={notWhole(options.forestTiles)}
      />
      <TextField
        helpId="template.t5.forestClumps"
        label="Forest clumps per player"
        value={options.forestClumps}
        onChange={set("forestClumps")}
        invalid={notWhole(options.forestClumps)}
      />
      <TextField
        helpId="template.t5.minDistance"
        label="Minimum distance to player"
        value={options.minDistance}
        onChange={set("minDistance")}
        invalid={notWhole(options.minDistance)}
      />
      <TextField
        helpId="template.t5.maxDistance"
        label="Maximum distance to player"
        value={options.maxDistance}
        onChange={set("maxDistance")}
        invalid={notWhole(options.maxDistance)}
      />
    </>
  );
}

function TerrainField({
  helpId,
  value,
  onChange,
}: {
  helpId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const invalid = value !== "" && !isValidIdentifier(value);
  return (
    <HelpTip id={helpId}>
      <label className={dialogStyles.optionRow}>
        Terrain to place on
        <input
          type="text"
          placeholder="e.g. GRASS"
          className={invalid ? styles.invalidInput : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </label>
    </HelpTip>
  );
}
