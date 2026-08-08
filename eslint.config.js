import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  // Purity rule (CLAUDE.md hard rule; preview-design.md Sec.8 closes the gap
  // this had been resting on unenforced): src/parser/**, src/breakdown/patch/**
  // and src/preview/generator/** must run unchanged in a bare web worker and in
  // plain-Node Vitest. Deliberately does NOT catch
  // src/generationSettings/generationSettingsConstants.ts or teamModel.ts —
  // those are plain modules the generator is allowed to import (Sec.2).
  {
    files: [
      "src/parser/**/*.ts",
      "src/breakdown/patch/**/*.ts",
      "src/preview/generator/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message:
                "This module must stay pure (no React/Monaco/Tauri) — it runs in a bare web worker and in plain-Node Vitest.",
            },
            {
              name: "react-dom",
              message:
                "This module must stay pure (no React/Monaco/Tauri) — it runs in a bare web worker and in plain-Node Vitest.",
            },
            {
              name: "monaco-editor",
              message:
                "This module must stay pure (no React/Monaco/Tauri) — it runs in a bare web worker and in plain-Node Vitest.",
            },
          ],
          patterns: [
            {
              group: ["@monaco-editor/*"],
              message:
                "This module must stay pure (no React/Monaco/Tauri) — it runs in a bare web worker and in plain-Node Vitest.",
            },
            {
              group: ["@tauri-apps/*"],
              message:
                "This module must stay pure (no React/Monaco/Tauri) — it runs in a bare web worker and in plain-Node Vitest.",
            },
          ],
        },
      ],
    },
  },
  // Determinism rule (preview-design.md Sec.8, goal 5): the generator's
  // byte-for-byte-across-engines claim only holds if it never calls a Math
  // function ECMAScript leaves implementation-defined to the last bits.
  // floor/round/abs/min/max/sign/trunc are exact and stay allowed; Math.imul
  // is exact 32-bit integer multiply and is how rng.ts's PRNG works.
  {
    files: ["src/preview/generator/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...[
          "random",
          "sin",
          "cos",
          "tan",
          "pow",
          "sqrt",
          "cbrt",
          "hypot",
          "log",
          "log2",
          "log10",
          "exp",
          "atan2",
        ].map((property) => ({
          object: "Math",
          property,
          message: `Math.${property} is implementation-defined in its last bits (preview-design.md Sec.8) — breaks the byte-for-byte-across-engines determinism goal. Use rng.ts's precomputed tables / integer arithmetic instead.`,
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**']",
          message:
            "'**' is implementation-defined like Math.pow (preview-design.md Sec.8). Use integer arithmetic instead.",
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message:
            "'**=' is implementation-defined like Math.pow (preview-design.md Sec.8). Use integer arithmetic instead.",
        },
      ],
    },
  },
);
