import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startPrototypeServer } from './hdr-canvas-prototype.mjs';

// Start Apple's driver separately: safaridriver --port 4447
const driver = process.env.SAFARI_WEBDRIVER_URL ?? 'http://127.0.0.1:4447';
const output = resolve(process.env.HDR_RESULTS_DIR ?? 'packages/hdrify-react/dist/hdr-canvas-results');
await mkdir(output, { recursive: true });
const server = await startPrototypeServer();
const result = { name: 'safari', status: 'unavailable' };
let session;
async function request(path, body, method = 'POST') {
  const response = await fetch(`${driver}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(65000),
  });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
try {
  const created = await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  session = created.sessionId;
  result.version = created.capabilities.browserVersion;
  await request(`/session/${session}/url`, { url: server.url });
  result.capabilities = await request(`/session/${session}/execute/async`, {
    script: `const done = arguments[arguments.length - 1];
      const started = Date.now();
      const check = () => {
        if (window.hdrPrototype) done(window.hdrPrototype.report());
        else if (Date.now() - started > 10000) done({error: 'Prototype did not initialize'});
        else setTimeout(check, 50);
      }; check();`,
    args: [],
  });
  assert.ok(result.capabilities.renderer && result.capabilities.renderer !== 'unavailable');
  assert.doesNotMatch(result.capabilities.renderer, /swiftshader|llvmpipe|lavapipe/i);
  const screenshot = await request(`/session/${session}/screenshot`, undefined, 'GET');
  await writeFile(resolve(output, 'safari.png'), Buffer.from(screenshot, 'base64'));
  result.status = 'passed capability checks';
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
} finally {
  if (session) await request(`/session/${session}`, undefined, 'DELETE');
  await server.close();
  await writeFile(resolve(output, 'safari.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
