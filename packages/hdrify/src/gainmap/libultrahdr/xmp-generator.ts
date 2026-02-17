/**
 * XMP metadata generator for gain map images.
 * Structure matches gainmap-js (https://github.com/MONOGRID/gainmap-js) and libultrahdr jpegrutils.cpp:
 * primary XMP = Container:Directory + hdrgm:Version; secondary XMP = full hdrgm params (GainMapMin/Max, Gamma, etc.).
 * Viewers like Apple Preview use this XMP to recognize Ultra HDR and apply HDR display.
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

  // No xpacket wrapper — match reference file (e.g. Google encoder) so Apple Preview recognizes HDR
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

  return lines.join('\n');
}

/**
 * Generate XMP metadata for the secondary (gain map) image
 */
export function generateXmpForSecondaryImage(metadata: GainMapMetadataExtended): string {
  const lines: string[] = [];
  const hdrCapacityMin = metadata.hdrCapacityMin;
  const hdrCapacityMax = metadata.hdrCapacityMax;

  const toScalar = (val: number | [number, number, number]): number => {
    if (Array.isArray(val)) {
      const [a, b, c] = val;
      return a === b && b === c ? a : (a + b + c) / 3;
    }
    return val;
  };

  const gainMapMinScalar = toScalar(metadata.gainMapMin);
  const gainMapMaxScalar = toScalar(metadata.gainMapMax);
  const gammaScalar = toScalar(metadata.gamma);
  const offsetSdrScalar = toScalar(metadata.offsetSdr);
  const offsetHdrScalar = toScalar(metadata.offsetHdr);

  // No xpacket wrapper — match reference file so Apple Preview recognizes HDR
  lines.push('<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.2">');
  lines.push('  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">');
  lines.push('    <rdf:Description');
  lines.push('      xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"');
  lines.push(`      hdrgm:Version="${escapeXml(metadata.version)}"`);
  lines.push(`      hdrgm:GainMapMin="${escapeXml(gainMapMinScalar)}"`);
  lines.push(`      hdrgm:GainMapMax="${escapeXml(gainMapMaxScalar)}"`);
  lines.push(`      hdrgm:Gamma="${escapeXml(gammaScalar)}"`);
  lines.push(`      hdrgm:OffsetSDR="${escapeXml(offsetSdrScalar)}"`);
  lines.push(`      hdrgm:OffsetHDR="${escapeXml(offsetHdrScalar)}"`);
  lines.push(`      hdrgm:HDRCapacityMin="${escapeXml(hdrCapacityMin)}"`);
  lines.push(`      hdrgm:HDRCapacityMax="${escapeXml(hdrCapacityMax)}"`);
  // biome-ignore lint/security/noSecrets: XMP attribute name from Adobe spec
  lines.push('      hdrgm:BaseRenditionIsHDR="False"');
  lines.push('      rdf:about=""/>');
  lines.push('  </rdf:RDF>');
  lines.push('</x:xmpmeta>');

  return lines.join('\n');
}
