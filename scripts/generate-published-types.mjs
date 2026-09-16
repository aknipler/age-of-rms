#!/usr/bin/env node
// Generates tools-api/generated/gameConstants.ts from
// reference/schemas/game-constants.schema.json, so the published
// `PublishedGameConstants` type is DERIVED from the artefact CI already
// validates rather than transcribed beside it (tools-api-design.md Sec.2).
//
// Two modes, and the second is the point:
//   node scripts/generate-published-types.mjs           writes the file
//   node scripts/generate-published-types.mjs --check    fails on drift
//
// The generated file is COMMITTED. That is what makes the requirement
// enforceable: a generated-but-ignored file is always in sync with the schema
// and therefore can never go red, so nothing would tell the author of a schema
// change that a published type moved under them. Committed + `--check` in CI
// means the day the schema gains a field, the check goes red and names the
// command that fixes it.
//
// Formatting goes through the repo's own prettier config rather than
// json-schema-to-typescript's built-in style (printWidth 120, no trailing
// commas — neither of which is what `npm run format` would produce). If the two
// disagreed, `npm run format` would rewrite the generated file and the drift
// check would then fail on a file nobody edited.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compile } from "json-schema-to-typescript";
import * as prettier from "prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SCHEMA_PATH = "reference/schemas/game-constants.schema.json";
const OUTPUT_PATH = "tools-api/generated/gameConstants.ts";
const REGENERATE = "npm run generate:types";

const checkOnly = process.argv.includes("--check");

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source: ${SCHEMA_PATH}
 * Regenerate: ${REGENERATE}   (drift is a CI failure: \`npm run check:generated-types\`)
 *
 * The published shape of reference/data/game-constants.json, as an Advanced
 * Tool receives it in \`ToolContext.referenceData.gameConstants\`. It is
 * generated so that it cannot lag the schema: a hand-written copy compiles
 * happily on the day the schema gains a field, which is the one property this
 * type exists to have (tools-api-design.md Sec.2).
 *
 * Consequences worth knowing before consuming it, all of them the schema's own:
 *  - \`rmsConstant\` is NULLABLE and on most rows it IS null — 2137 of 3011 rows
 *    are roster objects with no RMS name.
 *  - \`category\` is a union READ OUT OF THE SCHEMA, never transcribed; it has
 *    gained a member twice.
 *  - only rmsConstant/descriptiveName/category/verified are required. Every
 *    other field is optional, and absent means "never measured", which is not
 *    the same claim as a false or a null.
 *  - expect fields no consumer has heard of and do NOT prune them: \`isTree\`
 *    exists with no data row yet, and \`isCorpse\` is written only when true.
 */`;

const schema = JSON.parse(
  readFileSync(path.join(repoRoot, SCHEMA_PATH), "utf-8"),
);
const rowSchema = schema.$defs?.constant;

if (!rowSchema) {
  console.error(
    `✗ ${SCHEMA_PATH}: no $defs.constant — the row schema this type is generated from is gone.`,
  );
  process.exit(1);
}

// Compiled from the ROW schema, not the file schema: the wire carries the
// array, and `{ constants: [...] }` is a file layout the contract does not
// republish. `title` is what names the emitted interface.
const body = await compile(
  { ...rowSchema, title: "PublishedGameConstant" },
  "PublishedGameConstant",
  {
    bannerComment: "",
    // Do not invent an index signature where the schema is merely silent. The
    // schema says `additionalProperties: false` everywhere it matters, and an
    // index signature is exactly what the hand-written placeholder used to
    // swallow the difference between a field that exists and one that does not.
    additionalProperties: false,
    format: false,
  },
);

const source = `${BANNER}

${body}
/**
 * The array as \`ToolContext.referenceData.gameConstants\` carries it. Readonly
 * because the context is read-only in both transports — over the wire it is a
 * structured-clone copy, and a main-thread built-in holds the live object.
 */
export type PublishedGameConstants = readonly PublishedGameConstant[];
`;

const outputAbs = path.join(repoRoot, OUTPUT_PATH);
const prettierOptions = await prettier.resolveConfig(outputAbs);
const formatted = await prettier.format(source, {
  ...prettierOptions,
  filepath: outputAbs,
});

if (checkOnly) {
  let existing;
  try {
    existing = readFileSync(outputAbs, "utf-8");
  } catch {
    console.error(
      `✗ ${OUTPUT_PATH} is missing. Run \`${REGENERATE}\` and commit it.`,
    );
    process.exit(1);
  }
  if (existing !== formatted) {
    console.error(
      `✗ ${OUTPUT_PATH} is out of date with ${SCHEMA_PATH}.\n` +
        `  The schema changed (or the file was hand-edited). Run \`${REGENERATE}\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`✓ ${OUTPUT_PATH} matches ${SCHEMA_PATH}`);
} else {
  mkdirSync(path.dirname(outputAbs), { recursive: true });
  writeFileSync(outputAbs, formatted, "utf-8");
  console.log(`✓ wrote ${OUTPUT_PATH} from ${SCHEMA_PATH}`);
}
