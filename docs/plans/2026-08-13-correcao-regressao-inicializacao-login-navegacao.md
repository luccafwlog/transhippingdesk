# Correção da regressão de inicialização, login e primeira navegação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar `superpowers:executing-plans`
> (ou `superpowers:subagent-driven-development`) para executar tarefa a tarefa.
> Passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** identificar com medição autenticada a camada que ainda torna o
primeiro acesso lento e corrigir o caminho crítico sem degradar segurança,
isolamento das sessões ou consistência dos dados.

**Arquitetura:** instrumentar separadamente Hosting, JavaScript, Auth, perfil e
queries da rota; comparar visita fria, login e navegação aquecida. A correção
será escolhida pelo maior tempo exclusivo medido, com teste de regressão e
orçamento automatizado no seam correspondente.

**Stack:** React 19, React Router, TanStack Query, Supabase Auth/PostgREST,
Firebase Hosting, Vite, Vitest e Playwright/CDP para trace de navegador.

---

## Evidência de partida

- **Runtime:** a PR #526 foi mergeada e o Firebase publicou o merge e commits
  posteriores com sucesso.
- **Runtime:** três acessos a `https://transhipping-desk.web.app/` mediram
  `1,011 s`, `0,297 s` e `0,327 s`; a conexão fria responde por parte do padrão
  relatado, mas não mede Auth nem dados.
- **Código:** o preload da rota, o `preconnect`, a retirada dos canais Realtime
  órfãos e a migration `289_drop_orphan_realtime_publication.sql` continuam no
  `main`.
- **Suspeita:** a verificação pós-deploy exigida pelo plano anterior
  (`realtime.apply_rls`, latência de queries e publication efetiva) não possui
  evidência persistida.
- **Inconclusivo:** o build local chegou a `vite transforming...` e não terminou
  em mais de dois minutos; não pode ser tratado como falha nem como gate verde.

## Execução nesta PR

- **Implementado:** harness Playwright frio/quente em
  `scripts/perf/measure-authenticated-startup.mjs`, comando npm, documentação
  sanitizada e exclusão do relatório em `.gitignore`.
- **Implementado:** `Cache-Control: no-cache, no-store, must-revalidate` também
  para a rota `/` do Firebase Hosting, evitando que o rewrite do shell SPA seja
  servido com cache de uma hora.
- **Implementado:** checkpoints de `entry`, sessão, perfil, chunk da rota e
  dados do Painel em `performance.mark` e breadcrumbs de baixa cardinalidade,
  sem usuário, token, query string ou payload.
- **Verificado:** typecheck, lint, `docs:check`, testes focados (20/20), build,
  `size-limit` (173,52 kB brotli, limite 250 kB), harness de parse/compile (37
  rotas, 0 acima de 50 ms) e `git diff --check` passaram no worktree isolado.
- **Bloqueado:** a medição autenticada real não foi executada porque não há
  credencial interna de teste disponível; o comando retorna erro seguro quando
  as três variáveis obrigatórias não estão definidas. A verificação de
  `pg_stat_statements`/publication também exige acesso administrativo ao
  Supabase. Nenhuma correção de Auth ou waterfall foi inventada sem essa
  evidência.

### Task 1: Criar o feedback loop autenticado

**Arquivos:**
- Criar: `scripts/perf/measure-authenticated-startup.mjs`
- Criar: `scripts/perf/README.md`
- Modificar: `package.json`

- [x] Implementar um script CDP/Playwright que receba URL e credenciais apenas
  por variáveis de ambiente, crie contexto novo por rodada e nunca grave tokens.
- [ ] Medir cinco rodadas frias e cinco quentes de `/login` para `/painel`,
  registrando `navigationStart`, FCP, login concluído, perfil concluído,
  primeiro shell, primeira rota e fim das queries iniciais.
- [x] Salvar somente resumo sanitizado em JSON: mediana, p95, quantidade de
  requests, bytes e as dez requests mais lentas por categoria.
- [x] Fazer o comando falhar quando login-até-shell exceder `2.000 ms` ou
  navegação interna aquecida exceder `1.000 ms`; os valores devem ser
  confirmados com o responsável depois do primeiro baseline.
- [ ] Executar `npm run perf:authenticated-startup` e confirmar que o comando
  reproduz o sintoma antes de mudar produto.

### Task 2: Verificar a correção anterior no ambiente real

**Arquivos:**
- Criar: `docs/archive/reports/2026-08-13-baseline-performance-producao.md`

- [ ] Confirmar em `pg_publication_tables` que `supabase_realtime` não contém
  `vessel_schedules`, `alerts` nem `demurrage_invoices`.
- [ ] Capturar dois snapshots separados por dez minutos de
  `pg_stat_statements` para `realtime.apply_rls`; a contagem não pode crescer
  por consumidores deste app.
- [ ] Medir `EXPLAIN (ANALYZE, BUFFERS)` das consultas de `user_profiles`, das
  cinco contagens de `useOperationalCounts` e do Line Up com um usuário interno
  representativo.
- [ ] Registrar ambiente, commit, horário, perfil, medianas e planos; não
  registrar PII, JWT, anon key ou payloads de clientes.

### Task 3: Isolar a camada dominante

**Arquivos:**
- Modificar: `scripts/perf/measure-authenticated-startup.mjs`
- Modificar: `docs/archive/reports/2026-08-13-baseline-performance-producao.md`

- [ ] Rodar a matriz: cache vazio/quente, sessão ausente/válida, `/painel` e
  uma segunda rota lenta indicada pelo usuário.
- [ ] Classificar cada intervalo em Hosting/TLS, JS, `getSession`/refresh,
  `user_profiles`, shell global, query da rota e render.
- [ ] Testar uma variável por vez: conexão reutilizada, sessão local válida,
  rota sem dados e rota com dados.
- [ ] Escolher uma única causa primária apenas se ela explicar o padrão frio
  lento/quente rápido e reduzir materialmente o tempo ao ser removida do trace.

### Task 4A: Corrigir Auth/perfil, se dominantes

**Arquivos:**
- Modificar: `src/hooks/useAuth.tsx`
- Modificar: `src/services/supabase.ts`
- Testar: `src/hooks/__tests__/useAuth.test.tsx`

- [ ] Escrever teste com sessão persistida que conte chamadas e prove qual
  operação bloqueia `ProtectedRoute`.
- [ ] Evitar refresh ou hidratação duplicada mantendo `user_profiles.active`
  como requisito antes de liberar o app.
- [ ] Não compartilhar storage entre cliente interno e Portal nem relaxar RLS.
- [ ] Reexecutar o teste focado e o loop autenticado.

### Task 4B: Corrigir queries/waterfalls, se dominantes

**Arquivos:**
- Modificar: `src/services/lineup.ts`
- Modificar: `src/hooks/useViagemSchedulesAndStats.ts`
- Testar: `src/services/__tests__/lineup.test.ts`
- Testar: `src/hooks/__tests__/useViagemSchedulesAndStats.test.ts`

- [ ] Escrever testes que contem rodadas sequenciais e reproduzam a cascata
  observada no trace.
- [ ] Colapsar primeiro somente a rota medida como dominante: paralelizar dados
  independentes ou criar uma RPC de leitura quando a dependência for real.
- [ ] Preservar RLS, filtros, limite de 60 viagens e chaves de cache existentes.
- [ ] Reexecutar testes e comparar mediana/p95 antes e depois.

### Task 4C: Corrigir Hosting/cache/bundle, se dominantes

**Arquivos:**
- Modificar: `firebase.json`
- Modificar: `vite.config.ts`
- Modificar: `package.json`
- Testar: `scripts/perf/measure-page-load.mjs`

- [x] Verificar por que a resposta de `/` publicada retorna
  `Cache-Control: max-age=3600` apesar da regra específica de `index.html`.
- [x] Manter HTML revalidável e assets com hash `immutable`; não cachear HTML
  antigo por uma hora.
- [ ] Comparar grafo inicial e chunks da rota contra o commit `375de629` e
  remover preload estático que não esteja no caminho crítico medido.
- [ ] Rodar `npm run build`, `npm run size-limit` e o harness de parse/compile.

### Task 5: Telemetria preventiva e documentação viva

**Arquivos:**
- Modificar: `src/lib/telemetry.ts`
- Modificar: `docs/ARCHITECTURE.md`
- Modificar: `docs/CHANGELOG.md`

- [x] Emitir checkpoints sem PII para `auth.session`, `auth.profile`, `route.chunk` e
  `route.data`, com amostragem limitada e release associado ao commit.
- [ ] Documentar o orçamento e o procedimento de captura sanitizada.
- [ ] Registrar a causa comprovada, os números antes/depois e por que as outras
  hipóteses foram descartadas.

### Task 6: Verificação e encerramento

**Arquivos:**
- Mover: este plano para `docs/archive/plans/`
- Modificar: `docs/plans/README.md`

- [ ] Repetir dez rodadas frias e dez quentes no mesmo ambiente; exigir melhora
  no intervalo dominante e nenhuma regressão nas navegações aquecidas.
- [ ] Rodar testes focados, `npm run docs:check`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run build`, `npm run size-limit` e
  `git diff --check`.
- [ ] Após deploy, repetir o trace e o snapshot do banco antes de declarar a
  regressão corrigida.
- [ ] Mover o plano para o arquivo histórico e retirar sua linha do índice no
  mesmo change da conclusão.
