import { defineConfig } from 'vitest/config'
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const appCommitSha = resolveCommitSha()

function resolveCommitSha() {
  if (process.env.VITE_APP_COMMIT_SHA) return process.env.VITE_APP_COMMIT_SHA.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'process.env': {},
    'import.meta.env.VITE_APP_COMMIT_SHA': JSON.stringify(appCommitSha),
  },
  build: {
    rollupOptions: {
      output: {
        // Isola vendors estáveis em chunks próprios para melhorar o cache do
        // browser entre deploys (mudam com pouca frequência). xlsx/jspdf já são
        // code-split via import dinâmico, então ficam de fora daqui.
        manualChunks: (id: string) => {
          if (
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/')
          ) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/@tanstack') || id.includes('node_modules/@supabase')) {
            return 'vendor-data'
          }
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
