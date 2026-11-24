// Decodes BC7 blocks, the format five of DE's pasture textures use
// (docs/preview-de-textures-design.md Sec.10). Pure, like dds.ts, which calls
// it. BC7 is the format the Khronos BPTC specification describes. Each 4 by 4
// block is 128 bits and picks one of eight modes, and the mode decides how
// the remaining bits split into partitions, end colours and indices.
//
// The tables below are data from that specification. The partition tables
// were read back from a reference decoder, one hand built block per partition
// (Sec.10 says how), and the tests hold this decoder to that reference
// decoder's output on random blocks of every mode.

/** What one mode's bits hold, in the order the block stores them. */
interface Bc7Mode {
  /** How many colour lines the block uses, each with two end colours. */
  subsets: number;
  /** Bits naming the partition, which says which subset each texel is in. */
  partitionBits: number;
  /** Bits swapping alpha with one colour channel after decoding. */
  rotationBits: number;
  /** Mode 4's bit choosing which index set drives colour and which alpha. */
  indexSelectionBits: number;
  colourBits: number;
  /** Zero when the mode stores no alpha, which then decodes as opaque. */
  alphaBits: number;
  /** One extra low bit per end colour, shared by all its channels. */
  endpointPBits: boolean;
  /** One extra low bit per subset, shared by both its end colours. */
  sharedPBits: boolean;
  indexBits: number;
  /** A second index set, modes 4 and 5 only, that drives alpha or colour. */
  secondIndexBits: number;
}

const MODES: readonly Bc7Mode[] = [
  m(3, 4, 0, 0, 4, 0, true, false, 3, 0),
  m(2, 6, 0, 0, 6, 0, false, true, 3, 0),
  m(3, 6, 0, 0, 5, 0, false, false, 2, 0),
  m(2, 6, 0, 0, 7, 0, true, false, 2, 0),
  m(1, 0, 2, 1, 5, 6, false, false, 2, 3),
  m(1, 0, 2, 0, 7, 8, false, false, 2, 2),
  m(1, 0, 0, 0, 7, 7, true, false, 4, 0),
  m(2, 6, 0, 0, 5, 5, true, false, 2, 0),
];

function m(
  subsets: number,
  partitionBits: number,
  rotationBits: number,
  indexSelectionBits: number,
  colourBits: number,
  alphaBits: number,
  endpointPBits: boolean,
  sharedPBits: boolean,
  indexBits: number,
  secondIndexBits: number,
): Bc7Mode {
  return {
    subsets,
    partitionBits,
    rotationBits,
    indexSelectionBits,
    colourBits,
    alphaBits,
    endpointPBits,
    sharedPBits,
    indexBits,
    secondIndexBits,
  };
}

/**
 * The 64 two subset partitions. Bit i is texel i's subset (x + 4y, lowest bit
 * first), so 0xcccc puts the two right columns in subset 1.
 */
const PARTITIONS_2 = [
  52428, 34952, 61166, 60616, 51328, 65260, 65224, 60544, 51200, 65516, 65152,
  59392, 65512, 65280, 65520, 61440, 63248, 142, 28928, 2254, 140, 29456, 12544,
  36046, 2188, 12560, 26214, 13932, 6120, 4080, 29070, 14748, 43690, 61680,
  23130, 13260, 15420, 21930, 38550, 42330, 29646, 5064, 12876, 15324, 27030,
  49980, 39270, 1632, 626, 1252, 20032, 10016, 51510, 37740, 14790, 25500,
  37686, 40134, 33150, 59160, 52464, 4044, 30532, 60962,
];

/** The 64 three subset partitions, one digit per texel. */
const PARTITIONS_3 = [
  "0011001102212222",
  "0001001122112221",
  "0000200122112211",
  "0222002200110111",
  "0000000011221122",
  "0011001100220022",
  "0022002211111111",
  "0011001122112211",
  "0000000011112222",
  "0000111111112222",
  "0000111122222222",
  "0012001200120012",
  "0112011201120112",
  "0122012201220122",
  "0011011211221222",
  "0011200122002220",
  "0001001101121122",
  "0111001120012200",
  "0000112211221122",
  "0022002200221111",
  "0111011102220222",
  "0001000122212221",
  "0000001101220122",
  "0000110022102210",
  "0122012200110000",
  "0012001211222222",
  "0110122112210110",
  "0000011012211221",
  "0022110211020022",
  "0110011020022222",
  "0011012201220011",
  "0000200022112221",
  "0000000211221222",
  "0222002200120011",
  "0011001200220222",
  "0120012001200120",
  "0000111122220000",
  "0120120120120120",
  "0120201212010120",
  "0011220011220011",
  "0011112222000011",
  "0101010122222222",
  "0000000021212121",
  "0022112200221122",
  "0022001100220011",
  "0220122102201221",
  "0101222222220101",
  "0000212121212121",
  "0101010101012222",
  "0222011102220111",
  "0002111200021112",
  "0000211221122112",
  "0222011101110222",
  "0002111211120002",
  "0110011001102222",
  "0000000021122112",
  "0110011022222222",
  "0022001100110022",
  "0022112211220022",
  "0000000000002112",
  "0002000100020001",
  "0222122202221222",
  "0101222222222222",
  "0111201122012220",
];

// Each subset has one anchor texel whose index is stored one bit shorter,
// since the encoder orders the end colours so that texel's top bit is zero.
// Subset 0's anchor is always texel 0. These name the others.
const ANCHOR_2_OF_2 = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2,
  2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2,
  2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15,
];
const ANCHOR_2_OF_3 = [
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10,
  5, 8, 8, 6, 8, 5, 15, 15, 8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15,
  15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3,
];
const ANCHOR_3_OF_3 = [
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8,
  15, 8, 3, 15, 6, 10, 15, 15, 10, 8, 15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15,
  3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
];

/** Interpolation weights out of 64, by index width. */
const WEIGHTS: Record<number, readonly number[]> = {
  2: [0, 21, 43, 64],
  3: [0, 9, 18, 27, 37, 46, 55, 64],
  4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
};

/** Which subset texel `texel` is in, for a block with `subsets` subsets. */
function subsetOf(subsets: number, partition: number, texel: number): number {
  if (subsets === 1) return 0;
  if (subsets === 2) return (PARTITIONS_2[partition] >> texel) & 1;
  return PARTITIONS_3[partition].charCodeAt(texel) - 48;
}

function isAnchor(subsets: number, partition: number, texel: number): boolean {
  if (texel === 0) return true;
  if (subsets === 2) return texel === ANCHOR_2_OF_2[partition];
  if (subsets === 3)
    return (
      texel === ANCHOR_2_OF_3[partition] || texel === ANCHOR_3_OF_3[partition]
    );
  return false;
}

/**
 * Reads a block's bits from the lowest bit of its first byte upward. A class
 * holding a cursor, since every field is read in order and each read moves on
 * by its width. JavaScript's bit operators work on 32 bits and a block is 128,
 * so the reader takes one bit at a time from its byte rather than shifting
 * the whole block.
 */
class BitReader {
  private position = 0;
  constructor(
    private readonly data: Uint8Array,
    private readonly start: number,
  ) {}
  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const at = this.position + i;
      const bit = (this.data[this.start + (at >> 3)] >> (at & 7)) & 1;
      value |= bit << i;
    }
    this.position += count;
    return value;
  }
}

/** Widens an n bit value to 8 bits by repeating its high bits in the low ones. */
function widen(value: number, bits: number): number {
  if (bits >= 8) return value;
  const shifted = value << (8 - bits);
  return shifted | (shifted >> bits);
}

function interpolate(a: number, b: number, weight: number): number {
  return ((64 - weight) * a + weight * b + 32) >> 6;
}

/**
 * Decodes the block at `offset` into `out`, sixteen RGBA texels row major
 * (64 bytes). A block whose first byte is zero names no mode, and decodes as
 * transparent black, as the specification says.
 */
export function decodeBc7Block(
  data: Uint8Array,
  offset: number,
  out: Uint8Array,
): void {
  let modeIndex = 0;
  while (modeIndex < 8 && ((data[offset] >> modeIndex) & 1) === 0) modeIndex++;
  if (modeIndex === 8) {
    out.fill(0);
    return;
  }
  const mode = MODES[modeIndex];
  const bits = new BitReader(data, offset);
  bits.read(modeIndex + 1);
  const partition = bits.read(mode.partitionBits);
  const rotation = bits.read(mode.rotationBits);
  const indexSelection = bits.read(mode.indexSelectionBits);

  const endpoints = mode.subsets * 2;
  // endpoints by 4 channels, filled channel by channel since the block stores
  // every end colour's red, then every green, and so on.
  const colours = new Uint8Array(endpoints * 4);
  for (let channel = 0; channel < 3; channel++)
    for (let e = 0; e < endpoints; e++)
      colours[e * 4 + channel] = bits.read(mode.colourBits);
  for (let e = 0; e < endpoints; e++)
    colours[e * 4 + 3] = mode.alphaBits > 0 ? bits.read(mode.alphaBits) : 255;

  let colourBits = mode.colourBits;
  let alphaBits = mode.alphaBits;
  if (mode.endpointPBits || mode.sharedPBits) {
    const pBits: number[] = [];
    if (mode.endpointPBits)
      for (let e = 0; e < endpoints; e++) pBits.push(bits.read(1));
    else
      for (let s = 0; s < mode.subsets; s++) {
        const shared = bits.read(1);
        pBits.push(shared, shared);
      }
    for (let e = 0; e < endpoints; e++) {
      for (let channel = 0; channel < 3; channel++)
        colours[e * 4 + channel] = (colours[e * 4 + channel] << 1) | pBits[e];
      if (alphaBits > 0)
        colours[e * 4 + 3] = (colours[e * 4 + 3] << 1) | pBits[e];
    }
    colourBits++;
    if (alphaBits > 0) alphaBits++;
  }
  for (let e = 0; e < endpoints; e++) {
    for (let channel = 0; channel < 3; channel++)
      colours[e * 4 + channel] = widen(colours[e * 4 + channel], colourBits);
    if (alphaBits > 0)
      colours[e * 4 + 3] = widen(colours[e * 4 + 3], alphaBits);
  }

  // Every primary index comes before every secondary one.
  const primary = new Uint8Array(16);
  for (let texel = 0; texel < 16; texel++) {
    const width = isAnchor(mode.subsets, partition, texel)
      ? mode.indexBits - 1
      : mode.indexBits;
    primary[texel] = bits.read(width);
  }
  const secondary = new Uint8Array(16);
  if (mode.secondIndexBits > 0)
    for (let texel = 0; texel < 16; texel++)
      secondary[texel] = bits.read(
        texel === 0 ? mode.secondIndexBits - 1 : mode.secondIndexBits,
      );

  // Mode 4's selection bit swaps which index set drives colour and alpha.
  let colourIndices = primary;
  let colourWeights = WEIGHTS[mode.indexBits];
  let alphaIndices = primary;
  let alphaWeights = WEIGHTS[mode.indexBits];
  if (mode.secondIndexBits > 0) {
    alphaIndices = secondary;
    alphaWeights = WEIGHTS[mode.secondIndexBits];
    if (indexSelection === 1) {
      colourIndices = secondary;
      colourWeights = WEIGHTS[mode.secondIndexBits];
      alphaIndices = primary;
      alphaWeights = WEIGHTS[mode.indexBits];
    }
  }

  for (let texel = 0; texel < 16; texel++) {
    const subset = subsetOf(mode.subsets, partition, texel);
    const a = subset * 8;
    const b = a + 4;
    const cw = colourWeights[colourIndices[texel]];
    const aw = alphaWeights[alphaIndices[texel]];
    const p = texel * 4;
    out[p] = interpolate(colours[a], colours[b], cw);
    out[p + 1] = interpolate(colours[a + 1], colours[b + 1], cw);
    out[p + 2] = interpolate(colours[a + 2], colours[b + 2], cw);
    out[p + 3] = interpolate(colours[a + 3], colours[b + 3], aw);
    // Rotation stores one colour channel in the alpha slot and back again,
    // which lets an encoder spend the better precision where it is needed.
    if (rotation > 0) {
      const channel = rotation - 1;
      const swap = out[p + channel];
      out[p + channel] = out[p + 3];
      out[p + 3] = swap;
    }
  }
}
