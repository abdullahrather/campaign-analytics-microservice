import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      [
        '/auth',
        '/account',
        '/admin',
        '/campaigns',
        '/dev',
        '/docs',
        '/invitations',
        '/openapi.json',
        '/shows',
        '/team',
      ].map((path) => [path, api]),
    ),
  },
});
