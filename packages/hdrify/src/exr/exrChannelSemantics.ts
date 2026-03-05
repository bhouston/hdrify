/**
 * EXR channel name normalization and semantic mapping.
 * Used to detect RGB vs luma-only EXRs and to key channel values in the pixel loop.
 */

export function normalizeChannelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getChannelSemanticName(name: string): string {
  const normalized = normalizeChannelName(name);
  if (normalized === 'r' || normalized === 'red') return 'r';
  if (normalized === 'g' || normalized === 'green') return 'g';
  if (normalized === 'b' || normalized === 'blue') return 'b';
  if (normalized === 'a' || normalized === 'alpha') return 'a';
  if (
    normalized === 'y' ||
    normalized === 'l' ||
    normalized === 'lum' ||
    normalized === 'luma' ||
    normalized === 'luminance' ||
    normalized === 'gray' ||
    normalized === 'grey'
  ) {
    return 'luma';
  }
  return normalized;
}
