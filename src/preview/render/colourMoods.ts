// The game's colour moods (`color_correction`) as colour transforms, for the
// textured view (docs/preview-de-textures-design.md Sec.14.6). Measured
// 2026-11-25 from skirmish games of one scene under each mood with the
// game's Map lighting on: each mood is, within about one unit, a per channel
// gain and offset of the default mood's picture, fitted on matched
// percentiles of grass and dirt (RMS/texture-compare/results.md). Applied
// after DE_COLOUR_GRADE, which takes the textures to the default mood.

export interface MoodTransform {
  /** Per channel, red, green, blue. */
  readonly gain: readonly [number, number, number];
  /** Per channel, 0 to 255. */
  readonly offset: readonly [number, number, number];
}

/** By the mood's number (the `colorCorrection` constants). A mood not here draws as the default. */
export const MOOD_TRANSFORMS: ReadonlyMap<number, MoodTransform> = new Map<
  number,
  MoodTransform
>([
  // CC_AUTUMN, fit error 0.74
  [1, { gain: [0.972, 0.957, 0.894], offset: [3.3, -10.3, 1.9] }],
  // CC_WINTER, fit error 0.83
  [2, { gain: [0.987, 1.064, 0.96], offset: [-7.4, -12.8, 22.2] }],
  // CC_JUNGLE, fit error 0.46
  [3, { gain: [0.963, 0.991, 0.949], offset: [-8.9, -0.8, -6.5] }],
  // CC_DESERT, fit error 1.01
  [4, { gain: [0.919, 0.892, 0.914], offset: [15.9, 12.7, 2.6] }],
  // CC_NIGHT, fit error 0.67
  [5, { gain: [0.429, 0.529, 0.617], offset: [15.6, 19.6, 62.9] }],
  // CC_EVENING, fit error 0.49
  [6, { gain: [0.623, 0.66, 0.701], offset: [12.4, 11.3, 29.5] }],
  // CC_SPRING, fit error 0.79
  [7, { gain: [0.928, 0.979, 0.909], offset: [3.8, -3.4, 0.9] }],
  // CC_SAVANNAH, fit error 1.7
  [8, { gain: [0.905, 0.938, 0.878], offset: [18.7, 2.3, -9.0] }],
  // CC_ARCTIC, fit error 0.6
  [9, { gain: [0.959, 1.011, 0.984], offset: [-1.6, -2.2, 23.2] }],
  // CC_RAINFOREST, fit error 0.76
  [10, { gain: [0.938, 1.071, 0.94], offset: [-1.2, 0.3, -2.3] }],
  // CC_SWAMP, fit error 0.76
  [11, { gain: [0.72, 0.848, 0.754], offset: [21.2, 12.4, 15.8] }],
  // CC_STEPPES, fit error 1.35
  [12, { gain: [0.994, 0.929, 0.903], offset: [7.9, 7.5, -8.5] }],
  // CC_MISTY, fit error 1.89
  [13, { gain: [0.617, 0.845, 0.867], offset: [54.0, 22.3, 52.7] }],
  // CC_SUMMER, fit error 1.13
  [14, { gain: [1.024, 0.961, 0.934], offset: [-0.2, 3.0, -4.6] }],
  // CC_MURKY, fit error 1.85
  [15, { gain: [0.744, 0.913, 0.937], offset: [44.3, 19.0, 45.0] }],
  // CC_BRUMOUS, fit error 1.04
  [16, { gain: [0.855, 0.977, 0.966], offset: [17.6, 4.1, 35.1] }],
  // CC_TWILIGHT, fit error 0.47
  [17, { gain: [0.485, 0.548, 0.599], offset: [26.9, 15.3, 52.8] }],
  // CC_DARKNESS, fit error 4.61, rougher: the grass and dirt split is weak this dark
  [18, { gain: [0.564, 1.0, 0.874], offset: [-11.2, -55.4, 37.3] }],
]);

/** No change, for the default mood and any mood not measured. */
export const IDENTITY_MOOD: MoodTransform = {
  gain: [1, 1, 1],
  offset: [0, 0, 0],
};

export function moodTransform(mood: number | undefined): MoodTransform {
  return (mood !== undefined && MOOD_TRANSFORMS.get(mood)) || IDENTITY_MOOD;
}
