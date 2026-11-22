import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// GitHub Pages serves the site under /betvuna/
export default defineConfig({
  base: process.env.VITE_BASE ?? '/betvuna/',
  build: {
    rollupOptions: {
      input: {
        index: page('./index.html'),
        join: page('./join/index.html'),
        screen: page('./screen/index.html'),
        admin: page('./admin/index.html'),
      },
    },
  },
});
