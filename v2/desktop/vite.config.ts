import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  server: { fs: { allow: ['.', '../../assets/devices'] } },
  build: { target: 'safari16' },
})
