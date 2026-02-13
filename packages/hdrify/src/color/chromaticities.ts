/**
 * CIE xy chromaticity coordinates for RGB color spaces.
 * Used to compute RGB ↔ XYZ transformation matrices (Bruce Lindbloom method).
 */

export interface Chromaticities {
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  whiteX: number;
  whiteY: number;
}

/** Rec. 709 / sRGB chromaticities (ITU-R BT.709, D65 white) */
export const CHROMATICITIES_REC709: Chromaticities = {
  redX: 0.64,
  redY: 0.33,
  greenX: 0.3,
  greenY: 0.6,
  blueX: 0.15,
  blueY: 0.06,
  whiteX: 0.3127,
  whiteY: 0.329,
};

/** Display P3 / P3-D65 chromaticities (Apple Display P3, D65 white) */
export const CHROMATICITIES_P3: Chromaticities = {
  redX: 0.68,
  redY: 0.32,
  greenX: 0.265,
  greenY: 0.69,
  blueX: 0.15,
  blueY: 0.06,
  whiteX: 0.3127,
  whiteY: 0.329,
};

/** Rec. 2020 chromaticities (ITU-R BT.2020, D65 white) */
export const CHROMATICITIES_REC2020: Chromaticities = {
  redX: 0.708,
  redY: 0.292,
  greenX: 0.17,
  greenY: 0.797,
  blueX: 0.131,
  blueY: 0.046,
  whiteX: 0.3127,
  whiteY: 0.329,
};
