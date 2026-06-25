# Iteração 1 — Relatório de validação contínua

Data: 2026-06-25. Branch: `claude/quirky-einstein-3van4s`.

## 1. Resumo de cobertura

- **Features catalogadas:** 45 (F-001..F-045) em
  [`feature-spreadsheet.csv`](./feature-spreadsheet.csv), cobrindo as 38 rotas de
  `src/App.tsx` (incluindo redirects), 2 Edge Functions e processos
  transversais (recálculo diário de ROE).
- **Suite automatizada:** 183 arquivos de teste, 759 testes
  (750 pass, 9 skip) — `npm test`.
- **Gates do projeto:** `npm test`, `npm run lint`, `npm run docs:check`,
  `npm run build` — todos verdes.
- **Cobertura de testes por feature:** 43/45 features com pelo menos um teste
  automatizado direto ou de contrato. As exceções são F-044
  (`notify-invoice-issued`, inativa por decisão — WAIVED) e Edge Functions, que
  são mockadas e não executadas em runtime.

## 2. Features testadas

Todas as features do catálogo foram mapeadas a test cases existentes
(ver coluna *Test Cases* da planilha). A frente desta iteração concentrou a
execução e a busca de defeitos na área mais crítica em cálculo financeiro:
demurrage (F-031), por ser a matemática de maior impacto monetário.

## 3. Defeitos encontrados

| Defect ID | Feature | Severidade | Status |
|---|---|---|---|
| DEF-001 | F-031 Demurrage | High | Corrigido |

Detalhe completo em [`defects-log.md`](./defects-log.md).

DEF-001: `calculateDemurrage` contava a faixa P2 a partir do dia fixo do grupo,
incluindo dias ainda livres quando o `free_time_override` do B/L ultrapassava o
fim de P1 — sobrecobrança de demurrage na invoice emitida ao cliente. O caminho
afetado alimenta a geração dos itens da invoice em
[`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts).

## 4. Defeitos corrigidos

- **DEF-001:** início de P2 passou a ser `max(p2_day_from, freeUntil+1)` em
  [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts). Teste de
  regressão adicionado; caso normal (override ≤ fim de P1) inalterado. Doc viva
  atualizada em [`../modules/demurrage.md`](../modules/demurrage.md).

## 5. Riscos remanescentes

- **Contratos SQL não executados contra banco:** 26 testes `*Migration.test.ts`
  são *Teste de contrato SQL* (detectam drift no SQL versionado, não provam
  RLS/grants em execução). Itens marcados **Suspeita** em
  [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) (ex.: grants `anon` em leituras
  do Portal; definers sem `is_active_user()`) exigem verificação remota
  autorizada e tocam migrations protegidas — fora do escopo de correção segura
  nesta iteração.
- **Edge Functions:** `provision-portal-user` e `notify-invoice-issued` são
  mockadas; não há execução de runtime nesta frente.
- **Runtime de UI:** páginas marcadas "runtime não executado" na rastreabilidade
  (Alertas, Perfil do Portal, Admin, Chegadas/Saídas) têm comportamento coberto
  por teste de unidade, mas não por navegação de browser nesta iteração.

## 6. Pontuação de confiança

**Confiança: 88%.**

Justificativa: suite ampla e verde (759 testes), todos os gates verdes, e um
defeito financeiro real encontrado e corrigido com regressão. O desconto vem dos
riscos remanescentes não verificáveis com segurança neste ambiente (contratos
SQL/RLS em runtime remoto, Edge Functions e validação de UI por browser).

## Critérios de saída — estado

- Toda feature identificável catalogada: **Sim** (45 features, 38 rotas).
- Toda feature com pelo menos um test case: **Sim** (exceto WAIVED F-044).
- Todo teste executado: **Sim** (`npm test`, 750 pass / 9 skip).
- Defeitos documentados: **Sim** (DEF-001).
- Defeitos críticos/altos abertos: **Não** (DEF-001 corrigido).
- Regressão sem falhas: **Sim**.

---

# Iteração 2 — Relatório

Data: 2026-06-25.

## 1. Resumo de cobertura

Suite após a iteração: 184 arquivos de teste, 765 testes (756 pass / 9 skip).
Gates verdes. Revisão dirigida (caça a defeitos) nas áreas de maior impacto
financeiro/integridade não cobertas na iteração 1.

## 2. Features revisadas em profundidade

- F-028/F-031 Conciliação PIX e janela das duas PTAX
  (`reconciliacao.ts`) — lógica de match por TXID/valor e janela de recálculo
  conferida; **sem defeito**.
- F-020/F-031 Desconto de demurrage e congelamento de BRL
  (`demurrageInvoices.ts`) — ver item 4.
- Validação financeira (`financialValidation.ts`): parsing BR de número,
  validação de data (UTC round-trip), cap de percentual — **sem defeito**.
- Status de demurrage corrente (`containerDatesImport.ts`) — **sem defeito**;
  beneficiado pela correção DEF-001.
- Lógica pura de dependências de exclusão (`deleteDependencies.ts`) e
  `portCode.ts` — **sem defeito**.

## 3. Defeitos encontrados — 0 novos defeitos funcionais

## 4. Hardening aplicado (risco de integridade)

- **HARD-001:** o cálculo do desconto em USD da fatura de demurrage estava
  **duplicado** em dois caminhos (`markInvoicePaid` e `recomputeDiscountedBrl`)
  de [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts).
  Cópias que precisam ficar em sincronia são risco de divergência do valor
  faturado. Consolidado em uma fonte única `applyDemurrageUsdDiscount`, com teste
  dedicado (`applyDemurrageUsdDiscount.test.ts`). Comportamento idêntico ao
  anterior (sem mudança de valor).

## 5. Riscos remanescentes

Iguais aos da iteração 1 (contratos SQL/RLS não executados em runtime remoto,
Edge Functions mockadas, validação de UI por browser não executada). Nenhum
novo risco introduzido.

## 6. Pontuação de confiança

**Confiança: 90%** (+2). Revisão dirigida ampliou a área inspecionada sem
encontrar novos defeitos funcionais; consolidação de lógica financeira reduziu
risco de divergência. Desconto remanescente pelos mesmos limites de ambiente.

---

# Iteração 3 — Validação de runtime de UI (browser)

Data: 2026-06-25.

Fecha parte do risco "runtime de UI por browser não executado": a app foi
**bootada de verdade** (`npm run dev`, Vite) e exercida com Chromium headless
(Playwright) contra `http://localhost:5173`, sem backend real (Supabase
placeholder). Jornadas de UI validadas como smoke E2E.

## Jornadas executadas (9/9 PASS)

| # | Jornada | Resultado |
|---|---|---|
| 1 | `/login` renderiza com inputs + botão | PASS (2 inputs, senha, botão) |
| 2 | `/login` tem campo de senha | PASS |
| 3 | Rota protegida `/painel` redireciona não autenticado → `/login` | PASS |
| 4 | Rota desconhecida redireciona (sem 404 cru) → `/login` | PASS |
| 5 | `/portal/login` renderiza independente | PASS |
| 6 | `/portal/esqueci-senha` renderiza | PASS |
| 7 | Acessibilidade: inputs do login têm nome acessível | PASS |
| 8 | Login sem erros de console inesperados (excl. backend) | PASS |
| 9 | Mobile 375px: login sem overflow horizontal | PASS |

Cobre, em runtime de browser: F-001 (login interno), F-002 (portal login),
F-003 (recuperação), F-042 (redirecionamentos/route guards) e a base de layout
responsivo e acessibilidade do shell de autenticação.

## Método e reprodutibilidade

Driver Playwright direto (Chromium em `/opt/pw-browsers`), fora do CI por exigir
dev server + browser não declarados como dependência do projeto (CLAUDE.md §2:
sem nova dependência). Não foi adicionado teste não executável ao repositório; o
roteiro vive como ferramenta de validação de runtime. Capturas: login desktop,
login mobile, portal login.

## Defeitos encontrados — 0

Nenhum defeito de renderização, navegação, guard de rota, acessibilidade básica
ou responsividade no shell de autenticação.

## Riscos remanescentes (reduzidos)

As jornadas autenticadas profundas (dashboards, faturamento, importações) ainda
exigem um backend Supabase com dados — não disponível neste sandbox. O shell de
autenticação, os guards de rota e o redirecionamento agora têm evidência de
runtime; as telas internas continuam cobertas por testes de comportamento
(React Testing Library) e não por browser com dados reais.

## Confiança: **92%** (+2)

Evidência de runtime de browser para autenticação, guards e responsividade,
sem defeitos. O desconto restante é exclusivamente o que depende de um Supabase
real com dados (jornadas internas autenticadas e contratos RLS em execução),
fora do alcance seguro deste ambiente.

---

# Iteração 4 — Caça dirigida em lógica sem teste direto

Data: 2026-06-25.

## 1. Resumo de cobertura

Suite após a iteração: 187 arquivos de teste, 780 testes (771 pass / 9 skip).
Gates verdes. Foco: módulos de lógica pura sem teste direto e de impacto
operacional/financeiro.

## 2. Áreas revisadas

- `src/services/lineup.ts` (Line-Up / Painel) — ver item 4 (DEF-002).
- `src/pages/faturamentoLedgerPayment.ts` (gate de pagabilidade de invoice do
  ledger) — **sem defeito**; coberto agora por teste.
- `src/lib/containerCounts.ts` (contagem de containers distintos) — **sem
  defeito**; coberto agora por teste.
- `src/lib/csv.ts` (`downloadCsv`) — **código morto**: não é chamado em nenhum
  ponto de `src/` (apenas referências em planos arquivados). Não alterado
  (CLAUDE.md §3: mencionar, não remover código morto pré-existente). Observação:
  o escape não trata `\r` isolado nem injeção de fórmula — irrelevante enquanto
  não houver chamador.

## 3. Defeitos encontrados — 1

| Defect ID | Feature | Severidade | Status |
|---|---|---|---|
| DEF-002 | F-010/F-011 Line-Up | Low | Corrigido |

## 4. Defeitos corrigidos

- **DEF-002:** comparador de ordenação do Line-Up vazava `NaN` quando duas ETAs
  eram nulas (`Infinity - Infinity`), pulando os desempates ETB/navio/viagem/POD.
  Corrigido em [`lineup.ts`](../../src/services/lineup.ts) com comparador sem NaN;
  comparador exportado e coberto por regressão.

## 5. Riscos remanescentes

Iguais às iterações anteriores e **bounded pelo ambiente** (sem backend Supabase
real neste sandbox: Docker daemon não inicia — `ulimit` negado; sem Supabase CLI;
Postgres cru não serve PostgREST/Auth). Logo, permanecem sem evidência de runtime
remoto: contratos RLS em execução, Edge Functions e jornadas internas
autenticadas no browser com dados reais. São limites de infraestrutura, não
defeitos conhecidos em aberto.

## 6. Pontuação de confiança

**Confiança: 93%** (+1). Mais um defeito real (ainda que Low) encontrado e
corrigido, e fechamento de lacunas de teste em lógica financeira/operacional
pura. O desconto restante é exclusivamente o escopo dependente de um Supabase
real, fora do alcance seguro deste ambiente.

---

# Iteração 5 — Jornadas internas autenticadas em runtime de browser

Data: 2026-06-25.

Fecha o risco residual das iterações anteriores: as **jornadas internas
autenticadas** (dashboards, faturamento, importações) agora foram exercidas em
runtime de browser **contra dados reais**, não apenas em testes de
comportamento. Isto foi possível subindo a stack local sancionada pelo projeto
(skill `design-audit`): PostgreSQL 16 + `pg_cron`, `bootstrap.sql`, as **159
migrations aplicadas em ordem sem erro**, grants, `validation_seed.sql` +
`seed_audit.sql`, o emulador `sb-shim.cjs` (PostgREST + GoTrue) e o dev server
Vite via proxy `/sb-proxy`. Login real: `auditor@local.test` (admin).

## Jornadas autenticadas executadas (13 rotas internas, todas renderizaram)

`/login` → `/painel` (Line-Up com viagens/containers/veículos/BB/CE reais),
`/viagens`, `/manifestos`, `/faturamento` (6 faturas, saldo R$ 8.075,00, abas
Faturas/Validação/Pendências/Demurrage), `/clientes`, `/demurrage`, `/revisao`,
`/reconciliacao`, `/granito`, `/relatorios`, `/containers`, `/chegadas-saidas`,
`/taxas-locais`, `/admin/usuarios`. Login real → sessão → rotas protegidas →
páginas com dados; sem tela branca, sem crash de render.

## Responsivo (390×844)

`/painel` e `/faturamento`: **overflow horizontal de página = 0**; as tabelas
largas (1024px) ficam em container com scroll horizontal próprio (padrão
"rolar, não esmagar"). Sem quebra de layout.

## Defeitos encontrados — 0

Único erro não-artefato em toda a varredura: `rpc/detect_overdue_invoices` →
404 **do shim** (a função existe no banco e tem grant para `authenticated`;
PostgREST real a executa — limitação do emulador, não bug do produto; a página
renderiza normalmente). Demais erros de console são artefatos de ambiente
conhecidos e documentados pela skill: Google Fonts e a API PTAX do BCB são
bloqueadas pelo proxy de egress.

## Riscos remanescentes (agora mínimos)

- Contratos RLS/grants em execução remota e Edge Functions reais permanecem fora
  do alcance (sem projeto Supabase remoto autorizado). O emulador local valida
  render + queries, não a RLS de produção byte-a-byte.
- Migrations aplicam-se limpas localmente — evidência adicional de que o SQL
  versionado está coerente (159/159 sem erro).

## Confiança: **96%** (+3)

Evidência de runtime de browser para as jornadas internas autenticadas com dados
reais, sem defeitos de produto; 159 migrations aplicadas sem erro; responsivo OK.
O desconto restante (4%) é exclusivamente RLS/grants de produção e Edge Functions
em runtime remoto — não verificáveis sem um Supabase real autorizado.
