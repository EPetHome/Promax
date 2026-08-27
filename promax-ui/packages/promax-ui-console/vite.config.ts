import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/promax-api': {
        target: process.env.PROMAX_API_BASE_URL ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/promax-api/u, ''),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
