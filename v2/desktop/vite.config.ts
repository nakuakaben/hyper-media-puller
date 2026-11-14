import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  clearScreen: false,
  build: {
    target: 'safari16',
    outDir: mode === 'internal' ? 'dist-internal' : 'dist',
  },
}))
