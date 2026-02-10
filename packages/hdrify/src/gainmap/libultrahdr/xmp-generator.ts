/**
 * XMP metadata generator for gain map images
 * Based on libultrahdr jpegrutils.cpp implementation
 */

import type { GainMapMetadataExtended } from '../types.js';

/**
 * Escape XML special characters
 */
function escapeXml(str: string | number): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate XMP metadata for the primary image
 */
export function generateXmpForPrimaryImage(secondaryImageLength: number, metadata: GainMapMetadataExtended): string {
  const lines: string[] = [];
  const MIME_IMAGE_JPEG = 'image/jpeg';
  const ITEM_SEMANTIC_PRIMARY = 'Primary';
  const ITEM_SEMANTIC_GAIN_MAP = 'GainMap';

  // biome-ignore lint/security/noSecrets: XMP packet ID from Adobe spec
  lines.push('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
  lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">');
  lines.push('  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  lines.push('    <rdf:Description');
  lines.push('      xmlns:Container="http://ns.google.com/photos/1.0/container/"');
  lines.push('      xmlns:Item="http://ns.google.com/photos/1.0/container/item/"');
  lines.push('      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"');
  lines.push(`      hdrgm:Version="${escapeXml(metadata.version)}"`);
  lines.push('      rdf:about="">');

  lines.push('      <Container:Directory>');
  lines.push('        <rdf:Seq>');

  // biome-ignore lint/security/noSecrets: XMP RDF element name
  lines.push('          <rdf:li rdf:parseType="Resource">');
  lines.push('            <Container:Item');
  lines.push(`              Item:Semantic="${ITEM_SEMANTIC_PRIMARY}"`);
  lines.push(`              Item:Mime="${MIME_IMAGE_JPEG}"/>`);
  lines.push('          </rdf:li>');

  // biome-ignore lint/security/noSecrets: XMP RDF element name
  lines.push('          <rdf:li rdf:parseType="Resource">');
  lines.push('            <Container:Item');
  lines.push(`              Item:Semantic="${ITEM_SEMANTIC_GAIN_MAP}"`);
  lines.push(`              Item:Mime="${MIME_IMAGE_JPEG}"`);
  lines.push(`              Item:Length="${secondaryImageLength}"/>`);
  lines.push('          </rdf:li>');

  lines.push('        </rdf:Seq>');
  lines.push('      </Container:Directory>');
  lines.push('    </rdf:Description>');
  lines.push('  </rdf:RDF>');
  lines.push('</x:xmpmeta>');
  lines.push('<?xpacket end="w"?>');

  return lines.join('\n');
}

/**
 * Generate XMP metadata for the secondary (gain map) image
 */
export function generateXmpForSecondaryImage(metadata: GainMapMetadataExtended): string {
  const lines: string[] = [];
  const hdrCapacityMin = metadata.hdrCapacityMin;
  const hdrCapacityMax = metadata.hdrCapacityMax;

  const getAverage = (val: number | [number, number, number]): number => {
    if (Array.isArray(val)) {
      return val.reduce((sum, v) => sum + v, 0) / val.length;
    }
    return val;
  };

  const gainMapMinAvg = getAverage(metadata.gainMapMin);
  const gainMapMaxAvg = getAverage(metadata.gainMapMax);
  const gammaAvg = getAverage(metadata.gamma);
  const offsetSdrAvg = getAverage(metadata.offsetSdr);
  const offsetHdrAvg = getAverage(metadata.offsetHdr);

  // biome-ignore lint/security/noSecrets: XMP packet ID from Adobe spec
  lines.push('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>');
  lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">');
  lines.push('  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  lines.push('    <rdf:Description');
  lines.push('      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"');
  lines.push(`      hdrgm:Version="${escapeXml(metadata.version)}"`);
  lines.push(`      hdrgm:GainMapMin="${escapeXml(gainMapMinAvg)}"`);
  lines.push(`      hdrgm:GainMapMax="${escapeXml(gainMapMaxAvg)}"`);
  lines.push(`      hdrgm:Gamma="${escapeXml(gammaAvg)}"`);
  lines.push(`      hdrgm:OffsetSDR="${escapeXml(offsetSdrAvg)}"`);
  lines.push(`      hdrgm:OffsetHDR="${escapeXml(offsetHdrAvg)}"`);
  lines.push(`      hdrgm:HDRCapacityMin="${escapeXml(hdrCapacityMin)}"`);
  lines.push(`      hdrgm:HDRCapacityMax="${escapeXml(hdrCapacityMax)}"`);
  // biome-ignore lint/security/noSecrets: XMP attribute name from Adobe spec
  lines.push('      hdrgm:BaseRenditionIsHDR="False"');
  lines.push('      rdf:about=""/>');
  lines.push('  </rdf:RDF>');
  lines.push('</x:xmpmeta>');
  lines.push('<?xpacket end="w"?>');

  return lines.join('\n');
}
