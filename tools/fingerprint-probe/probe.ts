// Spike S8 probe, MinHash fingerprint calibration on the local corpus
// (docs/community-maps-design.md Sec.4.6). Dev only, never imported by the
// app. See README.md beside it for how to run it and what it printed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { tokenize } from "../../src/parser/lexer";

const ROOT = process.cwd();
const DE =
  process.env.AOE2DE_COMMON ??
  "C:/Program Files (x86)/Steam/steamapps/common/AoE2DE/resources/_common";

function listRms(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.rms2?$/i.test(f))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
}

function tokensOf(path: string): string[] {
  const src = readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
  const { tokens } = tokenize(src);
  return tokens
    .filter(
      (t) =>
        !t.isTrivia && t.kind !== "commentOpen" && t.kind !== "commentClose",
    )
    .map((t) => t.text);
}
// Names the script defines itself become one placeholder, so renaming a #const or #define is not a change.
const NORMALISE = process.env.NORM === "1";
function normalise(t: string[]): string[] {
  if (!NORMALISE) return t;
  const own = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++)
    if (t[i] === "#const" || t[i] === "#define") own.add(t[i + 1]);
  return t.map((x) => (own.has(x) ? "§" : x));
}

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

// 32-bit FNV-1a, then murmur3's finaliser per seed.
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
const NH = 64;
const SEEDS = Array.from({ length: NH }, (_, i) => fmix((i + 1) * 0x9e3779b9));

function shingles(tokens: string[], k: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + k <= tokens.length; i++)
    out.add(tokens.slice(i, i + k).join("\u0001"));
  return out;
}
function minhash(sh: Set<string>, stop: Set<string> | null): Uint32Array {
  const mins = new Uint32Array(NH).fill(0xffffffff);
  for (const s of sh) {
    if (stop && stop.has(s)) continue;
    const h = fnv(s);
    for (let i = 0; i < NH; i++) {
      const v = fmix(h ^ SEEDS[i]);
      if (v < mins[i]) mins[i] = v;
    }
  }
  return mins;
}
function score(a: Uint32Array, b: Uint32Array): number {
  let eq = 0;
  for (let i = 0; i < NH; i++) if (a[i] === b[i] && a[i] !== 0xffffffff) eq++;
  return eq / NH;
}
function jaccard(
  a: Set<string>,
  b: Set<string>,
  stop: Set<string> | null,
): number {
  let inter = 0,
    uni = 0;
  const seen = new Set<string>();
  for (const s of a) {
    if (stop?.has(s)) continue;
    seen.add(s);
    uni++;
    if (b.has(s)) inter++;
  }
  for (const s of b) {
    if (stop?.has(s)) continue;
    if (!seen.has(s)) uni++;
  }
  return uni === 0 ? 0 : inter / uni;
}

// Seeded RNG for the synthetic edits.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const isNum = (t: string) => /^-?\d+(\.\d+)?$/.test(t);
function editNumbers(t: string[], frac: number, r: () => number) {
  return t.map((x) =>
    isNum(x) && r() < frac ? String(Math.floor(r() * 100)) : x,
  );
}
function deleteSpan(t: string[], frac: number, r: () => number) {
  const n = Math.floor(t.length * frac),
    at = Math.floor(r() * (t.length - n));
  return [...t.slice(0, at), ...t.slice(at + n)];
}
function insertSpan(
  t: string[],
  donor: string[],
  frac: number,
  r: () => number,
) {
  const n = Math.min(donor.length, Math.floor(t.length * frac));
  const from = Math.floor(r() * (donor.length - n)),
    at = Math.floor(r() * t.length);
  return [...t.slice(0, at), ...donor.slice(from, from + n), ...t.slice(at)];
}

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}
const f2 = (x: number) => x.toFixed(2);
function summary(xs: number[]) {
  return `n=${xs.length} min=${f2(Math.min(...xs))} p05=${f2(pct(xs, 0.05))} med=${f2(pct(xs, 0.5))} p95=${f2(pct(xs, 0.95))} p99=${f2(pct(xs, 0.99))} max=${f2(Math.max(...xs))}`;
}

// ---- corpus ----
const deOfficial = listRms(join(DE, "drs/gamedata_x2"));
const communityDirs = [join(ROOT, "test-maps"), join(DE, "random-map-scripts")];
const excludeNames =
  /^(sample|test\d*|test_comeer\d*|new_map|gold|golden_hill|tour|ALP_test|Test1)\.rms$/i;
let community: string[] = [];
for (const d of communityDirs) community.push(...listRms(d));
// Probe scripts in the game folder are short lowercase names like a3-grouped.rms. Keep only real maps.
community = community.filter(
  (p) =>
    !excludeNames.test(basename(p)) &&
    !/^[a-z]{1,3}\d[a-z0-9]*-/.test(basename(p)),
);
const local = listRms(join(ROOT, "test-maps/local"));

type Doc = { path: string; name: string; tokens: string[]; hash: string };
function load(paths: string[]): Doc[] {
  const seen = new Set<string>();
  const out: Doc[] = [];
  for (const p of paths) {
    const tokens = normalise(tokensOf(p));
    if (tokens.length < 200) continue;
    const hash = sha(tokens.join(" "));
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ path: p, name: basename(p), tokens, hash });
  }
  return out;
}
const deDocs = load(deOfficial);
const deHashes = new Set(deDocs.map((d) => d.hash));
const comDocs = load(community).filter((d) => !deHashes.has(d.hash));
const localDocs = load(local);
console.log(
  `DE official ${deDocs.length}, community ${comDocs.length}, local ${localDocs.length}`,
);
console.log("community:", comDocs.map((d) => d.name).join(" | "));

// Known families, by name, among community + local.
const families: RegExp[] = [/menindee/i, /comeer/i, /arabia/i, /arena/i];
const famOf = (n: string) => {
  const i = families.findIndex((r) => r.test(n));
  return i;
};

const all = [...comDocs, ...localDocs];

for (const k of [3, 5]) {
  // Document frequency of shingles across DE official maps.
  const df = new Map<string, number>();
  const deSh = deDocs.map((d) => shingles(d.tokens, k));
  for (const sh of deSh) for (const s of sh) df.set(s, (df.get(s) ?? 0) + 1);
  for (const thr of [null, 0.1]) {
    const stop =
      thr === null
        ? null
        : new Set(
            [...df].filter(([, c]) => c / deDocs.length >= thr).map(([s]) => s),
          );
    const sh = all.map((d) => shingles(d.tokens, k));
    const mh = sh.map((s) => minhash(s, stop));
    const nk = sh.map((s) => {
      let c = 0;
      for (const x of s) if (!stop?.has(x)) c++;
      return c;
    });
    const cont = (i: number, j: number) => {
      const J = score(mh[i], mh[j]);
      const inter = (J * (nk[i] + nk[j])) / (1 + J);
      return Math.min(1, inter / Math.max(1, Math.min(nk[i], nk[j])));
    };
    const unrelated: number[] = [],
      related: number[] = [],
      jErr: number[] = [];
    const cUnrel: number[] = [],
      cRel: number[] = [];
    const topC: [number, string][] = [];
    const relC: string[] = [];
    const topUnrel: [number, string][] = [];
    const relPairs: string[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const sc = score(mh[i], mh[j]);
        const fi = famOf(all[i].name),
          fj = famOf(all[j].name);
        const cc = cont(i, j);
        if (fi >= 0 && fi === fj) {
          cRel.push(cc);
          relC.push(
            `${f2(cc)} ${all[i].name}(${nk[i]}) ~ ${all[j].name}(${nk[j]})`,
          );
        } else {
          cUnrel.push(cc);
          topC.push([
            cc,
            `${all[i].name}(${nk[i]}) ~ ${all[j].name}(${nk[j]})`,
          ]);
        }
        if (fi >= 0 && fi === fj) {
          related.push(sc);
          relPairs.push(`${f2(sc)} ${all[i].name} ~ ${all[j].name}`);
        } else {
          unrelated.push(sc);
          topUnrel.push([sc, `${all[i].name} ~ ${all[j].name}`]);
        }
        if (i < 25 && j < 25)
          jErr.push(Math.abs(sc - jaccard(sh[i], sh[j], stop)));
      }
    // Synthetic edits on community maps.
    const r = rng(12345 + k);
    const syn: Record<string, number[]> = {
      num15: [],
      del10: [],
      ins10: [],
      heavy: [],
    };
    comDocs.forEach((d, idx) => {
      const donor = comDocs[(idx + 7) % comDocs.length].tokens;
      const bsh = shingles(d.tokens, k);
      const base = minhash(bsh, stop);
      const kept = (x: Set<string>) => {
        let c = 0;
        for (const y of x) if (!stop?.has(y)) c++;
        return c;
      };
      const nb = kept(bsh);
      const v = (t: string[]) => {
        const esh = shingles(t, k);
        const J = score(base, minhash(esh, stop));
        const ne = kept(esh);
        return process.env.CONT === "1"
          ? Math.min(
              1,
              (J * (nb + ne)) / (1 + J) / Math.max(1, Math.min(nb, ne)),
            )
          : J;
      };
      syn.num15.push(v(editNumbers(d.tokens, 0.15, r)));
      syn.del10.push(v(deleteSpan(d.tokens, 0.1, r)));
      syn.ins10.push(v(insertSpan(d.tokens, donor, 0.1, r)));
      syn.heavy.push(
        v(
          insertSpan(
            deleteSpan(editNumbers(d.tokens, 0.3, r), 0.15, r),
            donor,
            0.15,
            r,
          ),
        ),
      );
    });
    console.log(
      `\n=== k=${k} stop=${thr === null ? "none" : `df>=${thr}`} (stop size ${stop?.size ?? 0}) ===`,
    );
    console.log(`unrelated ${summary(unrelated)}`);
    console.log(`related   ${summary(related)}`);
    for (const [kname, xs] of Object.entries(syn))
      console.log(`syn ${kname.padEnd(6)} ${summary(xs)}`);
    console.log(
      `minhash-vs-jaccard abs err: med=${f2(pct(jErr, 0.5))} p95=${f2(pct(jErr, 0.95))} max=${f2(Math.max(...jErr))}`,
    );
    topUnrel.sort((a, b) => b[0] - a[0]);
    console.log(
      "top unrelated:",
      topUnrel
        .slice(0, 6)
        .map(([s, n]) => `${f2(s)} ${n}`)
        .join(" ; "),
    );
    console.log("related pairs:", relPairs.join(" ; "));
    console.log(`CONTAINMENT unrelated ${summary(cUnrel)}`);
    console.log(`CONTAINMENT related   ${summary(cRel)}`);
    topC.sort((a, b) => b[0] - a[0]);
    console.log(
      "C top unrelated:",
      topC
        .slice(0, 10)
        .map(([s, n]) => `${f2(s)} ${n}`)
        .join(" ; "),
    );
    console.log("C related:", relC.join(" ; "));
    const over = (xs: number[], t: number) => xs.filter((x) => x >= t).length;
    for (const t of [0.3, 0.4, 0.5, 0.6, 0.7])
      console.log(
        `  t=${t}: overlap unrelated>=t ${over(unrelated, t)}, containment unrelated>=t ${over(cUnrel, t)}`,
      );
  }
}

// Speed of one fingerprint, k=5.
const t0 = performance.now();
let reps = 0;
for (const d of comDocs) {
  minhash(shingles(d.tokens, 5), null);
  reps++;
}
const t1 = performance.now();
const sizes = comDocs.map((d) => d.tokens.length);
console.log(
  `\nfingerprint time ${((t1 - t0) / reps).toFixed(1)} ms per map, tokens med=${pct(sizes, 0.5)} max=${Math.max(...sizes)}`,
);
// Lex time too.
const t2 = performance.now();
for (const d of comDocs) tokensOf(d.path);
console.log(
  `lex time ${((performance.now() - t2) / comDocs.length).toFixed(1)} ms per map`,
);
