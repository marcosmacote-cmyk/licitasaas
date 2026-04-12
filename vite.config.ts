import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy vendor libraries — split out of main bundle
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-canvas': ['html2canvas'],
          'vendor-sanitize': ['dompurify'],
          'vendor-icons': ['lucide-react'],
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      }
    }
  }
})
