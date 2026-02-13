/**
 * Ensure Buffer is available for jpeg-js in browser environments.
 * jpeg-js uses Node's Buffer internally; in browsers it is undefined.
 * No-op in Node.js where Buffer is already a global.
 */
import { Buffer as BufferPolyfill } from 'buffer';

const g =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : typeof self !== 'undefined'
        ? self
        : {};
if (typeof (g as typeof globalThis & { Buffer?: typeof BufferPolyfill }).Buffer === 'undefined') {
  (g as typeof globalThis & { Buffer: typeof BufferPolyfill }).Buffer = BufferPolyfill;
}
