#!/usr/bin/env node
// Validates reference/data/*.json against reference/schemas/*.schema.json,
// plus referential-integrity checks JSON Schema alone can't express:
// command attributes[] and attribute requiresSections[] references must
// resolve within language.json. Run via `npm run validate:reference`;
// wired into CI (see .github/workflows/ci.yml).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const FILES = [
  { schema: "game-constants.schema.json", data: "game-constants.json" },
  { schema: "language.schema.json", data: "language.json" },
  { schema: "doc-strings.schema.json", data: "doc-strings.json" },
  { schema: "ui-help.schema.json", data: "ui-help.json" },
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf-8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: true });

let hadError = false;
let languageData = null;

for (const { schema, data } of FILES) {
  const schemaPath = path.join("reference/schemas", schema);
  const dataPath = path.join("reference/data", data);

  let schemaJson;
  let dataJson;
  try {
    schemaJson = readJson(schemaPath);
    dataJson = readJson(dataPath);
  } catch (error) {
    console.error(`✗ ${dataPath}: failed to read/parse — ${error.message}`);
    hadError = true;
    continue;
  }

  const validate = ajv.compile(schemaJson);
  const valid = validate(dataJson);

  if (!valid) {
    hadError = true;
    console.error(`✗ ${dataPath} does not match ${schemaPath}:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "(root)"} ${err.message}`);
    }
  } else {
    console.log(`✓ ${dataPath} matches ${schemaPath}`);
  }

  if (data === "language.json") {
    languageData = dataJson;
  }
}

// Referential integrity: every attribute name a command lists must exist
// in the top-level attributes[] array, and every required section must
// exist in sections[].
if (languageData) {
  const attributeNames = new Set(languageData.attributes.map((a) => a.name));
  const sectionNames = new Set(languageData.sections);
  let refsOk = true;
  for (const command of languageData.commands) {
    for (const attrName of command.attributes ?? []) {
      if (!attributeNames.has(attrName)) {
        hadError = true;
        refsOk = false;
        console.error(
          `✗ language.json: command "${command.name}" references unknown attribute "${attrName}"`,
        );
      }
    }
  }
  for (const attribute of languageData.attributes) {
    for (const sectionName of attribute.requiresSections ?? []) {
      if (!sectionNames.has(sectionName)) {
        hadError = true;
        refsOk = false;
        console.error(
          `✗ language.json: attribute "${attribute.name}" requires unknown section "${sectionName}"`,
        );
      }
    }
  }
  if (refsOk) {
    console.log("✓ language.json: all command→attribute and attribute→section references resolve");
  }
}

if (hadError) {
  console.error("\nreference data validation FAILED");
  process.exit(1);
}

console.log("\nreference data validation passed");
