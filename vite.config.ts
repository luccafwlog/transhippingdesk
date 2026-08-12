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
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inject-external-preconnects',
      transformIndexHtml(html: string) {
        const origins = [process.env.VITE_SUPABASE_URL, 'https://olinda.bcb.gov.br']
          .filter(Boolean)
          .map((value) => new URL(value!).origin)
        const links = [...new Set(origins)]
          .map((origin) => `<link rel="preconnect" href="${origin}" crossorigin>`)
          .join('\n    ')
        return html.replace('<head>', `<head>\n    ${links}`)
      },
    },
  ],
  server: {
    proxy: {
      // Proxy dev-only usado pela skill design-audit: aponte VITE_SUPABASE_URL
      // para http://127.0.0.1:5173/sb-proxy e rode scripts/design-audit/sb-shim.cjs.
      // Sem efeito quando o .env aponta direto para o Supabase real.
      '/sb-proxy': {
        target: 'http://127.0.0.1:54321',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/sb-proxy/, ''),
      },
    },
  },
  define: {
    'process.env': {},
    'import.meta.env.VITE_APP_COMMIT_SHA': JSON.stringify(appCommitSha),
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        // Isola vendors estáveis em chunks próprios para melhorar o cache do
        // browser entre deploys (mudam com pouca frequência). xlsx já é
        // code-split via import dinâmico, então fica de fora daqui.
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
    // Padrão node (rápido) para os testes de serviço/lib. Testes de componente
    // (.test.tsx) optam por jsdom via comentário `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
