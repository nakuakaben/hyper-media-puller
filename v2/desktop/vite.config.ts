import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  clearScreen: false,
  resolve: {
    alias: {
      '@legacy-photos': fileURLToPath(new URL(
        mode === 'internal' ? './src/legacy-photos.internal.ts' : './src/legacy-photos.ts',
        import.meta.url,
      )),
    },
  },
  build: {
    target: 'safari16',
    outDir: mode === 'internal' ? 'dist-internal' : 'dist',
  },
}))
