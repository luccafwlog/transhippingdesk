# Revisão sistemática do Transhipping Desk — 2026-09-12

Registro histórico. Snapshot do branch `claude/transhipping-desk-audit-aepxhc`
no commit `0e53091`, árvore limpa.

Revisão de diagnóstico coordenada em múltiplas frentes, com sub-agentes
dedicados. Nenhuma mutação em produção, nenhum teste de integração do Supabase
executado, nenhum hook de proteção contornado.

## Método e labels de evidência

Segue `docs/CONVENCOES.md`. Os labels usados aqui:

- **Código** — verificável por leitura estática do código-fonte.
- **Teste** — coberto por asserção automatizada.
- **Teste de contrato SQL** — inspeção textual de migration. Detecta drift no SQL
  versionado; **não** prova migration aplicada, grant remoto, RLS em execução nem
  atomicidade real.
- **Runtime local** — observado em PostgreSQL 16 descartável e/ou no navegador
  contra a pilha local. **Não prova o banco gerenciado de produção.**
- **Suspeita** — hipótese ou risco não verificado.

### Ambiente montado para esta revisão

| Peça | Estado |
|---|---|
| PostgreSQL 16 local (`transhipping_test`) | Criado por `scripts/setup-local-pg.sh`; 40 migrations aplicadas |
| PostgreSQL 16 local (`app`) | Bootstrap da skill `design-audit` + seed sintético, para a pilha de UI |
| Shim Supabase (`scripts/design-audit/sb-shim.cjs`) | Porta 54321, 216 FKs carregadas |
| SPA Vite | `http://127.0.0.1:5173`, login `auditor@local.test` |

**Ressalva metodológica registrada porque afetou a análise:** o banco `app`
recebeu grants amplos de conveniência (`grant execute on all functions ... to anon`)
para a UI funcionar localmente. Qualquer conclusão sobre **grants** tirada dele é
falsa. Todas as afirmações sobre grants neste relatório vêm de
`transhipping_test`, que não tem esses grants. A frente de Segurança detectou
essa contaminação de forma independente, usando como prova a própria guarda da
migration `009`, que aborta a aplicação se o grant existir.

### Estado dos gates (evidência Runtime local)

| Gate | Resultado |
|---|---|
| `npm run typecheck` | Passa, sem saída |
| `npm run lint` | Passa, sem aviso |
| `npm test` | **578 arquivos passaram, 21 pulados; 3.092 testes passaram, 98 pulados**; 99,54 s |
| `npm run docs:check` | Passa — 216 Markdown, 49 rotas, índice de ADRs |
| `npm run rpc:check` | Passa — 173 nomes de RPC resolvem em `public.pg_proc` |
| `npm run build` | Passa — 2,07 s |
| `npm run size-limit` | Passa — 191,97 kB contra orçamento de 250 kB |
| Replay das 40 migrations do zero | **Sem um único erro**; 118 tabelas, 687 funções, 8 jobs de cron |

Nenhum gate do `WORKFLOW.md` §11 falha. Essa é a linha de base positiva.

---

## 1. Resumo executivo — os 5 principais riscos

Ordenados por risco real, independentemente da frente de origem.

As frentes de design visual, UX e acessibilidade, interrompidas na primeira
passagem, foram retomadas e concluídas na mesma data (ver seção 3).

### 1. O verde da suíte não cobre dinheiro, PIX nem autorização · `alto`

Os 98 testes "pulados" do `npm test` são as 20 suítes
`src/integration/*.local-pg.test.ts`, desligadas por padrão atrás de
`LOCAL_PG_INTEGRATION=1`. São exatamente as que verificam `demurrageMoney`,
`demurrageAuthority`, `pixBrCode`, `importAtomicity`, `auditSecurityBoundaries`,
`localBillingIntegrity` e `exchangeRateIntegrity`. O gate local do `WORKFLOW.md`
§11 não manda ligá-las, então o caminho padrão do desenvolvedor **nunca** executa
as provas de dinheiro e de fronteira de autorização. O número "3.092 testes
passando" é verdadeiro e, ao mesmo tempo, mais estreito do que aparenta.
Agrava-se porque parte relevante do que resta é **Teste de contrato SQL** —
inspeção de texto de migration, que o próprio repositório já classifica como
prova fraca. → [TEST-C1], [TEST-C2], [TEST-03]

### 2. A guarda que "prova" ausência de policy permissiva julga SQL morto · `médio`, impacto de assurance alto

`portalAuthenticatedBoundaryMigration.test.ts` é citado no baseline de
2026-08-24 como prova automatizada de que nenhuma policy viva concede acesso
irrestrito. Ele varre `supabase/migrations/` **unida** a `migrations_archive/`,
ordenada alfabeticamente: 423 arquivos, duas linhas do tempo independentes
intercaladas — o schema vivo é replayado na terceira posição e depois sobrescrito
por ~380 migrations mortas. Reproduzindo o replay: das 356 policies que o teste
julga "vivas", **195 são julgadas pelo texto de migration que não é mais
aplicada**, e 77 sequer existem no banco. O schema atual **não vaza** (conferido
direto em `pg_policies`), mas a guarda não é prova disso. O mesmo harness sustenta
invariante sobre `can_edit_customers()`, função que já não existe. → [SEC-01]

### 3. O anel de foco é invisível em todo o design system · `crítico` (acessibilidade)

`.app-btn` e `.app-input` fazem `outline: 0` e substituem o indicador nativo por
um halo a 22 % de opacidade. Medido no navegador e confirmado por cálculo
independente: **1,36:1** sobre o creme do painel e **1,38:1** sobre o branco de
card/modal, contra os **3:1** que a WCAG 2.4.11 exige (e falhando 2.4.7). São as
duas primitivas mais usadas do produto, ou seja, praticamente todo botão e todo
campo de todas as telas. O perfil deste sistema é o operador que passa o dia com
as mãos no teclado — é exatamente quem mais perde. O `npm run a11y:contrast` não
detecta porque compara pares de texto, não o token de foco. → [A11Y-01]

### 4. A tela operacional mais visível imprime UUID cru no lugar do terminal · `alto`

No Line Up de `/painel` (e, pela mesma função, em `/line-up-tv/display`), a coluna
**Terminal** exibiu `d0000000-0000-4000-8000-000000000001` em duas linhas,
enquanto uma terceira mostrava corretamente `TBC`. A causa é
`src/services/lineup.ts:142`: `terminalCodes.get(front.terminalId) ?? front.terminalId`
— o fallback de um código de terminal não resolvido é o próprio UUID. Não depende
de dado corrompido: basta a RLS filtrar o depot para aquele perfil, o depot estar
desativado, ou a leitura de `depots` falhar. O rótulo correto (`TBC`) já existe e
está na legenda da própria tabela. → [UX-01]

### 5. Dois defeitos distintos fazem um valor monetário mentir na tela · `médio` / `alto`

Chegaram por frentes diferentes e têm a mesma consequência: o número em reais que
a pessoa lê não corresponde ao que o sistema sabe.

- `fmtBRL`/`fmtUSD` fazem `Number(v ?? 0)`, então `null`, `undefined` e `''` saem
  como **`R$ 0,00`** — iguais a um zero legítimo. Num documento que vai ao
  cliente, "não temos esse valor" e "esse valor é zero" não são a mesma coisa: um
  campo que veio nulo (conversão falha, tarifa não resolvida, ROE ausente) vira
  uma cobrança de R$ 0,00 sem sinal nenhum para quem confere. → [DOC-01]
- Na Conciliação PIX, a coluna de valor do B/L usa `text-[#d2a8ff]`, uma cor que
  escapou da camada de compatibilidade de tema e renderiza a **1,73:1** no tema
  padrão — texto praticamente invisível sobre o fundo creme. → [UI-01]

### O que está sólido (registrado com a mesma seriedade)

Um relatório que só lista problemas distorce a leitura de risco. Os pontos abaixo
foram verificados e **não** produziram achado:

- **Segurança de fronteira.** 0 tabelas sem RLS; 0 policies vivas de SELECT/ALL
  com `USING (true)`; 0 funções `SECURITY DEFINER` sem `search_path`; 0 tabelas
  concedidas a `anon`; 0 segredos versionados; 0 literais de segredo em
  `cron.job.command`. `anon` executa **exatamente uma** função,
  `portal_ship_schedule` — a única exceção que a ADR 0047 admite.
- **Os dois pendentes de segurança do baseline estão fechados.** O grant a
  `PUBLIC` em `upsert_portal_invoice_exception` (achado de catálogo da PR #659)
  foi revogado pela migration `009`, que ainda **aborta a própria aplicação** se o
  grant existir (`009_rpc_entry_security.sql:365,388-390`).
- **Telemetria.** Além de `sendDefaultPii: false`, há `beforeSend` higienizando
  exceção, mensagem, `extra`, breadcrumbs (mensagem e dados), query string,
  `Referer` e tags. Identidade é só id + papel. É o ponto mais bem resolvido da
  revisão.
- **Dinheiro na fatura.** O total é autoridade do banco
  (`SUM(total_value_brl)` em `create_invoice_from_bls_core:272-273`) e os
  subtotais somam os **mesmos** valores persistidos: não existe a divergência
  clássica "soma dos subtotais ≠ total".
- **Qualidade de código.** `lint` e `typecheck` limpos; **0 `any`** explícito
  fora de testes em 1.013 arquivos; **0 `catch` vazio**; 52 comentários
  `ponytail:` seguindo a convenção de verdade.
- **Integridade do schema.** 0 tabelas sem PK, 0 sem RLS; a distinção
  `RESTRICT`/`CASCADE` entre tabelas fiscais e filhos operacionais é deliberada.
- **Importação.** Praticamente todo importador termina numa RPC
  `*_transactional`/`*_atomic` no banco, não num laço de escritas no navegador.

---

## 2. Achados por frente

Severidade decrescente dentro de cada frente. O detalhamento completo de cada
item (evidência, comando, recomendação) está nos relatórios de frente que
originaram esta consolidação.

### Frente 1 — Segurança e superfícies de ataque

| Id | Sev. | Achado |
|---|---|---|
| SEC-01 | médio | Guarda de policy permissiva varre migrations ativas e arquivadas misturadas; 195 de 356 policies julgadas por SQL morto |
| SEC-02 | baixo | `ensure_customer_contact_email` e `customer_communication_recipient_allowed` guardam com `auth.uid() IS NOT NULL AND NOT is_active_user()`: ausência de `sub` vira autorização. Não explorável hoje (`anon` sem EXECUTE), mas falha aberta **por forma**. A forma correta já existe em `register_portal_login_abuse` |
| SEC-03 | baixo | `list_alert_queue` chama o núcleo com `p_limit=200` contra teto de 100 — sempre aborta. RPC morta ainda concedida a `authenticated` |

**Nada crítico novo.** A postura defensiva se sustentou em todas as verificações
de fronteira.

### Frente 4 — Fluxos de negócio (regressão funcional)

| Id | Sev. | Achado |
|---|---|---|
| FLUXO-01 | baixo | **Atualização de status do baseline:** a atomicidade da importação de datas de container subiu de *linha* para *B/L* (`containerDatesImport.ts:111-134`). O residual (sem rollback do lote) permanece, mas o B/L é a unidade de faturamento — é fronteira transacional defensável |
| FLUXO-02 | baixo | `cacheEffects.ts` expõe 7 efeitos de domínio, mas só 6 arquivos fora de testes o consomem; parte das mutações ainda invalida query key à mão no ponto de uso |

Sem regressão identificada. Sem divergência vs `RASTREABILIDADE.md` nesta frente.

### Frente 5 — Relatórios e documentos imprimíveis

| Id | Sev. | Achado |
|---|---|---|
| DOC-01 | médio | Valor ausente e zero genuíno impressos de forma idêntica (`R$ 0,00`) |
| DOC-03 | médio | **Zero** regras `break-inside`/`page-break` em todo o CSS: numa consolidada com dezenas de containers, a barra de total, a faixa de grupo ou o QR Code PIX podem partir entre páginas (mitigado em parte por `<thead>`, que os navegadores repetem) |
| DOC-02 | baixo | Entrada não numérica imprime literalmente `R$ NaN` (alcançabilidade **Suspeita**) |
| DOC-04 | baixo | Nome do arquivo da consolidada sem teto: 50 B/Ls geram 895 caracteres, acima do limite usual de 255 |
| DOC-05 | baixo | Negativo sai como `R$ -1.234,56` em vez de `-R$ 1.234,56` |

**Sem achado de cálculo** — ver [DOC-00] no relatório da frente.

### Frente 7 — Banco de dados e migrations

| Id | Sev. | Achado |
|---|---|---|
| DB-01 | médio | `charge_calculations.container_id` e `demurrage_invoice_items.container_id` sem índice, mas consultadas por `.in()` a cada exclusão de container |
| DB-03 | médio | `src/types/database.ts` sem a coluna `customer_communication_attempts.recipient_key`, real desde a migration `039` |
| DB-04 | médio | `bl_containers` sem `UNIQUE(bl_id, container_number)`; o padrão de reimportação é delete-then-insert, então arquivo malformado com container duplicado no mesmo B/L geraria linhas duplicadas e possível duplo cálculo |
| DB-02 | baixo | 6 colunas de junção de `invoice_items` sem índice (uso não confirmado no frontend) |
| DB-06 | baixo | Gap de numeração `013→015`; cosmético, com precedente aceito na ADR 0062 |

### Frente 8 — Qualidade de código e dívida técnica

| Id | Sev. | Achado |
|---|---|---|
| CQ-01 | baixo | `DepotCadastro.tsx` concentra várias instruções por linha (um `useEffect` inteiro em uma linha); diff ilegível, é o único arquivo com esse estilo |
| CQ-02 | baixo | Duas supressões de `react-hooks/set-state-in-effect` escondem sincronização de estado derivado. **O risco de reset do formulário NÃO se materializa**: `refetchOnWindowFocus: false` é global |

**A dívida técnica desta base é pequena e está sob controle** — conclusão apoiada
nos números da seção anterior, não em cortesia.

### Frente 9 — Cobertura de testes

| Id | Sev. | Achado |
|---|---|---|
| TEST-C1 | alto | Suítes de dinheiro, PIX e fronteiras de segurança fora do `npm test` |
| TEST-C2 | médio | As suítes `local-pg` não são idempotentes (fixtures de ID fixo, sem limpeza) nem seguras em paralelo (contagem absoluta sobre banco compartilhado). Comprovado em 4 execuções comparadas: `auditSecurityBoundaries` passa **8/8 isolada** e falha em paralelo |
| TEST-03 | baixo | "Teste de contrato SQL" soma ao total agregado e infla a leitura de garantia comportamental |

**Não há fluxo crítico sem nenhum teste.** A lacuna é teste que existe e não roda.

### Frente 10 — Performance

| Id | Sev. | Achado |
|---|---|---|
| PERF-01 | médio | Importação da base de clientes faz **um round-trip sequencial por linha** (`customerBase.ts:68-88`). O isolamento por linha é deliberado e bem justificado; o custo é latência (2.000 clientes ≈ 100–160 s) |
| ENV-02 | baixo | O orçamento de bundle não mede 7 chunks pré-carregados (11.936 B gzip) |

Sem N+1 por item, sem Context não memoizado, sem full-scan nos caminhos quentes —
todos verificados e registrados como resultado negativo.

### Frente 11 — Acessibilidade

| Id | Sev. | Achado |
|---|---|---|
| A11Y-01 | crítico | Anel de foco a 1,36:1 / 1,38:1 contra os 3:1 exigidos, em `.app-btn` e `.app-input` |
| A11Y-02 | alto | `/viagens`: o campo de busca principal zera o foco explicitamente |
| A11Y-03 | médio | Menu de usuário — que contém "Sair" — também remove o contorno de foco |
| A11Y-04 | médio | Badges de pendência da navegação: branco sobre dourado a 2,85:1 |
| A11Y-05 | alto | O `Combobox` de viagem não tem nome acessível (`ui/Combobox.tsx:154-156` usa `<div>`+`<span>` em vez de `<label>`). Causa única, cinco telas: `/baplie`, `/veiculos`, `/granito`, `/embarquevazios` (2×) |
| A11Y-06 | médio | Campos avulsos sem rótulo em `/revisao` (3×), `/admin/usuarios` (3×) e `/carga-solta` (1×) — três deles `<select>` sem rótulo **e** sem placeholder |
| A11Y-07 | médio | `/manifestos/:blId` e `/clientes/:cnpj` não têm **nenhum** título (`h1`/`h2`/`h3`) na página |
| A11Y-08 | médio | Caixas de seleção das tabelas têm 13×13 px; WCAG 2.5.8 pede 24×24 |
| A11Y-09 | baixo | `<th>` sem `scope` em `/chegadas-saidas` (11/11), `/alertas` (7/7) e `/clientes/comunicacao` (6/6) |

Resultados negativos medidos em 29 rotas: **zero** código de máquina cru na
interface, zero botão sem nome acessível, zero `<img>` sem `alt`, zero overflow
horizontal (1440px e 390px) e **toda** tabela larga rolando em container próprio
no mobile.

### Frente 3 — Design visual, consistência de UI e dark mode

| Id | Sev. | Achado |
|---|---|---|
| UI-01 | alto | A paleta escura do GitHub está hardcoded em ~120 utilitários Tailwind (18 arquivos) e o que a corrige no tema claro é uma **allowlist enumerada à mão** em `index.css:4782`. Duas cores escaparam: `text-[#d2a8ff]` pinta um **valor em R$** da Conciliação PIX a **1,73:1**, e `bg-[#111820]` deixa um card quase preto sobre o fundo creme |
| UI-02 | médio | `--app-accent` **nunca é definido**; os dois consumidores caem em fallbacks **diferentes** (azul e âmbar). No tema escuro o fallback azul dá 2,86:1 em texto — o token correto daria 9,71:1 |
| UI-03 | baixo | `--app-radius` muda entre temas (8px claro, 12px escuro): token estrutural tratado como decisão de tema |
| UI-04 | baixo | A paleta da timeline de viagem tem 18 hex fora dos tokens e não acompanha o tema (14/18 abaixo de 4,5:1 no escuro). **Não é falha WCAG** — a faixa é decoração redundante, o título em texto carrega o significado |
| UI-05 | baixo | A aplicação ignora `prefers-color-scheme`: quem usa o SO no escuro abre no tema creme |

**O tema escuro não está quebrado:** dos 40 tokens, os 34 cromáticos são
redefinidos por completo no bloco `dark`, e os 6 que permanecem iguais são
estruturais e de tipografia — exatamente o que deve permanecer.

### Frente 12 — Observabilidade e configuração (frente adicional)

| Id | Sev. | Achado |
|---|---|---|
| OBS-03 | baixo | `VITE_PORTAL_URL` e `VITE_PORTAL_BILLING_URL` são lidas pelo código e não estão no `.env.example`. Há fallback, então nada quebra — mas essas URLs entram em comunicados enviados ao cliente |

Telemetria, `ErrorBoundary`, ausência de `catch` vazio, fail-closed do runner de
efeitos e segredos de cron no Vault: todos verificados **sem achado**.

### Frente 0 — Ambiente e gates (coordenação)

| Id | Sev. | Achado |
|---|---|---|
| ENV-01 | médio | `npm run dev` aponta para o Supabase de **produção** quando `VITE_SUPABASE_URL` está no ambiente: `loadEnv(mode, cwd, '')` dá precedência a `process.env` sobre o `.env` do desenvolvedor, **sem aviso**. Observado nesta sessão — só o proxy de egresso impediu a conexão |
| ENV-03 | baixo | `engines` exige Node 24.x; a sessão rodou Node 22 (`EBADENGINE`), com todos os gates passando |

---

## 3. Cobertura das frentes e o que continua pendente

As frentes 3, 2 e 11, interrompidas na primeira passagem por limite de sessão da
conta, **foram retomadas e concluídas** na mesma data. A cobertura final:

- **Frente 3 — Design visual e dark mode: concluída.** Tokens extraídos e
  comparados nos três temas (`current`, `dark`, `light`), cores hardcoded
  inventariadas e testadas uma a uma contra a camada de compatibilidade do CSS.
  Cinco achados (UI-01 a UI-05).
- **Frentes 2 e 11 — concluídas.** 29 rotas percorridas a 1440×900 e 10 delas
  também a 390×844, com sonda programática de acessibilidade por rota. Cinco
  achados novos de acessibilidade (A11Y-05 a A11Y-09) e três de UX (UX-02 a
  UX-04).

Continua pendente, declarado:

- **Frente 5 — verificação de impressão.** Nenhum documento foi realmente
  impresso ou renderizado em PDF. Quebra de página, estouro de largura em A4 e
  truncamento de texto longo continuam **Suspeita**.
- **Portal do cliente e modo Inspeção** (`/portal/*`,
  `/clientes/portal/inspecao/*`) não foram percorridos: exigem uma conta de
  Portal provisionada, que o seed sintético não cria.
- **Estados de erro e validação de formulário.** Modais e formulários foram
  vistos apenas onde abriam sem dado adicional; o roteiro de estados de erro por
  tela não foi executado.

O ambiente está montado e documentado — retomar não exige remontar nada.

---

## 4. Divergências de documentação (frente 6)

Separadas para atualização posterior da documentação viva. `docs/archive/` **não**
é drift, por convenção, e não foi reportado.

| Id | Sev. | Documento | Divergência |
|---|---|---|---|
| DRIFT-01 | alto | `docs/ARCHITECTURE.md:641-649` | A tabela "Aplicação interna" é quebrada por um parágrafo de prosa sobre `/revisao` inserido no meio. Em GFM a linha em branco encerra a tabela: ~15 linhas (de `/clientes` a `/perfil`) renderizam como texto solto com pipes literais. Conteúdo correto, formatação quebrada |
| DRIFT-02 | médio | `docs/RASTREABILIDADE.md:12` | Diz "15 Edge Functions"; existem **17** |
| DRIFT-05 | médio | `docs/RASTREABILIDADE.md` | "219 funções SQL de aplicação expostas" bate numericamente, mas são as funções de suporte de `btree_gist` (188) + `pg_trgm` (31) instaladas em `public` — **nenhuma** é RPC de aplicação. Funções reais em `public`: 468 |
| DRIFT-06 | médio | `docs/modules/taxas-locais.md:122` | Cita `PendenciasFaturamentoTab.tsx` (removido) como código vigente de uma ação ativa. A linha 96, que também o menciona, é histórica e legítima |
| DRIFT-03 | baixo | `docs/RASTREABILIDADE.md` | `rpc:check` resolve **173** nomes; a doc registra 168 (bloco datado) |
| DRIFT-04 | baixo | `docs/RASTREABILIDADE.md` | `docs:check` reporta **216** arquivos Markdown; a doc registra 428 (bloco datado) |

Nota sobre DRIFT-05: a causa é benigna e foi rastreada. A varredura default-deny
da migration `003` exclui deliberadamente funções de extensão
(`pg_depend.deptype = 'e'`), então os auxiliares de `pg_trgm`/`btree_gist`
instalados em `public` pela `001:54-55` permanecem executáveis por `PUBLIC`. São
funções puras de texto e índice, que operam só sobre argumentos que o chamador já
possui — **não** é vetor de vazamento. O problema é apenas a contagem
documentada sugerir uma superfície de aplicação que não existe.

**Sem drift confirmado:** cobertura bidirecional de rotas entre `src/App.tsx` e
`ARCHITECTURE.md`; todos os números de migration citados em `docs/adr/README.md`
resolvem em `supabase/migrations/` ou `migrations_archive/`; 2 buckets de Storage;
385 de 386 caminhos `src/...` citados nas docs existem.

---

## 5. Correções aplicadas vs. pendências de decisão

### 5.1 Correções triviais e seguras aplicadas nesta mudança

Apenas documentação viva e exemplo de configuração — nada que altere
comportamento de runtime, schema ou saída de documento ao cliente.

| Item | Arquivo | O que mudou |
|---|---|---|
| DRIFT-01 | `docs/ARCHITECTURE.md` | Bloco de prosa sobre `/revisao` movido para depois da tabela, restaurando as ~15 linhas de rota que renderizavam como texto solto |
| DRIFT-02 | `docs/RASTREABILIDADE.md` | "15 Edge Functions" → **17** |
| DRIFT-06 | `docs/modules/taxas-locais.md` | Removida a referência a `PendenciasFaturamentoTab.tsx` como código vigente na linha 122 (a menção histórica da linha 96 foi preservada) |
| OBS-03 | `.env.example` | Documentadas `VITE_PORTAL_URL` e `VITE_PORTAL_BILLING_URL`, com nota de que caem no padrão quando ausentes |

### 5.2 Pronto para aplicar, aguardando só um "sim"

Correção mecânica, de baixo risco, mas que toca um gate de CI ou a aparência do
produto — por isso não foi aplicada sem decisão.

| Item | Sev. | Por que depende de decisão |
|---|---|---|
| ENV-02 | baixo | Acrescentar os 7 globs faltantes ao `size-limit` (ou derivá-los de `dist/index.html`). Mede ~11,9 kB a mais; com a folga atual o gate continuaria passando (≈204 kB de 250 kB), mas é **medição de CI** e a folga no ambiente de vocês pode diferir |
| A11Y-01 | crítico | A correção é de duas linhas de CSS por tema, mas **a cor exata do anel de foco é decisão de design** e muda a aparência de todo botão e campo do produto |
| A11Y-02, A11Y-03 | alto/médio | Remover o zeramento de foco; mesma dependência de decisão visual |
| DOC-02, DOC-04, DOC-05 | baixo | Tratar `NaN` como ausência, limitar o nome do arquivo e usar `Intl.NumberFormat`. São triviais, mas alteram **documento que vai ao cliente** |
| DRIFT-03, DRIFT-04, DRIFT-05 | baixo/médio | As contagens vivem em blocos datados de PR dentro da `RASTREABILIDADE.md`. Corrigir número dentro de registro datado ou marcá-lo como snapshot é escolha editorial de vocês |
| CQ-01 | baixo | Reformatar `DepotCadastro.tsx` gera diff grande em arquivo que ninguém pediu para tocar |
| UI-01 (parte) | alto | Acrescentar `text-[#d2a8ff]` e `bg-[#111820]` à camada de compatibilidade do CSS resolve os dois defeitos hoje — mas mexe em `index.css`, que governa a aparência inteira |
| UI-02 | médio | Trocar `var(--app-accent, …)` pelos tokens reais (`--app-link` e `--app-gold`) nos dois consumidores |
| A11Y-05 | alto | Dar `id` ao `Combobox` e trocar `<span>` por `<label htmlFor>`: uma correção, cinco telas |
| A11Y-06 | médio | `aria-label` nos três `<select>` sem rótulo e nos campos de busca |
| A11Y-07, UX-02, UX-03 | médio/baixo | Título de página e `h1`/`h2` nas rotas de detalhe, e título próprio para o Cadastro de Terminais |
| A11Y-09 | baixo | `scope="col"` nos `<th>` das três tabelas |
| UX-04 | alto | Mesma correção do UX-01 em `lineup.ts:142` — cobre `/painel`, `/line-up-tv/display` e os dois pontos de `VoyageScheduleModals.tsx` |

### 5.3 Requer decisão humana

| Item | Sev. | Decisão pendente |
|---|---|---|
| TEST-C1 | alto | Rodar as suítes `local-pg` no CI (o `setup-local-pg.sh` já monta o banco) muda o contrato de CI. Enquanto não rodarem, o `WORKFLOW.md` §11 deveria dizer que o gate local não cobre dinheiro nem autorização |
| SEC-01 | médio | Como corrigir a guarda: varrer só `supabase/migrations/`, ou conferir contra `pg_policies` de um banco replayado. A segunda opção é mais forte e usa infraestrutura que já existe |
| ENV-01 | médio | Falhar (ou exigir confirmação) quando o `dev` resolver para o `ref` de produção muda o boot local. A guarda `assertPreviewTarget` da PR #660 é o precedente |
| DB-04 | médio | Criar `UNIQUE(bl_id, container_number)` é decisão de domínio e exige checar duplicatas existentes antes |
| DB-01, DB-02 | médio/baixo | Índices novos: confirmar com `EXPLAIN` sobre volumetria real antes |
| DB-03 | médio | Regenerar `src/types/database.ts` — arquivo protegido por hook |
| DOC-01 | médio | O que imprimir quando o valor é ausente, e onde a ausência é anômala |
| PERF-01 | médio | RPC em lote com `SAVEPOINT` por linha preserva a semântica atual e corta N round-trips — mas muda o contrato da RPC de importação |
| SEC-02, SEC-03 | baixo | Trocar a forma da guarda; revogar RPC morta |
| FLUXO-01 | baixo | Só se quiserem atomicidade de lote; a fronteira por B/L é defensável |
| FLUXO-02 | baixo | Direção arquitetural incremental, a aplicar quando cada tela for tocada |
| ENV-03 | baixo | `engines` é contrato (travar com `.nvmrc`) ou orientação (relaxar para `>=22`) |
| UI-01 (raiz) | alto | Fechar a classe do problema exige uma regra de lint proibindo `(text\|bg\|border)-[#…]` em `src/components` e `src/pages`. Deixa de ser allowlist mantida à mão, mas obriga a migrar ~120 ocorrências |
| UI-03 | baixo | Fixar `--app-radius` igual nos três temas muda a aparência nos dois |
| UI-04 | baixo | Derivar a paleta categórica da timeline de tokens por tema é escolha de design |
| UI-05 | baixo | Usar `prefers-color-scheme` como padrão na primeira visita muda o que o usuário novo vê |
| A11Y-08 | médio | Alvo de toque de 24×24 nas caixas de seleção mexe na densidade da tabela, que é deliberada num produto operacional |

---

## 6. Limites desta revisão

Explicitados para que nenhuma afirmação seja lida como mais forte do que é:

- **Nada aqui prova o banco de produção.** Todo replay foi local. Grants efetivos,
  RLS em execução, estado do Vault e jobs de cron no Supabase gerenciado
  permanecem não verificados. O achado de catálogo da PR #659 foi fechado **no SQL
  versionado**; um grant concedido fora de migration não é desfeito por replay.
- **O teste de integração do Supabase não foi executado** (`SUPABASE_RUN_INTEGRATION`),
  conforme `WORKFLOW.md` §11 e a instrução desta revisão. As suítes `local-pg`,
  que rodam contra PostgreSQL descartável, foram executadas.
- **Nenhuma Edge Function foi invocada**, nenhum job disparado, nenhum email
  enviado, nenhuma chamada real a Resend ou ao BCB.
- **Sem profiler de navegador** e sem volumetria real: afirmações sobre render em
  volume são Suspeita.
- **Nenhum documento foi impresso.**
- **Duas frentes ficaram incompletas** por interrupção de limite de sessão da
  conta (seção 3).

Artefatos de ambiente do sandbox — Google Fonts, PTAX do BCB e scripts do Vercel
Analytics bloqueados pelo proxy de egresso, WebSocket de realtime contra o shim —
foram desconsiderados e **não** entraram como achados.
