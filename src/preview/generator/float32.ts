// Single-precision arithmetic for the land stage, docs/preview-design.md
// Sec.6.1 (rev 9). PURE (CLAUDE.md hard rule / preview-design Sec.2).
//
// The game computes border tiles, land_position tiles, percentage targets and
// the circle_radius ring in 32-bit floats, and a result that lands on the other
// side of a rounding boundary moves a land by a tile. So these helpers repeat
// the float32 rounding the game does, step by step. `Math.fround` rounds a
// double to the nearest float32, and for one +, -, * or / of two float32
// values, doing the operation in double and then calling `fround` gives
// exactly the float32 result, because a double carries more than twice
// float32's precision. That is why `f32Mul(a, b)` is just `fround(a * b)`.
//
// Sec.8's lint rule forbids Math.sqrt, Math.cos and Math.sin under this
// directory, because ECMAScript does not pin their last bits. The three
// below are written out with + and * only, which IEEE 754 does pin, so they
// give the same answer on every engine.

const f = Math.fround;

export const f32Mul = (a: number, b: number): number => f(f(a) * f(b));
export const f32Div = (a: number, b: number): number => f(f(a) / f(b));
export const f32Add = (a: number, b: number): number => f(f(a) + f(b));
export const f32Sub = (a: number, b: number): number => f(f(a) - f(b));

/** Round half away from zero, the game's rounding for every tile coordinate it derives from a percentage. */
export function roundHalfAway(v: number): number {
  return v >= 0 ? Math.floor(v + 0.5) : -Math.floor(-v + 0.5);
}

/** `round(dim * p / 100)` in single precision, Sec.6.1's border and land_position tile rule. */
export function percentTile(dim: number, percent: number): number {
  return roundHalfAway(f32Div(f32Mul(dim, percent), 100));
}

/**
 * Square root in double precision by Newton's method, then rounded to
 * float32. The float32 result is all the land stage reads, and a double
 * square root rounded to float32 is the correctly rounded float32 square
 * root, so a last-bit error in the double almost never survives.
 */
export function f32Sqrt(value: number): number {
  const x = f(value);
  if (!(x > 0)) return 0;
  let y = x >= 1 ? x : 1;
  for (let i = 0; i < 2000; i++) {
    const next = 0.5 * (y + x / y);
    // From above, Newton falls monotonically until it stops moving.
    if (next >= y) break;
    y = next;
  }
  return f(y);
}

// fdlibm's kernels for |r| <= pi/4, the published polynomial coefficients.
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(r: number): number {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kernelCos(r: number): number {
  const z = r * r;
  return (
    1 -
    0.5 * z +
    z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
  );
}

// pi/2 in two parts, so `x - k * pi/2` loses nothing for the small k the
// land stage needs (its angles never pass 2*pi by much).
const PIO2_HI = 1.57079632673412561417;
const PIO2_LO = 6.07710050650619224932e-11;

function reduce(x: number): { quadrant: number; r: number } {
  const k = Math.round(x / (PIO2_HI + PIO2_LO));
  return { quadrant: ((k % 4) + 4) % 4, r: x - k * PIO2_HI - k * PIO2_LO };
}

/** cos of a float32 angle, rounded to float32. */
export function f32Cos(angle: number): number {
  const { quadrant, r } = reduce(f(angle));
  const v =
    quadrant === 0
      ? kernelCos(r)
      : quadrant === 1
        ? -kernelSin(r)
        : quadrant === 2
          ? -kernelCos(r)
          : kernelSin(r);
  return f(v);
}

/** sin of a float32 angle, rounded to float32. */
export function f32Sin(angle: number): number {
  const { quadrant, r } = reduce(f(angle));
  const v =
    quadrant === 0
      ? kernelSin(r)
      : quadrant === 1
        ? kernelCos(r)
        : quadrant === 2
          ? -kernelSin(r)
          : -kernelCos(r);
  return f(v);
}
