/**
 * Extract gain map XMP metadata from a JPEG buffer.
 * Supports hdrgm:* attributes (UltraHDR / Adobe gain map).
 * Throws if no gain map metadata is found.
 */
const GAIN_MAP_METADATA_ERROR = 'Not a valid JPEG with gain map: missing gain map metadata';
const HDR_CAPACITY_MIN_REGEX = /hdrgm:HDRCapacityMin="([^"]*)"/i;
const HDR_CAPACITY_MAX_REGEX = /hdrgm:HDRCapacityMax="([^"]*)"/i;
function getXmlValue(xml, tag, defaultValue) {
    const attributeMatch = new RegExp(`${tag.replace(/:/g, '\\:')}="([^"]*)"`, 'i').exec(xml);
    if (attributeMatch)
        return attributeMatch[1] ?? '';
    const tagMatch = new RegExp(`<${tag.replace(/:/g, '\\:')}[^>]*>([\\s\\S]*?)</[^>]+>`, 'i').exec(xml);
    if (tagMatch) {
        const inner = tagMatch[1];
        const liMatches = inner?.match(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/gi);
        if (liMatches && liMatches.length === 3) {
            return liMatches.map((v) => v.replace(/<\/?rdf:li[^>]*>/gi, '').trim());
        }
        return (inner?.trim() ?? '');
    }
    if (defaultValue !== undefined)
        return defaultValue;
    throw new Error(`Can't find ${tag} in gainmap metadata`);
}
function parseTriple(val) {
    if (Array.isArray(val)) {
        return val.map((v) => parseFloat(v));
    }
    const n = parseFloat(val);
    return [n, n, n];
}
/**
 * Scan buffer for XMP blocks and return gain map metadata from the first block
 * that contains hdrgm:* (gain map descriptor). Skips primary container descriptor
 * (Container:Directory only, no hdrgm:Version).
 * @throws if no gain map XMP block is found
 */
export function extractGainMapXmp(buffer) {
    const str = typeof TextDecoder !== 'undefined'
        ? new TextDecoder().decode(buffer)
        : String.fromCharCode.apply(null, Array.from(buffer));
    let start = str.indexOf('<x:xmpmeta');
    while (start !== -1) {
        const end = str.indexOf('x:xmpmeta>', start);
        if (end === -1)
            break;
        const xmpBlock = str.slice(start, end + 10);
        try {
            const version = getXmlValue(xmpBlock, 'hdrgm:Version', undefined);
            if (version === undefined || version === '') {
                start = str.indexOf('<x:xmpmeta', end);
                continue;
            }
            const gainMapMin = getXmlValue(xmpBlock, 'hdrgm:GainMapMin', '0');
            const gainMapMax = getXmlValue(xmpBlock, 'hdrgm:GainMapMax', '1');
            const gamma = getXmlValue(xmpBlock, 'hdrgm:Gamma', '1');
            const offsetSDR = getXmlValue(xmpBlock, 'hdrgm:OffsetSDR', '0.015625');
            const offsetHDR = getXmlValue(xmpBlock, 'hdrgm:OffsetHDR', '0.015625');
            const hdrCapacityMinMatch = HDR_CAPACITY_MIN_REGEX.exec(xmpBlock);
            const hdrCapacityMin = hdrCapacityMinMatch ? hdrCapacityMinMatch[1] : '0';
            const hdrCapacityMaxMatch = HDR_CAPACITY_MAX_REGEX.exec(xmpBlock);
            if (!hdrCapacityMaxMatch) {
                start = str.indexOf('<x:xmpmeta', end);
                continue;
            }
            const hdrCapacityMax = hdrCapacityMaxMatch[1];
            return {
                gainMapMin: parseTriple(gainMapMin),
                gainMapMax: parseTriple(gainMapMax),
                gamma: parseTriple(gamma),
                offsetSdr: parseTriple(offsetSDR),
                offsetHdr: parseTriple(offsetHDR),
                hdrCapacityMin: parseFloat(hdrCapacityMin ?? '0'),
                hdrCapacityMax: parseFloat(hdrCapacityMax ?? '1'),
            };
        }
        catch {
            start = str.indexOf('<x:xmpmeta', end);
        }
    }
    throw new Error(GAIN_MAP_METADATA_ERROR);
}
//# sourceMappingURL=extractXmp.js.map