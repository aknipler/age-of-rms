import * as monaco from "monaco-editor";
import languageData from "../../reference/data/language.json";

// Registers a custom "aoe2-rms" Monaco language: a Monarch tokenizer
// (a regex-based state machine — intentionally simple/fast rather than a
// real parser, since Monaco re-tokenizes on every keystroke). This is
// *only* for coloring. The real parser lands in Phase 2 and becomes the
// source of truth for whether a script is actually valid; this file has
// no opinion on that.
//
// COMMANDS/ATTRIBUTES/CONTROL_KEYWORDS are generated from
// reference/data/language.json (Phase 1.5) rather than hand-duplicated —
// that file is the source of truth now, including its per-entry
// "verified" flags (see CLAUDE.md and CREATION_PLAN.md's population
// step). Highlighting doesn't distinguish verified from unverified
// entries; it just needs the name to color it correctly, so everything
// in language.json is included here regardless of verification status.
const COMMANDS = languageData.commands.map((command) => command.name);
const ATTRIBUTES = languageData.attributes.map((attribute) => attribute.name);
const CONTROL_KEYWORDS = languageData.controlKeywords.map((keyword) => keyword.name);

const monarchLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".rms",
  ignoreCase: false,

  controlKeywords: CONTROL_KEYWORDS,
  commands: COMMANDS,
  attributes: ATTRIBUTES,

  tokenizer: {
    root: [
      { include: "@whitespace" },

      [/[{}]/, "@brackets"],

      // Section headers, e.g. <PLAYER_SETUP>
      [/<[A-Z_]+>/, "tag"],

      // Preprocessor directives, e.g. #const, #define, #include_drs.
      // Pattern-based rather than a keyword list — there aren't many,
      // but the # prefix alone reliably identifies them.
      [/#\w+/, "keyword.directive"],

      // ALL_CAPS identifiers are constants (built-in or #const-defined)
      // — pattern-based rather than an exhaustive list, since RMS
      // constants number in the hundreds and follow this convention
      // reliably. Must come before the generic identifier rule below.
      [/\b[A-Z][A-Z0-9_]*\b/, "constant"],

      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@controlKeywords": "keyword.control",
            "@commands": "keyword",
            "@attributes": "type.identifier",
            "@default": "identifier",
          },
        },
      ],

      [/-?\d+(\.\d+)?/, "number"],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*/, "comment", "@comment"],
    ],

    // Block comments don't nest in RMS but do span multiple lines.
    comment: [
      [/[^*/]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[*/]/, "comment"],
    ],
  },
};

// Monaco's *built-in* theme rules (the "vs" light theme it defaults to)
// are tuned for JS/TS-style scopes and don't know about our token names
// at all — several ended up mapped to similar colors by coincidence
// (e.g. "number" and "type.identifier" both landing on muted
// green/teal), which is why attributes and numbers looked the same and
// comments were hard to tell from other green-ish tokens. This theme
// explicitly assigns each of our token categories its own hue instead of
// leaving it to chance, still built on top of the light "vs" base so the
// rest of the editor chrome matches the app's black-on-white look.
export const AOE2_RMS_THEME = "aoe2-rms-light";

function defineAoe2RmsTheme() {
  monaco.editor.defineTheme(AOE2_RMS_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A737D", fontStyle: "italic" },
      { token: "tag", foreground: "22863A", fontStyle: "bold" }, // section headers
      { token: "keyword.directive", foreground: "6F42C1" }, // #define etc.
      { token: "keyword.control", foreground: "005CC5", fontStyle: "bold" }, // if/start_random etc.
      { token: "keyword", foreground: "B31D28", fontStyle: "bold" }, // commands
      { token: "type.identifier", foreground: "E36209" }, // attributes
      { token: "constant", foreground: "0B7285" }, // ALL_CAPS constants
      { token: "number", foreground: "24292E", fontStyle: "bold" },
    ],
    colors: {},
  });
}

export function registerAoe2RmsLanguage() {
  monaco.languages.register({ id: "aoe2-rms" });
  monaco.languages.setMonarchTokensProvider("aoe2-rms", monarchLanguage);
  monaco.languages.setLanguageConfiguration("aoe2-rms", {
    comments: { blockComment: ["/*", "*/"] },
    brackets: [["{", "}"]],
    autoClosingPairs: [{ open: "{", close: "}" }],
  });
  defineAoe2RmsTheme();
}
