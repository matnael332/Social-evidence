import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// Three entries: the service worker (a fixed file name, because the manifest
// points at it) and two extension pages. `public/` is copied as-is and holds
// the manifest, locales and icons.
export default defineConfig(({ mode }) => ({
  root: fromRoot('src'),
  publicDir: fromRoot('public'),
  build: {
    outDir: fromRoot('dist'),
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    sourcemap: mode === 'development',
    rollupOptions: {
      input: {
        'service-worker': fromRoot('src/background/service-worker.ts'),
        sidepanel: fromRoot('src/sidepanel/index.html'),
        options: fromRoot('src/options/index.html'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));
