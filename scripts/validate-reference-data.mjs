#!/usr/bin/env node
// Validates reference/data/*.json against reference/schemas/*.schema.json,
// plus a referential-integrity check JSON Schema alone can't express: a
// command's attributes[] must all exist in language.json's top-level
// attributes[] array. Run via `npm run validate:reference`; wired into CI
// (see .github/workflows/ci.yml).

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
// in the top-level attributes[] array.
if (languageData) {
  const attributeNames = new Set(languageData.attributes.map((a) => a.name));
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
  if (refsOk) {
    console.log("✓ language.json: all command→attribute references resolve");
  }

  // Internal consistency: a numeric `default` must satisfy the `min`/`max` the
  // same argument declares. Schema alone cannot express this — it can type all
  // three fields correctly while they contradict each other.
  //
  // This check exists because that contradiction shipped twice, identically.
  // `base_elevation.level` and `create_elevation.maxHeight` both carried
  // min 1 / max 16 / default 0, transcribed from a guide line that reads
  // "number (1-16) (default: 0 - not elevated)" — the parenthesised range was
  // copied and the sentence next to it, which documents 0 as the legal value
  // meaning "flat", was not. RMS0203 then false-warned on all 461 corpus uses
  // of `base_elevation 0`. A declared default outside a declared range is
  // always one of the two being wrong, so it is worth failing CI over.
  let rangesOk = true;
  for (const kind of ["commands", "attributes", "directives"]) {
    for (const entry of languageData[kind] ?? []) {
      for (const arg of entry.arguments ?? []) {
        if (typeof arg.default !== "number") continue;
        const belowMin = typeof arg.min === "number" && arg.default < arg.min;
        const aboveMax = typeof arg.max === "number" && arg.default > arg.max;
        if (belowMin || aboveMax) {
          hadError = true;
          rangesOk = false;
          const range = `min ${arg.min ?? "—"} / max ${arg.max ?? "—"}`;
          console.error(
            `✗ language.json: ${entry.name}.${arg.name} declares default ${arg.default}, outside its own ${range}`,
          );
        }
      }
    }
  }
  if (rangesOk) {
    console.log("✓ language.json: every declared default falls inside its declared range");
  }

  checkMapSizeJoin(languageData);
}

// `MAP_SIZES` (TypeScript) ⟷ `predefinedLabels` (JSON): the join that carries
// every map dimension in the project.
//
// `generationSettingsConstants.ts` deliberately holds only the size *names*,
// because "Huge is 240" is not a fact — it depends on which naming era you are
// in. `HUGE_MAP` is 220 and `MAPSIZE_HUGE` is 240; the legacy and modern names
// are offset by one size from Normal upward. A `tiles` field on MAP_SIZES would
// be a true-looking statement sitting beside data that says something different
// and equally true, which is exactly how that offset gets mis-transcribed.
//
// The split is right, and until now nothing paid for it. Every consumer that
// needs a dimension resolves it through this join at runtime, `dimensions` is
// optional on `PredefinedLabel`, and no check anywhere confirmed the join
// closes. These four assertions are the cost of keeping the two apart.
//
// Reading TypeScript source from a validation script follows the pattern
// `check-breakdown-prereqs.mjs` already established. The alternative — a second
// copy of the size list in JSON — is the very duplication being guarded against.
function checkMapSizeJoin(languageData) {
  const sourcePath = "src/generationSettings/generationSettingsConstants.ts";
  let sizes;
  try {
    const source = readFileSync(path.join(repoRoot, sourcePath), "utf-8");
    const block = source.match(/export const MAP_SIZES = \[([\s\S]*?)\] as const;/);
    if (!block) throw new Error("could not find the `export const MAP_SIZES = [...] as const;` declaration");
    sizes = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (sizes.length === 0) throw new Error("MAP_SIZES parsed as empty");
  } catch (error) {
    hadError = true;
    console.error(`✗ ${sourcePath}: ${error.message}`);
    return;
  }

  const byMapSize = new Map();
  for (const label of languageData.predefinedLabels ?? []) {
    if (label.category !== "mapSize" || label.mapSize == null) continue;
    if (!byMapSize.has(label.mapSize)) byMapSize.set(label.mapSize, []);
    byMapSize.get(label.mapSize).push(label);
  }

  let ok = true;
  const fail = (message) => {
    hadError = true;
    ok = false;
    console.error(`✗ ${message}`);
  };

  const resolved = [];
  for (const size of sizes) {
    const labels = byMapSize.get(size) ?? [];
    if (labels.length === 0) {
      // A size the picker offers that no label claims. The preview would resolve
      // its dimension to undefined and scale the whole map off it.
      fail(`MAP_SIZES has "${size}" but no language.json mapSize label carries mapSize: "${size}"`);
      continue;
    }
    const missing = labels.filter((l) => typeof l.dimensions !== "number");
    for (const label of missing) {
      fail(`language.json: "${label.name}" claims mapSize "${size}" but declares no dimensions`);
    }
    const dims = new Set(labels.filter((l) => typeof l.dimensions === "number").map((l) => l.dimensions));
    if (dims.size > 1) {
      // The legacy and modern names for one app size must agree on the number.
      // If they disagree, the join has two answers and which one a consumer
      // gets depends on iteration order.
      const detail = labels.map((l) => `${l.name}=${l.dimensions}`).join(", ");
      fail(`language.json: mapSize "${size}" resolves to conflicting dimensions (${detail})`);
    }
    if (dims.size === 1) resolved.push({ size, dim: [...dims][0] });
  }

  // Orphan check, the other direction. A typo in a label's `mapSize` string
  // silently detaches it from the picker instead of erroring.
  for (const [size, labels] of byMapSize) {
    if (sizes.includes(size)) continue;
    fail(
      `language.json: ${labels.map((l) => `"${l.name}"`).join(", ")} claims mapSize "${size}", ` +
        `which is not in MAP_SIZES (offer it in the picker, or drop the field as sizes reachable only via MORE_MAP_SIZES do)`,
    );
  }

  // Ordering. MAP_SIZES is displayed in array order and is hand-sorted by
  // dimension, which is NOT the order the names suggest — Giant (252) sorts
  // after Huge (240). That comment was load-bearing and unchecked until here:
  // the array shipped with Giant before Huge until 2026-08-01 (Sec.15 item 6).
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i].dim <= resolved[i - 1].dim) {
      fail(
        `MAP_SIZES is not ascending by dimension: "${resolved[i - 1].size}" (${resolved[i - 1].dim}) ` +
          `is listed before "${resolved[i].size}" (${resolved[i].dim})`,
      );
    }
  }

  if (ok) {
    const summary = resolved.map((r) => `${r.size} ${r.dim}`).join(", ");
    console.log(`✓ MAP_SIZES ⟷ predefinedLabels: ${resolved.length} sizes resolve, ascending (${summary})`);
  }
}

if (hadError) {
  console.error("\nreference data validation FAILED");
  process.exit(1);
}

console.log("\nreference data validation passed");
