import * as monaco from "monaco-editor";
import languageData from "../../reference/data/language.json";

// Registers a custom "aoe2-rms" Monaco language: a Monarch tokenizer
// (a regex-based state machine, intentionally simple/fast rather than a
// real parser, since Monaco re-tokenizes on every keystroke). This is
// *only* for coloring. The real parser lands in Phase 2 and becomes the
// source of truth for whether a script is actually valid; this file has
// no opinion on that.
//
// COMMANDS/ATTRIBUTES/CONTROL_KEYWORDS are generated from
// reference/data/language.json (Phase 1.5) rather than hand-duplicated.
// That file is the source of truth now, including its per-entry
// "verified" flags (see CLAUDE.md and CREATION_PLAN.md's population
// step). Highlighting doesn't distinguish verified from unverified
// entries; it just needs the name to color it correctly, so everything
// in language.json is included here regardless of verification status.
const COMMANDS = languageData.commands.map((command) => command.name);
const ATTRIBUTES = languageData.attributes.map((attribute) => attribute.name);
const CONTROL_KEYWORDS = languageData.controlKeywords.map(
  (keyword) => keyword.name,
);

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
      // Pattern-based rather than a keyword list. There aren't many,
      // but the # prefix alone reliably identifies them.
      [/#\w+/, "keyword.directive"],

      // ALL_CAPS identifiers are constants (built-in or #const-defined),
      // pattern-based rather than an exhaustive list, since RMS
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

// Token coloring itself lives in monacoTheme.ts, not here. It needs to be
// recomputed from the app's live theme tokens (Theme settings tab, incl.
// custom/dark themes), not fixed once at registration time the way the
// Monarch tokenizer above is.
export function registerAoe2RmsLanguage() {
  monaco.languages.register({ id: "aoe2-rms" });
  monaco.languages.setMonarchTokensProvider("aoe2-rms", monarchLanguage);
  monaco.languages.setLanguageConfiguration("aoe2-rms", {
    comments: { blockComment: ["/*", "*/"] },
    brackets: [["{", "}"]],
    autoClosingPairs: [{ open: "{", close: "}" }],
  });
}
