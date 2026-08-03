// Setup global da suíte. Roda antes de cada arquivo de teste, em qualquer
// ambiente (node ou jsdom).
//
// Desmonta o que o React Testing Library renderizou ao fim de cada teste. Sem
// isso, o DOM só é limpo porque o Vitest recria o ambiente a cada arquivo — o
// que esconde testes que dependem de um `document` vazio. Os arquivos que já
// declaram `afterEach(cleanup)` continuam corretos: `cleanup` é idempotente.
//
// O import é dinâmico e condicional porque a maioria dos testes roda em
// ambiente node, onde o React Testing Library não carrega (não há `document`).
import { afterEach } from 'vitest'

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}
