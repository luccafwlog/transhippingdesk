# Embarque de Vazios: unidades importadas e serviços lançados à mão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a ADR 0033 — o VAZIOS EXP deixa de calcular custo por container e passa a ser um **Embarque de Vazios** por escala, com uma Lista de Unidades Embarcadas importada de planilha e Linhas de Serviço lançadas à mão. O Cadastro de Depot para de precificar e passa a sugerir.

**Architecture:** Hoje o módulo deriva custo do container: `vazios_bookings` guarda 16 campos operacionais, `depot_services` precifica por `calc_type`, `vazios_operation_service_qty` guarda quantidades por operação e `vaziosCusto.ts` multiplica tudo. A ADR 0033 troca isso por dois conjuntos independentes sob o agregado `(viagem, porto)`: **unidades** (fato, 7 colunas, substituição total no import) e **linhas de serviço** (custo, quantidade e valor digitados, exceto armazenagem). Não há dado de produção — as tabelas são recriadas, não migradas.

**Tech Stack:** React 18 + TypeScript, TanStack React Query, Supabase (Postgres + RLS), Vitest + Testing Library (jsdom), Vite, ESLint.

---

## Leitura obrigatória antes de começar

Leia, nesta ordem (não pule — o plano assume esse vocabulário):

1. [`../../CLAUDE.md`](../../CLAUDE.md) — mudança cirúrgica, contrato de documentação e gates de verificação.
2. [`../adr/0033-embarque-vazios-unidades-importadas-servicos-lancados.md`](../adr/0033-embarque-vazios-unidades-importadas-servicos-lancados.md) — a decisão que este plano executa.
3. [`../../CONTEXT.md`](../../CONTEXT.md) — verbetes *Embarque de Vazios (EXP)*, *Unidade Embarcada*, *Linha de Serviço do Embarque*, *Natureza do Serviço*, *Percentual da Linha*, *Cadastro de Depot*, *Free Time de Storage (Depot)*.
4. [`../adr/0027-agency-departure-report-agregado-escala-snapshot.md`](../adr/0027-agency-departure-report-agregado-escala-snapshot.md) — o ADR é exibição derivada; esta mudança **não** altera isso.
5. [`../RASTREABILIDADE.md`](../RASTREABILIDADE.md) — linhas de `/embarquevazios` e `/embarquevazios/depots`.

Glossário mínimo:

- **ADR** — neste plano, sem qualificação, é o *Agency Departure Report*. O outro ADR (*Architecture Decision Record*) aparece sempre com número, ex.: "ADR 0033". Em código e schema, sempre `agency_departure_report`.
- **Embarque de Vazios** — agregado único por `(viagem, porto)`. A tabela `vazios_export_operations` continua sendo essa âncora, sem a OS.
- **Unidade Embarcada** — linha da lista importada: container, tipo, depot, condição, entrada, saída, embarque.
- **Linha de Serviço** — lançamento manual: serviço, local, rota, tipo, quantidade, percentual, valor unitário.
- **Natureza** — `armazenagem` | `transporte` | `geral`; atributo do serviço no cadastro, decide os campos exigidos da linha.

## Setup

```bash
npm ci
git checkout main && git pull --ff-only
git checkout -b feat/embarque-vazios-modelo-manual
```

Comandos de verificação:

```bash
npx vitest run <caminho-do-teste>
npm run lint
npm run typecheck
npm test
npm run build
npm run docs:check
```

**Guarda de arquivos:** `src/types/database.ts` e as migrations existentes são protegidos por `.claude/hooks/protect-files.sh`. Regenerar os tipos após as migrations novas exige autorização explícita do usuário — pare e peça. **Nunca edite migrations já criadas** (`229`–`237`): toda correção é migration nova (ADR 0016).

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `supabase/migrations/238_embarque_vazios_unidades.sql` | Lista de Unidades (7 colunas) + substituição total | Criar |
| `supabase/migrations/239_embarque_vazios_linhas_servico.sql` | Linhas de Serviço + naturezas + free times | Criar |
| `supabase/migrations/240_depot_catalogo_sugerido.sql` | `depot_services` como catálogo sugerido | Criar |
| `src/services/__tests__/embarqueVaziosSchemaMigration.test.ts` | Contrato SQL das migrations | Criar |
| `src/services/vaziosImport.ts` | Parser + import da planilha | Modificar (7 colunas, replace) |
| `src/services/vaziosCusto.ts` | Motor de custo | Reescrever (soma de linhas) |
| `src/services/vaziosExportOperations.ts` | Serviços do Embarque | Modificar (linhas, armazenagem) |
| `src/services/depots.ts` | Cadastro de Depot | Modificar (catálogo, dois free times) |
| `src/services/agencyDepartureReport.ts` | Deriva os dados do ADR | Modificar (fontes novas) |
| `src/pages/EmbarqueVazios.tsx` | Tela do módulo | Reescrever (abas Unidades / Serviços) |
| `src/pages/DepotCadastro.tsx` | Tabela de Depots | Modificar (encolher) |
| `src/components/voyages/VoyageAgencyReportTab.tsx` | Aba do ADR | Modificar (2 seções) |
| `src/components/voyages/AgencyReportDocument.tsx` | Impresso do ADR | Modificar (anexo de unidades) |
| `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`, `docs/CHANGELOG.md`, `docs/plans/README.md` | Documentação viva | Modificar |

**Fonte de referência:** o modelo foi validado num protótipo descartável, já removido. As funções que ele exercitou — `diasCobraveis`, `armazenagem`, `valorSugerido`, `quantidadeEfetiva`, `totalLinha` e `veto` — estão descritas nas Tasks 2 e 4 e na ADR 0033; implemente-as a partir dessas descrições.

---

## Task 1: Schema das unidades e das linhas de serviço

**Migration `238`** — reformula a lista de unidades sobre `vazios_bookings`:

- [ ] Derrubar as colunas sem consumidor: `booking_number`, `destination`, `origin_terminal`, `notes`, `overtime_pct`, `material`, `os_number` (esta em `vazios_export_operations`).
- [ ] Garantir as sete colunas: `container_number`, `container_type`, `depot_id`, `condition`, `hand_in_date`, `hand_out_date`, `movement_date` (data de embarque).
- [ ] `condition` passa a aceitar apenas `vazio` | `material` (CHECK), sem `damage`.
- [ ] Manter a unicidade `(voyage_id, container_number)` da migration `231`.
- [ ] Preservar RLS e grants existentes; sem mudança de RBAC (Administrativo + Equipamentos).

**Migration `239`** — cria as linhas de serviço:

- [ ] Tabela de linhas com FK para o Embarque (`vazios_export_operations`), `service_id`, `local_id`, `destino_id` (nulo fora de transporte), `container_type`, `condition`, `quantidade`, `percentual`, `valor_unitario`, `valor_sugerido`, `quantidade_manual`.
- [ ] CHECK: `percentual IN (50, 100)`; nulo quando a natureza é `armazenagem`.
- [ ] Índice único parcial garantindo **uma linha de armazenagem por (embarque, depot, condição)**.
- [ ] `depots` ganha `free_time_vazio_days` e `free_time_material_days`; `free_time_days` é derrubado.
- [ ] Dropar `vazios_operation_service_qty` e a coluna `os_number`.
- [ ] RLS espelhando `can_edit_depots` / escopo de Equipamentos, como nas tabelas irmãs.

**Verificação:** `npx vitest run src/services/__tests__/embarqueVaziosSchemaMigration.test.ts` — o teste lê o SQL e afirma o contrato (colunas, CHECKs, índice único, grants), no padrão dos testes `*Migration.test.ts` já existentes.

## Task 2: Catálogo de valores sugeridos

**Migration `240`:**

- [ ] `depot_services` perde `calc_type`, `subject_to_overtime`, `valid_from`, `valid_to`.
- [ ] Ganha `natureza` (`armazenagem` | `transporte` | `geral`, CHECK) e os discriminantes opcionais `container_type`, `route_destino_id`, `condition`.
- [ ] Seed dos dez serviços iniciais por depot: armazenagem, transporte, handling in, handling out, overtime handling, overtime transporte, bundle composition, bundle organization, visual check, remoção.
- [ ] `src/services/depots.ts`: `listCurrentDepotServices` perde o filtro de vigência; nasce `valorSugerido({ local, servico, tipo, rota, condicao })` casando do mais específico para o mais genérico.

**Verificação:** teste do casamento de sugestão — específico ganha do genérico, e ausência devolve `null` (o usuário digita).

## Task 3: Import de sete colunas com substituição total

- [ ] `vaziosImport.ts`: `HEADER_MAP` reduzido às sete colunas; remover o parse de booking, destino, terminal, observações, overtime % e OS.
- [ ] `parseCondition` passa a devolver `vazio` | `material` apenas.
- [ ] Reescrever `import_vazios_bookings_transactional` como **substituição total** da lista da escala (delete + insert na mesma transação), no lugar do upsert por container da ADR 0031.
- [ ] Depot desconhecido na planilha: criar automaticamente com free times zerados e sinalizar na tela para completar — não travar o import.
- [ ] Manter a dedupe por container dentro do arquivo (última ocorrência vence).

**Verificação:** `npx vitest run src/services/__tests__/vaziosImport*.test.ts`. Os testes de upsert (`vaziosImportUpsert.test.ts`) mudam de expectativa — a substituição total é a nova regra, e o teste deve afirmar que unidades ausentes do arquivo somem.

## Task 4: Motor de custo por linhas

- [ ] `vaziosCusto.ts` deixa de precificar container. Passa a expor: `diasCobraveis(unidade, depot)` (desconta o free time da condição), `armazenagemPorDepotCondicao(unidades)`, `quantidadeEfetiva(linha, unidades)`, `totalLinha(linha)` e `totalEmbarque(embarque)`.
- [ ] `total = quantidade × valor unitário × percentual/100`; armazenagem ignora percentual.
- [ ] `computeStorageTotals` em `vaziosExportOperations.ts` passa a descontar o free time por condição (hoje só faz `saída − entrada`).
- [ ] Vetos como funções puras: transporte sem rota, armazenagem fora de depot, segunda armazenagem do mesmo (depot, condição), percentual fora de {50, 100}.

**Verificação:** `npx vitest run src/services/__tests__/vaziosCusto.test.ts` reescrito — cobre um embarque com dois depots, as duas condições, embarque direto sem armazenagem e as quatro recusas.

## Task 5: Tela do módulo

- [ ] `/embarquevazios` lista os Embarques e cria um novo escolhendo viagem (Combobox preditivo, ADR 0018) + porto de embarque. Recusa criar um segundo Embarque na mesma escala.
- [ ] Dentro do Embarque, duas abas: **Unidades Embarcadas** (import, edição manual, resumo por tipo, dias cobráveis por linha) e **Serviços** (linhas, com valor sugerido pré-preenchido e sobrescrevível, e totais).
- [ ] Sobrescrever a quantidade da armazenagem mantém o calculado visível ao lado.
- [ ] Valor divergente do sugerido oferece gravar no catálogo por **ação explícita**, nunca em silêncio.
- [ ] `DepotCadastro.tsx` encolhe: depots + dois free times + catálogo (nome, natureza, discriminantes, valor). Sem tipo de cálculo, sem vigência, sem `subject_to_overtime`.

**Verificação:** testes de comportamento das duas telas; `npm run lint` e `npm run typecheck`.

## Task 6: ADR (o relatório)

- [ ] `agencyDepartureReport.ts` passa a derivar **Vazios embarcados** da Lista de Unidades (contagem + matriz por tipo) e **Operação de Pátio** das linhas de serviço + armazenagem por (depot, condição), em BRL.
- [ ] `VoyageAgencyReportTab.tsx`: Operação de Pátio exibe as **linhas detalhadas** (serviço, local, rota, tipo, quantidade, percentual, valor unitário, total) e o total geral — não apenas somatórios.
- [ ] `AgencyReportDocument.tsx`: capa com os totais e **anexo** com as unidades que geraram armazenagem.
- [ ] Sign-off, resolução e fechamento permanecem como estão (ADRs 0027/0029/0030) — só muda o conteúdo exibido.
- [ ] Conferir que o snapshot de fechamento continua válido com a forma nova.

**Verificação:** `npx vitest run src/services/__tests__/agencyDepartureReport.test.ts src/components/voyages/__tests__/`.

## Task 7: Documentação viva e fechamento

- [ ] `docs/ARCHITECTURE.md` — rotas e camadas do módulo de vazios.
- [ ] `docs/RASTREABILIDADE.md` — linhas de `/embarquevazios` e `/embarquevazios/depots` reapontadas para os serviços, hooks e testes novos.
- [ ] `docs/CHANGELOG.md` — a entrega.
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de `docs/plans/README.md`, no **mesmo change** que conclui a execução.
- [ ] `npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.

---

## Riscos conhecidos

- **Substituição total apaga ajuste manual.** Reimportar descarta unidades criadas à mão e muda a quantidade das linhas de armazenagem, que derivam da lista. É custo aceito na ADR 0033; a tela deve avisar antes de reimportar.
- **`src/types/database.ts` é protegido.** Depois das migrations `238`–`240` os tipos precisam ser regerados — pare e peça autorização em vez de contornar o hook.
- **Ordem entre Tasks 1–2 e 4–6.** O motor e as telas dependem do schema; não comece a Task 4 antes das migrations estarem aplicadas e os tipos regerados.
