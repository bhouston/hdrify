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
export declare const CHROMATICITIES_REC709: Chromaticities;
/** Display P3 / P3-D65 chromaticities (Apple Display P3, D65 white) */
export declare const CHROMATICITIES_P3: Chromaticities;
/** Rec. 2020 chromaticities (ITU-R BT.2020, D65 white) */
export declare const CHROMATICITIES_REC2020: Chromaticities;
