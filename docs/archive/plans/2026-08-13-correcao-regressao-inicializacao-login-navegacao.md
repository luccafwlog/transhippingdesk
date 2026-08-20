# Correção da regressão de inicialização, login e primeira navegação

> **Nota editorial — arquivado em 2026-08-20 por superação, não por conclusão.**
>
> Este plano foi escrito quando o frontend era servido por **Firebase Hosting**.
> A PR #552 migrou o hosting para **Vercel** e removeu
> `.github/workflows/firebase-deploy.yml`; `firebase.json` permanece apenas como
> rollback temporário, conforme `docs/setup/deploy.md`. A Task 4C, que edita
> esse arquivo, perdeu o alvo.
>
> O que restou coberto por outro caminho:
>
> - a **Task 2 foi concluída** e descartou o banco como gargalo; o relatório
>   está em
>   [`../reports/2026-08-13-baseline-performance-producao.md`](../reports/2026-08-13-baseline-performance-producao.md);
> - as PRs #554/#555 instalaram Vercel Analytics e Speed Insights
>   (`src/main.tsx`), que dão monitoramento de usuário real e cobrem boa parte
>   do diagnóstico que o harness frio/quente existia para produzir;
> - o harness `scripts/perf/measure-authenticated-startup.mjs` e o comando
>   `npm run perf:authenticated-startup` **continuam vivos e utilizáveis** — a
>   PR #552 atualizou `scripts/perf/README.md` para `transhippingdesk.com.br`.
>   Foi o plano que perdeu o sentido, não a ferramenta.
>
> As Tasks 1 (último passo), 3, 4A e 4B nunca foram executadas: dependem de uma
> medição autenticada que exige rede irrestrita, indisponível no ambiente remoto.
>
> **Resíduo não resolvido.** A Task 4C trocou o escopo da regra de
> `Cache-Control` de caminhos literais para `**` no `firebase.json`, porque um
> link salvo para `/painel` ou `/login` não recebia `no-store` e podia servir um
> `index.html` antigo. Em `vercel.json` a regra voltou a ser o caminho literal
> `/index.html`. Não foi possível confirmar se isso é defeito ativo: depende do
> default do Vercel para HTML reescrito, e o proxy do ambiente responde `403`
> para o domínio de produção. Fica registrado aqui para quem retomar o tema.

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
- **Implementado:** `Cache-Control: no-cache, no-store, must-revalidate` para
  `**` (avaliado no path original da requisição, antes do rewrite do Firebase
  Hosting para `/index.html`), com a regra de `/assets/**` posicionada depois
  para preservar o cache imutável dos assets com hash. A regra anterior só
  cobria `/` e `/index.html` literais, então um link salvo para `/painel` ou
  `/login` não recebia `no-store` e podia servir um `index.html` antigo,
  referenciando assets já removidos após um deploy.
- **Implementado:** checkpoints de `entry`, sessão, perfil, chunk da rota e
  dados do Painel em `performance.mark` e breadcrumbs de baixa cardinalidade,
  sem usuário, token, query string ou payload; `markStartupStage` agora marca
  cada stage no máximo uma vez por carregamento de página (dedupado pelo
  próprio `performance.mark`), porque `route-data` reexecutava a cada refetch
  do Painel (90s) e `route-chunk` reexecutava em toda navegação interna,
  inundando o buffer de 100 breadcrumbs do Sentry com marcas sem valor
  diagnóstico.
- **Verificado:** typecheck, lint, `docs:check`, testes focados (20/20), build,
  `size-limit` (173,52 kB brotli, limite 250 kB), harness de parse/compile (37
  rotas, 0 acima de 50 ms) e `git diff --check` passaram no worktree isolado.
- **Bloqueado:** a medição autenticada real não foi executada porque não há
  credencial interna de teste disponível; o comando retorna erro seguro quando
  as três variáveis obrigatórias não estão definidas. A verificação de
  `pg_stat_statements`/publication também exige acesso administrativo ao
  Supabase. Nenhuma correção de Auth ou waterfall foi inventada sem essa
  evidência.

### Atualização 2026-08-13 (segunda sessão)

- **Desbloqueado — Task 2 concluída.** A verificação de banco exigia acesso
  administrativo ao Supabase, que esta sessão possuía. Resultados em
  [`docs/archive/reports/2026-08-13-baseline-performance-producao.md`](../archive/reports/2026-08-13-baseline-performance-producao.md).
  A camada de banco está descartada como gargalo.
- **Bloqueio das Tasks 1 (último passo), 3 e 4A mudou de natureza.** A
  credencial interna de teste foi fornecida e **é válida** (`POST
  /auth/v1/token` responde `200` via `curl` a partir do container). O que
  impede a medição agora é a **política de rede do ambiente remoto**, não a
  falta de credencial:
  - `transhipping-desk.web.app` é recusado no CONNECT do proxy (`403`), então
    não há como medir Hosting/TLS reais daqui;
  - o Chromium do container não alcança `*.supabase.co` por nenhum método
    (`ERR_CONNECTION_RESET` no POST de auth, `Failed to fetch` em GET),
    embora `curl` pelo mesmo proxy funcione. Servir o build de produção em
    `vite preview` local contorna o Hosting, mas não o bloqueio do browser.
  - **Consequência:** `npm run perf:authenticated-startup` precisa rodar numa
    máquina com rede irrestrita (a do responsável ou um runner de CI com
    egresso liberado). O harness em si está pronto e foi exercitado até o
    ponto do POST de login.

### Task 1: Criar o feedback loop autenticado

**Arquivos:**
- Criar: `scripts/perf/measure-authenticated-startup.mjs`
- Criar: `scripts/perf/README.md`
- Modificar: `package.json`

- [x] Implementar um script CDP/Playwright que receba URL e credenciais apenas
  por variáveis de ambiente, crie contexto novo por rodada e nunca grave tokens.
- [x] Medir N rodadas frias (`/login` até `/painel`, contexto novo) e a
  navegação interna aquecida subsequente (`/painel` até `/chegadas-saidas`, mesma
  sessão) em cada rodada, registrando FCP, `domContentLoaded` e o tempo total
  de cada fase. Os checkpoints de login concluído/perfil concluído dependem da
  Task 4A (ainda bloqueada); hoje o script mede o intervalo login→shell como um
  todo, não os sub-estágios internos.
- [x] Salvar somente resumo sanitizado em JSON: mediana, p95 (frio e quente
  separados), bytes totais e as dez requests mais lentas por categoria de
  recurso.
- [x] Fazer o comando falhar quando login-até-shell (frio) exceder `2.000 ms`
  ou navegação interna aquecida exceder `1.000 ms`; os valores devem ser
  confirmados com o responsável depois do primeiro baseline.
- [ ] Executar `npm run perf:authenticated-startup` e confirmar que o comando
  reproduz o sintoma antes de mudar produto.

### Task 2: Verificar a correção anterior no ambiente real

**Arquivos:**
- Criar: `docs/archive/reports/2026-08-13-baseline-performance-producao.md`

- [x] Confirmar em `pg_publication_tables` que `supabase_realtime` não contém
  `vessel_schedules`, `alerts` nem `demurrage_invoices`. A publication está
  vazia — não contém nenhuma tabela.
- [x] Capturar dois snapshots separados por dez minutos de
  `pg_stat_statements` para `realtime.apply_rls`; a contagem não pode crescer
  por consumidores deste app. Três snapshots em 11min35s: crescimento **zero**
  em chamadas e em tempo. Os 45,3% da auditoria de 2026-08-12 são resíduo
  histórico acumulado antes da migration `289`.
- [x] Medir `EXPLAIN (ANALYZE, BUFFERS)` das consultas de `user_profiles`, das
  cinco contagens de `useOperationalCounts` e do Line Up com um usuário interno
  representativo. Medido com `set local role authenticated` + claims, para que
  a RLS entre no plano. Faixa de 0,095 ms a 32,1 ms; RLS promovida a InitPlan.
- [x] Registrar ambiente, commit, horário, perfil, medianas e planos; não
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
