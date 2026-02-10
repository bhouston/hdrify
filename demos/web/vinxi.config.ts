import { defineConfig } from 'vinxi/config';
import { reactRouter } from '@tanstack/react-router/plugin-vinxi';

export default defineConfig({
  apps: {
    web: {
      name: 'web',
      type: 'spa',
      base: '/',
      handler: './app.html',
      plugins: () => [
        reactRouter({
          routesDirectory: './app/routes',
        }),
      ],
    },
  },
});
