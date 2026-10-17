import { defineConfig } from 'vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  base: `${process.env.BASE_URL ?? '/hdrify/'}demo/`,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }, tsconfigPaths: true },
  plugins: [tailwindcss(), viteReact()],
});
