#!/usr/bin/env node
/**
 * Parse .cpuprofile and output top hot spots by self time.
 * Supports both Chrome format (samples/timeDeltas) and Node hitCount format.
 * Usage: node scripts/analyze-cpuprofile.mjs [path-to.cpuprofile]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const profileDir = path.join(process.cwd(), 'profile-output');
const profilePath =
  process.argv[2] ||
  (() => {
    const files = fs
      .readdirSync(profileDir)
      .filter((f) => f.endsWith('.cpuprofile'))
      .sort();
    return path.join(profileDir, files.pop());
  })();

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const { nodes, samples, timeDeltas } = profile;

// Build node id -> node map
const nodeMap = new Map();
for (const node of nodes) {
  nodeMap.set(node.id, node);
}

const selfTime = new Map();
let totalSamples = 0;

if (samples && timeDeltas && samples.length > 0) {
  // Chrome format: samples[i] = leaf node, timeDeltas[i] = microseconds
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] ?? 0;
    selfTime.set(nodeId, (selfTime.get(nodeId) ?? 0) + delta);
    totalSamples += delta;
  }
} else {
  // Node format: hitCount = sample count (proportional to self time)
  for (const node of nodes) {
    const hits = node.hitCount ?? 0;
    if (hits > 0) {
      selfTime.set(node.id, hits);
      totalSamples += hits;
    }
  }
}

// Sort by self time descending
const sorted = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);

// Filter to hdrify/app code
function isRelevant(node) {
  const url = node?.callFrame?.url ?? '';
  return (
    url.includes('hdrify') ||
    url.includes('packages/') ||
    (url.includes('node_modules') && (url.includes('jpeg-js') || url.includes('fflate') || url.includes('sharp')))
  );
}

console.log(`\n=== CPU Profile Analysis: ${path.basename(profilePath)} ===`);
const totalDisplay =
  totalSamples >= 1e6 ? `${(totalSamples / 1e6).toFixed(2)}s` : `${(totalSamples / 1000).toFixed(1)}ms`;
console.log(`Total samples: ${totalSamples.toLocaleString()} (${totalDisplay})`);
console.log(`\n--- Top 50 functions by self time (all) ---\n`);

for (let i = 0; i < Math.min(50, sorted.length); i++) {
  const [nodeId, val] = sorted[i];
  const node = nodeMap.get(nodeId);
  const name = node?.callFrame?.functionName || '(anonymous)';
  const url = node?.callFrame?.url || '';
  const shortUrl = url.replace(/^.*\//, '').replace(/\?.*$/, '');
  const pct = totalSamples > 0 ? ((val / totalSamples) * 100).toFixed(1) : '0';
  const display = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val);
  console.log(`${String(i + 1).padStart(2)}. ${pct.padStart(5)}% ${display.padStart(8)}  ${name}`);
  if (url) console.log(`    ${shortUrl}`);
}

console.log(`\n--- Top 30 hdrify/app-relevant hot spots ---\n`);

const relevant = sorted
  .map(([nodeId, val]) => {
    const node = nodeMap.get(nodeId);
    return [node, val];
  })
  .filter(([node]) => node && isRelevant(node));

for (let i = 0; i < Math.min(30, relevant.length); i++) {
  const [node, val] = relevant[i];
  const name = node?.callFrame?.functionName || '(anonymous)';
  const url = node?.callFrame?.url || '';
  const shortUrl = url.replace(/^.*\//, '').replace(/\?.*$/, '');
  const pct = totalSamples > 0 ? ((val / totalSamples) * 100).toFixed(1) : '0';
  const display = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : String(val);
  console.log(`${String(i + 1).padStart(2)}. ${pct.padStart(5)}% ${display.padStart(8)}  ${name}`);
  console.log(`    ${shortUrl}`);
}
