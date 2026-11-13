import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

export default defineConfig(({ mode }) => {
  const internal = mode === 'internal'
  const localPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

  return {
    clearScreen: false,
    resolve: {
      alias: {
        './device-images': localPath(internal ? './src/device-images.internal.ts' : './src/device-images.ts'),
      },
    },
    server: internal ? {
      fs: { allow: [searchForWorkspaceRoot(localPath('.')), localPath('../../assets/devices')] },
    } : undefined,
    build: {
      target: 'safari16',
      outDir: internal ? 'dist-internal' : 'dist',
    },
  }
})
