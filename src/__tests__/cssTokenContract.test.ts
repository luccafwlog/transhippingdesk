import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Contrato dos custom properties `--app-*`: todo token consumido via `var(...)`
// no código precisa existir em algum CSS do projeto.
//
// Existe porque `bg-[var(--app-card-bg)]` e `text-[var(--app-primary)]` viveram
// em 6 arquivos apontando para tokens que nunca foram definidos. CSS não avisa:
// a declaração é descartada em silêncio, o card fica transparente sobre o fundo
// da página e a cor de link passa a herdar a do texto ao redor. Nenhum gate
// pegava isso — o de contraste só confere pares declarados explicitamente.

const SRC = resolve('src')
const TOKEN_DEFINITION = /(--app-[\w-]+)\s*:/g
// `var(--app-x)` e `var(--app-x, fallback)`; o fallback torna o uso seguro.
const TOKEN_USAGE = /var\(\s*(--app-[\w-]+)\s*(,)?/g

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return walk(path)
    // O próprio contrato cita tokens em comentários e mensagens; ignorá-lo
    // evita que a documentação do teste vire falso positivo.
    if (path.endsWith('cssTokenContract.test.ts')) return []
    return /\.(tsx?|css)$/.test(entry) ? [path] : []
  })
}

const files = walk(SRC)

const defined = new Set<string>()
for (const file of files.filter((path) => path.endsWith('.css'))) {
  const css = readFileSync(file, 'utf8')
  for (const match of css.matchAll(TOKEN_DEFINITION)) defined.add(match[1])
}

describe('contrato de tokens CSS --app-*', () => {
  it('declara ao menos a paleta base (guarda contra regex que para de casar)', () => {
    expect(defined.size).toBeGreaterThan(20)
    expect(defined.has('--app-link')).toBe(true)
    expect(defined.has('--app-surface-strong')).toBe(true)
  })

  it('todo token consumido sem fallback está definido em algum CSS', () => {
    const orphans: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(TOKEN_USAGE)) {
        const [, token, hasFallback] = match
        if (hasFallback) continue
        if (!defined.has(token)) orphans.push(`${file.slice(SRC.length + 1)} → ${token}`)
      }
    }
    expect(orphans, `Tokens consumidos e nunca definidos:\n${orphans.join('\n')}`).toEqual([])
  })
})
