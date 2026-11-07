import {
  CHROMATICITIES_P3,
  CHROMATICITIES_REC2020,
  CHROMATICITIES_REC709,
  type Chromaticities,
} from '../color/chromaticities.js';
import { chromaticitiesToRgbXyzMatrix, invert3 } from '../color/matrixConversion.js';
import type { JxlColorEncoding } from './jxlImageHeader.js';
/** Chromaticities of the original encoding, retained in metadata when converted to a supported space. */
export function jxlChromaticities(ce: JxlColorEncoding): Chromaticities {
  const ch = {
    ...(ce.primaries === 'p3'
      ? CHROMATICITIES_P3
      : ce.primaries === 'bt2100'
        ? CHROMATICITIES_REC2020
        : CHROMATICITIES_REC709),
  };
  if (ce.primaries === 'custom' && ce.primariesXy) {
    [[ch.redX, ch.redY], [ch.greenX, ch.greenY], [ch.blueX, ch.blueY]] = ce.primariesXy;
  }
  [ch.whiteX, ch.whiteY] =
    ce.whitePoint === 'custom'
      ? ce.whiteXy!
      : ce.whitePoint === 'dci'
        ? [0.314, 0.351]
        : ce.whitePoint === 'e'
          ? [1 / 3, 1 / 3]
          : [0.3127, 0.329];
  const matrix = chromaticitiesToRgbXyzMatrix(ch);
  if (![...matrix.flat(), ...invert3(matrix).flat()].every(Number.isFinite))
    throw new Error('JXL: invalid colour encoding chromaticities');
  return ch;
}
