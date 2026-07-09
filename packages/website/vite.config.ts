import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'url';

import tailwindcss from '@tailwindcss/vite';
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin';

const config = defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    tsconfigPaths: true,
  },
  plugins: [
    nitroV2Plugin({
      preset: 'node-server',
      compatibilityDate: '2025-11-07',
      compressPublicAssets: {
        gzip: true,
        brotli: false,
      },
      routeRules: {
        '/assets/**': {
          headers: {
            'cache-control': 'public, max-age=31536000, immutable',
          },
        },
      },
    }),
    tailwindcss(),
    viteReact(),
    tanstackStart(),
  ],
});

export default config;
