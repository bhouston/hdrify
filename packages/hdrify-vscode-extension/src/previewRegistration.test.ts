import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPreviewHtml } from './previewHtml.js';
import { isPreviewUpdate } from './protocol.js';
import { previewStatus } from './preview/status.js';
import { readJxl } from 'hdrify';

const assets = path.resolve(__dirname, '../../../assets/jxl');

describe('JPEG XL preview registration and metadata', () => {
  it('registers JPEG XL as a default custom editor', () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const selectors = manifest.contributes.customEditors
      .filter((editor: { priority: string }) => editor.priority === 'default')
      .flatMap((editor: { selector: { filenamePattern: string }[] }) =>
        editor.selector.map((entry) => entry.filenamePattern),
      );
    expect(selectors).toContain('*.jxl');
    expect(selectors).toContain('*.JXL');
  });

  it.each(['lossless_float32.jxl', 'vardct_float.jxl'])('shows actual metadata from %s', (name) => {
    const bytes = readFileSync(path.join(assets, name));
    const image = readJxl(bytes);
    const status = previewStatus(name, bytes.length, image);
    expect(status).toContain(name);
    expect(status).toContain(`${image.width} × ${image.height}`);
    expect(status).toContain('JPEG XL');
    expect(status).toContain(`${JSON.stringify(image.metadata!.bitsPerSample)}-bit float`);
    expect(status).toContain(String(image.metadata!.encoding));
    expect(status).toContain(image.linearColorSpace);
    expect(status.slice(name.length)).not.toMatch(/lossless/i);
  });

  it('identifies the displayed frame of an animation', () => {
    const bytes = readFileSync(path.join(assets, 'features/anim_gif.jxl'));
    const image = readJxl(bytes);
    const frames = image.metadata!.animation as { frameCount: number };
    expect(previewStatus('animation.jxl', bytes.length, image)).toContain(
      `${frames.frameCount} frames (showing first)`,
    );
  });

  it('accepts encoded bytes and ignores unrelated messages', () => {
    expect(isPreviewUpdate({ type: 'update', fileName: 'image.jxl', data: new ArrayBuffer(2) })).toBe(true);
    for (const data of [
      null,
      {},
      { type: 'ready' },
      { type: 'update', fileName: 5, data: new ArrayBuffer(2) },
      { type: 'update', fileName: 'image.jxl', data: 'bad' },
    ]) {
      expect(isPreviewUpdate(data)).toBe(false);
    }
  });

  it('loads the React root and stylesheet with escaped resource URLs under CSP', () => {
    const html = getPreviewHtml(
      'vscode-resource:/preview.js?a="x"',
      'vscode-resource:/preview.css',
      'vscode-resource:',
    );
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('href="vscode-resource:/preview.css"');
    expect(html).toContain('src="vscode-resource:/preview.js?a=&quot;x&quot;"');
    expect(html).toContain('default-src &#39;none&#39;');
    expect(html).not.toContain('<image-viewer');
  });
});
