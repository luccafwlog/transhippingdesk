# Plano de correção — lentidão ao abrir páginas

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:executing-plans`
> (ou `superpowers:subagent-driven-development`) para executar tarefa a tarefa.
> Passos usam checkbox (`- [ ]`) para rastreio.

**Diagnóstico de origem:**
[`docs/archive/audits/2026-08-12-investigacao-lentidao-carregamento-paginas.md`](../archive/audits/2026-08-12-investigacao-lentidao-carregamento-paginas.md)

**Execução:** direto na PR #526, branch
`claude/page-load-slowness-investigation-rwbr97`.

**Objetivo:** eliminar o consumo de CPU do banco por assinaturas de Realtime que
não entregam evento algum, e tirar o download do chunk da rota de trás da
resolução da sessão.

**Arquitetura:** dois eixos independentes. (1) Banco — remover os canais
`postgres_changes` órfãos do cliente e limpar a publication sem consumidor, o
que zera o poll do WAL. (2) Load frio — dar um `preload()` aos componentes de
`lazyPage` e disparar o do pathname atual acima do `ProtectedRoute`, para que o
chunk baixe em paralelo com `getSession()` + `loadProfile()` em vez de depois.

**Stack:** React, TypeScript, TanStack Query, Supabase (PostgREST/Realtime/RLS),
Vitest, Vite.

**Ordem:** as tarefas 1–2 vêm primeiro porque mudam a matemática de custo de
todo o resto — com o banco liberado, cada salto de rede volta de 30–70 ms para
poucos milissegundos, e vale re-medir antes de decidir sobre os waterfalls
(ver "Fora do escopo").

---

### Task 1: Remover as assinaturas de Realtime órfãs

Nenhuma das duas tabelas assinadas está na publication `supabase_realtime`, então
os callbacks nunca rodaram. Remover não altera comportamento observável — só
para de manter o canal aberto, que é o que dispara o poll contínuo do WAL.

**Arquivos:**
- Modificar: `src/hooks/useOperationalCounts.ts`
- Modificar: `src/hooks/usePortalBilling.ts`
- Modificar/criar: `src/hooks/__tests__/useOperationalCounts.test.ts`

- [ ] Remover o `useEffect` do canal `op-counts-alerts-realtime`
      (`useOperationalCounts.ts:29-38`) e o `useQueryClient` que só existia para
      ele (`:19`); manter os cinco `useQuery` com `staleTime: 60_000` intactos.
- [ ] Remover o `useEffect` do canal `portal_demurrage_invoices`
      (`usePortalBilling.ts:61-70`) e o `useQueryClient` de
      `usePortalDemurrageInvoices` se ficar sem uso; conferir que os outros
      hooks do arquivo que usam `queryClient` continuam compilando.
- [ ] Deixar um `ponytail:` em cada hook registrando que a atualização passa a
      depender de `staleTime` e que reativar Realtime exige **primeiro** pôr a
      tabela na publication.
- [ ] Adicionar teste garantindo que `useOperationalCounts` não chama
      `supabase.channel` — é o guard que impede a regressão voltar por hábito.
- [ ] Rodar os testes focados dos dois hooks.

### Task 2: Limpar a publication `supabase_realtime`

`vessel_schedules` é a única tabela publicada (migration
`124_vessel_schedules.sql:97`) e nenhum arquivo em `src/` ou
`supabase/functions/` a assina. Publication sem consumidor é custo puro.

**Arquivos:**
- Criar: `supabase/migrations/288_drop_orphan_realtime_publication.sql`
- Modificar/criar: `src/services/__tests__/realtimePublicationMigration.test.ts`

- [ ] Usar a skill `supabase-migration` antes de escrever o SQL.
- [ ] `ALTER PUBLICATION supabase_realtime DROP TABLE public.vessel_schedules;`
      idempotente (guardado por `pg_publication_tables`), com comentário
      explicando que a tabela, as RPCs e as policies continuam intactas — só a
      replicação lógica sai.
- [ ] **Não** dropar a publication em si: o Supabase a recria e outras features
      da plataforma esperam que ela exista.
- [ ] Teste de contrato SQL conferindo que a migration é idempotente e que não
      toca em `DROP TABLE`, policy ou grant.
- [ ] Registrar no plano se a publication já estiver vazia no ambiente alvo.

### Task 3: Baixar o chunk da rota em paralelo com a autenticação

Hoje `ProtectedRoute` (`src/components/layout/ProtectedRoute.tsx:7`) não
renderiza `<Outlet />` enquanto `loading`, e `React.lazy` só dispara o
`import()` no render — então o chunk espera duas idas ao Supabase. `AuthProvider`
renderiza `children` incondicionalmente, então qualquer efeito dentro de `App`
roda **antes** da sessão resolver e pode iniciar o download.

**Arquivos:**
- Modificar: `src/lib/lazyPage.ts`
- Criar: `src/lib/routePreload.ts`
- Modificar: `src/App.tsx`
- Modificar: `src/lib/__tests__/lazyPage.test.ts`
- Criar: `src/lib/__tests__/routePreload.test.ts`

- [ ] Em `lazyPage`, memoizar o loader numa promise única e expor `.preload()`
      no componente retornado; `lazy()` deve consumir **a mesma** promise, para
      que preload + render nunca disparem dois fetches do mesmo chunk.
- [ ] Preservar integralmente o comportamento de `createLazyPageLoader` (retry
      de chunk obsoleto via `sessionStorage` + `location.reload`), que já tem
      teste — a memoização não pode cachear uma promise rejeitada.
- [ ] Em `routePreload.ts`, expor `matchRoutePreload(pathname, table)` usando
      `matchPath` do `react-router-dom`, para que `/viagens/:voyageId`,
      `/manifestos/:blId` e `/clientes/:cnpj` casem igual ao router.
- [ ] Em `App.tsx`, declarar a tabela `path → componente lazy` e renderizar um
      `<RoutePreloader />` ao lado de `<DocumentTitle />`, que chama
      `matchRoutePreload(pathname)?.()` num `useEffect` por pathname.
- [ ] Teste de cobertura do mapa: extrair os `<Route path="...">` de
      `src/App.tsx` com a mesma regex de `scripts/check-docs.mjs:131` e afirmar
      que toda rota que renderiza `withSuspense(...)` tem entrada de preload.
      Sem isso o mapa diverge do router silenciosamente.
- [ ] Teste de `matchRoutePreload` cobrindo rota estática, rota com param e
      pathname sem correspondência.

### Task 4: `preconnect` para as origens externas

**Arquivos:**
- Modificar: `index.html` ou `vite.config.ts`
- Modificar/criar: `src/__tests__/indexHtmlPreconnect.test.ts`

- [ ] Emitir `<link rel="preconnect" crossorigin>` para a origem de
      `VITE_SUPABASE_URL` e para `https://olinda.bcb.gov.br` (usado pelo
      `HeaderInfoBar` via `useRoeHeaderRate`).
- [ ] Preferir um `transformIndexHtml` em `vite.config.ts` à substituição
      `%VITE_SUPABASE_URL%` direta no HTML: assim dá para emitir só a origem
      (sem path) e **omitir** a tag quando a env var não existir, em vez de
      deixar um literal quebrado no HTML de produção.
- [ ] Conferir que a CSP de `firebase.json` não precisa mudar — `preconnect`
      não é fetch e não passa por `connect-src`, que já libera as duas origens.
- [ ] Teste afirmando que o HTML transformado contém as duas tags quando a env
      var está definida, e nenhuma tag com `undefined` quando não está.

### Task 5: Teto quadrático na montagem do Line Up

**Arquivos:**
- Modificar: `src/services/lineup.ts`
- Modificar/criar: `src/services/__tests__/lineup.test.ts`

- [ ] Substituir o laço aninhado de `lineup.ts:161-168` (veículos ×
      `distinctContainers` por rota) por um índice `Map<container_id, chave>`
      construído uma vez junto com `distinctContainers`.
- [ ] Preservar exatamente a semântica atual de `vehicleContainerKeys` e do
      `carContainers` derivado dela.
- [ ] Teste com veículos apontando para container por `container_id` e por
      `bl_id`, incluindo veículo sem container, garantindo contagem idêntica à
      de antes.

### Task 6: Alinhar o orçamento do `size-limit` ao build real

**Arquivos:**
- Modificar: `package.json`

- [ ] Remover `dist/assets/supabase-*.js` do array `path` — `manualChunks` em
      `vite.config.ts` dobra `@supabase` e `@tanstack` dentro de `vendor-data`,
      então o glob não casa com nada desde então.
- [ ] Incluir os chunks que o `index.html` gerado pré-carrega com
      `modulepreload` e hoje ficam de fora: `exports-*.js` (Sentry, ~10,5 kB gz)
      e `utils-*.js` (~9,6 kB gz).
- [ ] Rodar `npm run build && npx size-limit`, registrar o número novo e ajustar
      o `limit` só se o real ultrapassar 250 kB — se ultrapassar, **não** subir
      o teto sem registrar o motivo.

### Task 7: Documentação viva

**Arquivos:**
- Modificar: `docs/adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md`
- Modificar: `docs/RASTREABILIDADE.md`
- Modificar: `docs/ARCHITECTURE.md` (se citar Realtime)
- Modificar: `docs/CHANGELOG.md`
- Modificar: `docs/plans/README.md`
- Mover: este arquivo para `docs/archive/plans/`

- [ ] ADR 0034 (`:151`) afirma que `useOperationalCounts` "já assina
      `postgres_changes` em `alerts`". **Não reescrever o texto histórico** —
      acrescentar nota editorial datada registrando que a assinatura existia no
      cliente mas a tabela nunca entrou na publication, e que foi removida aqui.
- [ ] Atualizar a linha de `alerts` em `docs/RASTREABILIDADE.md:208` para
      refletir que a invalidação passa a vir de `staleTime`, não de Realtime.
- [ ] Registrar a entrega em `docs/CHANGELOG.md`.
- [ ] Ao concluir: `git mv` deste plano para `docs/archive/plans/` e remover a
      linha de `docs/plans/README.md`, no mesmo change.

### Task 8: Verificação final

**Arquivos:** nenhum.

- [ ] `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.
- [ ] `npx size-limit` e `node --experimental-vm-modules scripts/perf/measure-page-load.mjs`
      — o segundo deve continuar com 0 rotas acima do orçamento.
- [ ] `git diff --check` e leitura do diff completo.
- [ ] Re-medir no banco depois do deploy: `realtime.apply_rls` deve parar de
      crescer em `pg_stat_statements` e a média das consultas de aplicação sobre
      `bl_containers` deve cair de 22–70 ms para poucos milissegundos.
      Registrar o antes/depois.
- [ ] Reportar exatamente quais gates passaram.

---

## Fora do escopo desta PR

Deliberadamente adiado, com motivo:

- **Waterfalls de dados (achado D do audit)** — `useViagemSchedulesAndStats`
  gated em `useVoyages()`, as três fases de `fetchLineUpSnapshot`, as três de
  `listDemurrageContainers`. É refactor de risco real, e a Task 1 muda a
  aritmética: com o banco liberado cada salto cai para poucos milissegundos.
  **Re-medir depois do deploy e decidir com número na mão**, não antes.
- **`AppLayout` declarado em duas posições de rota** (`src/App.tsx`, ramo normal
  e ramo `adminOnly`) — causa remount ao atravessar `/admin/usuarios`.
  Reestruturar rotas mexe em guard de autorização; merece mudança própria.
- **Dois clientes Supabase instanciados no load do módulo**
  (`src/services/supabase.ts`) — o app interno só usa `supabase`, mas
  `supabasePortal` sobe junto com seu próprio GoTrue. Tornar o do Portal
  preguiçoso mexe em fronteira de sessão; merece mudança própria.
- **74 foreign keys sem índice de cobertura** e **5 `auth_rls_initplan` em
  tabelas `portal_*`** — todos `INFO`/`WARN` do advisor, irrelevantes no volume
  atual (maior tabela do projeto: 1.378 linhas). Entram na conta quando as
  tabelas crescerem.
- **Lint vermelho em `src/components/demurrage/InvoiceDocument.tsx`** — três
  erros `no-constant-binary-expression` vindos de `424eb13`/`1181b69`, já
  presentes no `main` e bloqueando toda PR. É código de produto de outra
  mudança: decidir se os blocos `{false && ...}` saem de vez ou voltam atrás de
  condição real cabe a quem fez a mudança de datas de pagamento. Se continuar
  vermelho quando esta PR for executada, corrigir no `main`, não aqui.
