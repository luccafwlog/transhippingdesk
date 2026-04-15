import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env': {},
  },
  optimizeDeps: {
    include: ['@react-pdf/renderer'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
