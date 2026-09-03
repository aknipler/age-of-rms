// Sec.5.6: generated symbols are prefixed ALP_ and suffixed from the
// placement's own label, and every candidate is checked against the script's
// existing symbols and language.json's reserved words before being emitted.
// First-definition-wins is the engine's rule (instantiate.ts), so a
// shadowing emit would silently do nothing, the worst available failure
// (P4, Sec.9).

export interface NameAllocatorOptions {
  /** Names already taken, parseResult.symbols plus language.json's reserved words (Sec.5.6, P4). */
  reserved?: Iterable<string>;
  /**
   * Sec.5.6's product default is "ALP_" for every generated name. The
   * acceptance gate (Sec.10.1) instead reproduces the pre-existing
   * hand-authored map's own naming scheme so the emitted text can be
   * compared byte-for-byte, a real run never overrides this.
   */
  prefix?: string;
}

/** Uppercase, digits and underscore only, a valid RMS identifier body. */
function slug(label: string): string {
  const cleaned = label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "N";
}

export class NameAllocator {
  private readonly used = new Set<string>();
  private readonly prefix: string;

  constructor(options: NameAllocatorOptions = {}) {
    if (options.reserved) for (const n of options.reserved) this.used.add(n);
    this.prefix = options.prefix ?? "ALP_";
  }

  /**
   * `base` is a quantity name (e.g. "X", "SIN") and `suffix` is the
   * placement's own slugged label (e.g. "P1_A1"). Renames on collision
   * rather than shadowing (Sec.5.6).
   */
  allocate(base: string, suffix: string): string {
    const stem = suffix.length > 0 ? `${this.prefix}${base}_${slug(suffix)}` : `${this.prefix}${base}`;
    let candidate = stem;
    let n = 2;
    while (this.used.has(candidate)) {
      candidate = `${stem}_${n}`;
      n += 1;
    }
    this.used.add(candidate);
    return candidate;
  }

  reserve(name: string): void {
    this.used.add(name);
  }

  has(name: string): boolean {
    return this.used.has(name);
  }
}
