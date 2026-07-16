import * as monaco from "monaco-editor";
import { load } from "@tauri-apps/plugin-store";
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsDataRaw from "../../reference/data/game-constants.json";
import docStringsDataRaw from "../../reference/data/doc-strings.json";
import { HELP_MODE_KEY, HELP_STORE_FILE, isHelpMode } from "../help/helpConstants";

// Explicit types + a cast, rather than relying on TypeScript's inferred
// JSON-literal types directly: with a heterogeneous array (some entries
// have "arguments", some don't, etc.) TS infers a union of per-element
// literal types, and accessing an optional field that's absent on some
// union members is a type error. `npm run validate:reference` already
// guarantees these files match reference/schemas/*.schema.json, so the
// cast is asserting something already enforced elsewhere, not bypassing
// real safety.
interface Argument {
  name: string;
  type: string;
  min?: number;
  max?: number;
  default?: unknown;
  description?: string;
}
interface Command {
  name: string;
  section: string;
  kind: "block" | "standalone";
  description: string;
  arguments?: Argument[];
  attributes?: string[];
  verified: boolean;
  notes?: string;
}
interface AttributeDef {
  name: string;
  arguments?: Argument[];
  mutexWith?: string[];
  description: string;
  verified: boolean;
  notes?: string;
}
interface Directive {
  name: string;
  arguments?: Argument[];
  description: string;
  verified: boolean;
  notes?: string;
}
interface ControlKeyword {
  name: string;
  description: string;
  verified: boolean;
}
interface LanguageData {
  sections: string[];
  commands: Command[];
  attributes: AttributeDef[];
  directives: Directive[];
  controlKeywords: ControlKeyword[];
}

interface GameConstant {
  constId: number | null;
  rmsConstant: string;
  descriptiveName: string;
  category: "terrain" | "object";
  deTextureFile: string | null;
  resourceAmounts?: { food?: number; wood?: number; gold?: number; stone?: number };
  verified: boolean;
  notes?: string;
}
interface GameConstantsData {
  constants: GameConstant[];
}

interface DocEntry {
  key: string;
  kind: "command" | "attribute" | "directive" | "controlKeyword" | "constant" | "ui";
  summary: string;
  details?: string;
  seeAlso?: string[];
}
interface DocStringsData {
  entries: DocEntry[];
}

const languageData = languageDataRaw as LanguageData;
const gameConstantsData = gameConstantsDataRaw as GameConstantsData;
const docStringsData = docStringsDataRaw as DocStringsData;

const COMMANDS_BY_NAME = new Map(languageData.commands.map((c) => [c.name, c]));
const ATTRIBUTES_BY_NAME = new Map(languageData.attributes.map((a) => [a.name, a]));
const DIRECTIVES_BY_NAME = new Map(languageData.directives.map((d) => [d.name, d]));
const CONTROL_KEYWORDS_BY_NAME = new Map(languageData.controlKeywords.map((k) => [k.name, k]));
const CONSTANTS_BY_NAME = new Map(gameConstantsData.constants.map((c) => [c.rmsConstant, c]));
const DOC_STRINGS_BY_KEY = new Map(docStringsData.entries.map((e) => [e.key, e]));
const SECTION_NAMES = new Set(languageData.sections);

function formatArgument(arg: Argument): string {
  if (arg.min !== undefined || arg.max !== undefined) {
    return `<${arg.name}: ${arg.min ?? "?"}-${arg.max ?? "?"}>`;
  }
  return `<${arg.name}: ${arg.type}>`;
}

function formatCommandSignature(command: Command): string {
  const args = (command.arguments ?? []).map(formatArgument).join(" ");
  const head = args ? `${command.name} ${args}` : command.name;
  return command.kind === "block" ? `${head} { ... }` : head;
}

function formatAttributeSignature(entry: { name: string; arguments?: Argument[] }): string {
  const args = (entry.arguments ?? []).map(formatArgument).join(" ");
  return args ? `${entry.name} ${args}` : entry.name;
}

// Builds the hover popup body: a code-block signature, then the doc
// string (falling back to language.json's own description if
// reference/data/doc-strings.json doesn't have an entry yet), then an
// unverified-data caveat when relevant so users know to double check
// against the real docs rather than trust it blindly.
function buildHoverContents(
  signature: string,
  summary: string | undefined,
  details: string | undefined,
  verified: boolean,
): monaco.IMarkdownString[] {
  const parts = ["```aoe2-rms\n" + signature + "\n```"];
  if (summary) parts.push(summary);
  if (details) parts.push(details);
  if (!verified) {
    parts.push("_Not yet verified against the official docs — see `reference/data/language.json`._");
  }
  return [{ value: parts.join("\n\n") }];
}

const FALLBACK_CONTENTS: monaco.IMarkdownString[] = [
  {
    value:
      "_No documentation yet — contribute an entry to `reference/data/doc-strings.json` (see CONTRIBUTING.md)._",
  },
];

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function registerAoe2RmsHoverProvider() {
  monaco.languages.registerHoverProvider("aoe2-rms", {
    // async: needs to check the persisted help-mode setting (same Tauri
    // store the React-side HelpSettingsContext reads/writes, see
    // src/help/helpConstants.ts) before deciding whether to show anything.
    // Monaco's hover API accepts a Promise return, so this just works —
    // the popup appears once the store read resolves rather than
    // blocking the UI thread.
    async provideHover(model, position) {
      const store = await load(HELP_STORE_FILE, { autoSave: true, defaults: {} });
      const savedMode = await store.get<string>(HELP_MODE_KEY);
      // Monaco's own hover only has an on/off toggle, not the alt-hover
      // distinction HelpTip has — so it stays visible for both "hover"
      // and "alt-hover", and only "off" suppresses it.
      if (isHelpMode(savedMode) && savedMode === "off") return null;

      const wordInfo = model.getWordAtPosition(position);
      if (!wordInfo) return null;

      const { word, startColumn, endColumn } = wordInfo;
      const lineContent = model.getLineContent(position.lineNumber);
      // getWordAtPosition excludes leading punctuation, so a directive
      // like #const is returned as just "const" — check the character
      // right before the word to reconstruct the real directive name.
      const precedingChar = lineContent.charAt(startColumn - 2);

      if (precedingChar === "#") {
        const directive = DIRECTIVES_BY_NAME.get(`#${word}`);
        if (directive) {
          const doc = DOC_STRINGS_BY_KEY.get(directive.name);
          return {
            range: new monaco.Range(position.lineNumber, startColumn - 1, position.lineNumber, endColumn),
            contents: buildHoverContents(
              formatAttributeSignature(directive),
              doc?.summary ?? directive.description,
              doc?.details,
              directive.verified,
            ),
          };
        }
      }

      const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, endColumn);

      const command = COMMANDS_BY_NAME.get(word);
      if (command) {
        const doc = DOC_STRINGS_BY_KEY.get(word);
        return {
          range,
          contents: buildHoverContents(
            formatCommandSignature(command),
            doc?.summary ?? command.description,
            doc?.details,
            command.verified,
          ),
        };
      }

      const attribute = ATTRIBUTES_BY_NAME.get(word);
      if (attribute) {
        const doc = DOC_STRINGS_BY_KEY.get(word);
        return {
          range,
          contents: buildHoverContents(
            formatAttributeSignature(attribute),
            doc?.summary ?? attribute.description,
            doc?.details,
            attribute.verified,
          ),
        };
      }

      const controlKeyword = CONTROL_KEYWORDS_BY_NAME.get(word);
      if (controlKeyword) {
        const doc = DOC_STRINGS_BY_KEY.get(word);
        return {
          range,
          contents: buildHoverContents(
            word,
            doc?.summary ?? controlKeyword.description,
            doc?.details,
            controlKeyword.verified,
          ),
        };
      }

      const constant = CONSTANTS_BY_NAME.get(word);
      if (constant) {
        const doc = DOC_STRINGS_BY_KEY.get(word);
        return {
          range,
          contents: buildHoverContents(
            `${constant.rmsConstant} — ${constant.category} constant`,
            doc?.summary ?? constant.descriptiveName,
            doc?.details,
            constant.verified,
          ),
        };
      }

      if (SECTION_NAMES.has(word)) {
        return {
          range,
          contents: buildHoverContents(
            `<${word}>`,
            "Section header — groups the commands generated during this phase of map creation.",
            undefined,
            true,
          ),
        };
      }

      if (IDENTIFIER_PATTERN.test(word)) {
        return { range, contents: FALLBACK_CONTENTS };
      }

      return null;
    },
  });
}
