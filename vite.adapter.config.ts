import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The page-side metadata reader is injected into a tab as a classic script,
// so it is built on its own: one self-contained file, no imports, no chunks.
export default defineConfig(({ mode }) => ({
  root: fromRoot('src'),
  publicDir: false,
  build: {
    outDir: fromRoot('dist'),
    emptyOutDir: false,
    target: 'chrome116',
    modulePreload: false,
    sourcemap: mode === 'development',
    rollupOptions: {
      input: { adapter: fromRoot('src/adapters/inject.ts') },
      output: {
        format: 'iife',
        entryFileNames: 'adapter.js',
        inlineDynamicImports: true,
      },
    },
  },
}));
