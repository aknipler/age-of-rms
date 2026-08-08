// One-off generator for src/preview/generator/sineTable.ts.
// Run with plain Node — this script itself is NOT under the Sec.8 lint
// scope (it lives outside src/preview/generator/), so Math.sin/cos here are
// fine: they compute the table ONCE, offline, and the output is committed
// as literal data. Nothing at runtime calls Math.sin/cos.
import { writeFileSync } from "node:fs";

const SIZE = 3600; // 0.1 degree resolution — matches preview-design.md
                    // Sec.8's "indexed by floor(3600*k/N)"
const SCALE = 10000; // fixed-point: value = round(sin(theta) * SCALE)

const sin = new Array(SIZE);
const cos = new Array(SIZE);
for (let i = 0; i < SIZE; i++) {
  const theta = (2 * Math.PI * i) / SIZE;
  sin[i] = Math.round(Math.sin(theta) * SCALE);
  cos[i] = Math.round(Math.cos(theta) * SCALE);
}

function chunk(arr, n) {
  const lines = [];
  for (let i = 0; i < arr.length; i += n) {
    lines.push("  " + arr.slice(i, i + n).join(",") + ",");
  }
  return lines.join("\n");
}

const header = `// Precomputed fixed-point sine/cosine table — preview-design.md Sec.8.
//
// The generator must never call Math.sin/Math.cos at runtime (ECMAScript
// leaves their last bits implementation-defined, which would break the
// byte-for-byte-across-engines determinism goal 5 is built on). This table
// is computed OFFLINE, once, by scripts/gen-sine-table.mjs and checked in as
// literal data — regenerating it never changes its values, since the script
// is deterministic and its output is what "checked in as data" means.
//
// SINE_TABLE_SIZE entries span one full turn (index 0 = angle 0). Index a
// fraction-of-a-circle k/N (e.g. "player i of N evenly spaced around a
// ring") with sineAt(k, N) / cosAt(k, N) from rng.ts, which does the
// floor(SINE_TABLE_SIZE * k / N) lookup. Values are fixed-point, scaled by
// SINE_SCALE (so a value of 10000 means 1.0); divide by SINE_SCALE only at
// the point a float is genuinely needed (e.g. feeding the canvas renderer),
// never inside a comparison that could instead stay in scaled-integer space.

export const SINE_TABLE_SIZE = ${SIZE};
export const SINE_SCALE = ${SCALE};

export const SIN_TABLE: readonly number[] = [
${chunk(sin, 20)}
];

export const COS_TABLE: readonly number[] = [
${chunk(cos, 20)}
];
`;

writeFileSync(process.argv[2], header);
console.log("wrote", process.argv[2], "sin[0]=", sin[0], "cos[0]=", cos[0], "sin[900]=", sin[900], "cos[900]=", cos[900]);
