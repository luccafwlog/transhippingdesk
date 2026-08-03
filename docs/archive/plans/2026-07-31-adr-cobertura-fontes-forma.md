# ADR: cobertura do transbordo, fontes da descarga e relatório sem zeros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar os blocos 2, 3 e 4 da ADR 0035 — o ADR passa a enxergar a carga descarregada por omissão, a contar cheios pelo B/L e a listar apenas o que foi operado, na tela e no impresso.

**Architecture:** Nada aqui muda o que é uma escala — as sete seções, os donos departamentais, o gate de 3/3 e a âncora `(voyage_id, port)` permanecem. Muda **o que chega até a seção** (transbordo, fonte da contagem, porto que casa) e **como o conteúdo é exibido** (lista do operado no lugar da matriz com zeros). Por isso este plano é independente do `2026-07-31-escala-unificada-pol-pod.md` e pode ser entregue **antes** dele; a única superfície de contato está isolada na Task 7.

**Tech Stack:** React 18 + TypeScript, TanStack React Query, Supabase (Postgres + RLS), Vitest + Testing Library (jsdom), Vite, ESLint.

---

## Leitura obrigatória antes de começar

Leia, nesta ordem:

1. [`../../CLAUDE.md`](../../CLAUDE.md) — mudança cirúrgica, contrato de documentação e gates de verificação.
2. [`../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md`](../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md) — a decisão que este plano executa (blocos 2, 3 e 4).
3. [`../adr/0027-agency-departure-report-agregado-escala-snapshot.md`](../adr/0027-agency-departure-report-agregado-escala-snapshot.md) — exibição derivada, resolução explícita e snapshot; **não** mude nada disso.
4. [`../adr/0022-omissao-escala-transbordo-cod-registro-operacional.md`](../adr/0022-omissao-escala-transbordo-cod-registro-operacional.md) — omissão, transbordo e COD.
5. [`../adr/0025-bl-fonte-documental-unica-container-atd-pol.md`](../adr/0025-bl-fonte-documental-unica-container-atd-pol.md) — o B/L como fonte documental da carga de container.
6. [`../../CONTEXT.md`](../../CONTEXT.md) — verbetes *ADR*, *Seção do ADR*, *Resolução de Seção*, *Transbordo*, *COD*, *Baplie EDI*, *Natureza do Vazio Descarregado*, *Unidade Embarcada*.
7. [`../archive/audits/2026-07-31-revisao-fluxo-adr-cobertura-hipoteses.md`](../archive/audits/2026-07-31-revisao-fluxo-adr-cobertura-hipoteses.md) — o diagnóstico, com linha e arquivo de cada achado.

Glossário mínimo:

- **ADR** — neste plano, sem qualificação, é o *Agency Departure Report*. O outro (*Architecture Decision Record*) aparece sempre com número, ex.: "ADR 0035". Em código e schema, sempre `agency_departure_report`.
- **Escala** — `(viagem, porto)`, a chave natural de `agency_departure_reports`.
- **Porto de Transbordo** — `voyage_omissions.discharge_pod`: onde a carga do POD omitido foi efetivamente descarregada.
- **Listagem do operado** — a forma nova: uma linha por combinação com quantidade, nenhuma linha para o que não ocorreu.

## Setup

```bash
npm ci
git checkout main && git pull --ff-only
git checkout -b feat/adr-cobertura-fontes-forma
```

Comandos de verificação:

```bash
npx vitest run <caminho-do-teste>
npm run lint
npm test
npm run build
npm run docs:check
```

**Guarda de arquivos:** `src/types/database.ts` e as migrations existentes são protegidos por `.claude/hooks/protect-files.sh`. **Nunca edite migration já criada** — correção é migration nova (ADR 0016). A migration deste plano é a `249`; se o plano da escala unificada for executado antes, use o próximo número livre.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/services/agencyDepartureReport.ts` | Deriva os dados do ADR | Modificar (transbordo, fontes, listagem) |
| `src/services/__tests__/agencyDepartureReport.test.ts` | Regras puras da derivação | Modificar |
| `src/components/voyages/VoyageAgencyReportTab.tsx` | Aba do ADR | Modificar (listagem, blocos, avisos) |
| `src/components/voyages/AgencyReportDocument.tsx` | ADR impresso | Modificar (listagem, resoluções, sign-offs) |
| `src/components/voyages/VoyageCard.tsx` | Monta a lista de escalas da aba | Modificar (escala omitida com ADR fechado) |
| `src/hooks/useAgencyReport.ts` | Queries do ADR | Modificar (portos com ADR fechado) |
| `src/services/graniteImport.ts` | Import do granito | Modificar (normaliza porto) |
| `src/pages/EmbarqueVazios.tsx` | Embarque de Vazios | Modificar (porto vira seleção) |
| `supabase/migrations/249_agency_report_snapshot_validation.sql` | Revalidação do snapshot no fechamento | Criar |
| `src/services/__tests__/agencyReportSnapshotValidationMigration.test.ts` | Contrato SQL da migration | Criar |
| `docs/RASTREABILIDADE.md`, `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md`, `CONTEXT.md`, `docs/plans/README.md` | Documentação viva | Modificar |

---

## Task 1: O ADR do porto de descarga enxerga a carga em transbordo

`getAgencyReportDerivedData` filtra carga por `bls.pod = porto`. A carga descarregada por omissão mantém `pod` no POD omitido e some.

- [ ] Em `agencyDepartureReport.ts`, buscar as omissões da viagem cujo `discharge_pod` seja o porto da escala, com os B/Ls de `bl_transshipments` que estejam com `disposition = 'transshipment'`. Guardar o conjunto de `bl_id` como `transshipmentBlIds`.
- [ ] Incluir esses B/Ls nas **três** consultas de carga, sem tocar em `bls.pod`:
  - containers: `bl_containers` dos B/Ls do porto **mais** os de `transshipmentBlIds`;
  - carga solta: `bls` com `cargo_mode = 'carga_solta'` do porto **mais** os de `transshipmentBlIds`;
  - veículos: `vehicles` dos B/Ls do porto **mais** os de `transshipmentBlIds`.
- [ ] Manter a prioridade de categoria já existente (`transbordo` → `veiculos` → `imo` → `carga_geral`), agora alcançável: container de B/L em transbordo é `transbordo`.
- [ ] Carga solta e veículos passam a expor a contagem em transbordo **separada** da de destino final. Contagem zero não vira linha (ver Task 4).
- [ ] Quando `transshipmentBlIds` estiver vazio, nenhuma consulta extra é disparada e nada muda no resultado.

**Verificação:** teste em `agencyDepartureReport.test.ts` com uma escala que descarrega 3 containers próprios e 2 de um POD omitido: os 5 aparecem, os 2 como `transbordo`; e um caso sem omissão, provando que o resultado não mudou.

## Task 2: Escala omitida com ADR fechado continua acessível

`VoyageCard.tsx:193` remove toda escala omitida da lista, inclusive a que tem ADR fechado — o relatório vira inalcançável.

- [ ] Criar em `agencyDepartureReport.ts` uma leitura dos portos com ADR **fechado** da viagem (`agency_departure_reports` com `status = 'closed'`), exposta por um hook em `useAgencyReport.ts`.
- [ ] Em `VoyageCard.tsx`, a lista de escalas do ADR passa a ser: escalas não omitidas **mais** as omitidas que tenham ADR fechado.
- [ ] Marcar a escala omitida no seletor da aba (chip com indicação de omitida) e manter o deep link `?tab=adr&escala=` funcionando para ela.
- [ ] Escala omitida **sem** ADR fechado continua fora — o navio não atracou.

**Verificação:** teste em `VoyageAgencyReportTab.test.tsx` cobrindo o chip marcado como omitido e a renderização do snapshot fechado; teste em `voyageCardHelpers` (ou no helper extraído) para a regra da lista.

## Task 3: B/L conta os cheios; Baplie conta os vazios e mantém os flags

Hoje o Baplie complementa a matriz com qualquer container ausente dos B/Ls, incluindo vazios — inflando a descarga e duplicando a seção de vazios.

- [ ] Containers **cheios** da escala passam a sair exclusivamente dos B/Ls (do porto e de transbordo, Task 1).
- [ ] Container do Baplie com `status = 'full'` e sem B/L correspondente **sai do total** e passa a alimentar um aviso de divergência: quantidade e link para a Conciliação Baplie × B/L da viagem.
- [ ] Container do Baplie com `status = 'empty'` e `pod = porto` conta como natureza **`vazio`** na listagem de carga descarregada. A regra do "sem B/L" não se aplica a ele.
- [ ] O flag IMO continua vindo do Baplie quando houver correspondência, com fallback para o B/L — comportamento atual preservado.
- [ ] A seção **Vazios descarregados** continua detalhando `cama`/`cover plate` a partir de `vazios_importacao_containers`; quando a contagem divergir da do Baplie, exibir os dois números e um aviso de quantas unidades estão sem classificação no módulo.

**Verificação:** teste com Baplie contendo 1 cheio sem B/L, 2 vazios e 3 cheios com B/L: o total é 3 cheios + 2 vazios, o cheio órfão aparece só no aviso, e a divergência com o módulo de vazios é reportada.

## Task 4: A listagem do operado substitui a matriz com zeros

- [ ] `buildContainerTypeMatrix` deixa de ser lida como grade: a saída passa a ser consumida como **lista de combinações existentes** (tipo × natureza, com quantidade) mais o total da escala.
- [ ] Na aba, cada seção de carga exibe o total no topo e as linhas do que ocorreu. Sem nenhuma ocorrência, uma única linha "nada operado nesta escala" — a seção continua exigindo resolução.
- [ ] Blocos de métricas sem dado **não são renderizados**: carga solta sem B/L, storage sem dias, embarque direto zerado e veículos sem VIN somem em vez de mostrar zero ou `—`.
- [ ] Vazios embarcados passam a listar por **(tipo, condição, local de origem)** — `40HC · totalmente vazio · VBR: 12` —, uma linha por combinação existente, no lugar da natureza única `carga_geral`.
- [ ] Vazio na listagem de descarga aparece como natureza `vazio`, sem `cama`/`cover plate`: quem classifica é a seção própria.

**Verificação:** teste na aba garantindo que uma escala sem carga solta não renderiza o bloco, que a combinação inexistente não vira linha e que uma seção vazia continua Pendente com o controle de resolução visível.

## Task 5: O impresso segue o mesmo princípio e passa a provar a conferência

- [ ] `AgencyReportDocument` troca as tabelas-grade (`MatrixTable`, com coluna `Total` e rodapé) pela mesma listagem do operado usada na aba.
- [ ] Bloco sem dado não é impresso; **seção** sem dado é impressa com a sua resolução ("Nada a declarar", autor e data).
- [ ] Cada seção impressa exibe estado, autor e data da resolução; o documento fecha com os três sign-offs departamentais (departamento, assinante e data).
- [ ] Para isso, o snapshot gravado no fechamento passa a incluir `departmentSignoffs` além de `signoffs` — a Task 9 libera essa chave na validação do fechamento.
- [ ] Snapshot antigo, sem a chave, continua imprimindo sem quebrar: ausência de `departmentSignoffs` omite o bloco de assinaturas.

**Verificação:** teste em `AgencyReportDocument.test.tsx` com snapshot novo (seções resolvidas, três assinaturas, um bloco sem dado ausente) e com snapshot legado (imprime sem assinaturas, sem lançar).

## Task 6: Granito casa por porto normalizado, com fallback do manifesto

- [ ] Em `graniteImport.ts`, aplicar `normalizePortCode` a `loading_port` (e `discharge_port`) ao montar as linhas importadas — corrige o que entra daqui para frente.
- [ ] Na derivação do ADR, comparar `loading_port` **normalizado** contra o porto da escala, alcançando o que já está gravado por extenso.
- [ ] Quando o B/L de granito não tiver `loading_port`, usar o `loading_port` do `granite_manifests` da viagem como fallback.
- [ ] Nenhuma migração de dado histórico: `granite_bls` existentes permanecem como estão.

**Verificação:** teste puro cobrindo `VITORIA`, `BRVIX`, `Vitoria, Brazil` e B/L sem porto com manifesto preenchido — os quatro casam com a escala `BRVIX`.

## Task 7: O porto do Embarque de Vazios vira seleção entre as escalas

Único ponto de contato com o plano da escala unificada.

- [ ] Em `EmbarqueVazios.tsx`, escolhida a viagem, o campo "Porto de embarque" deixa de ser texto livre e passa a listar as escalas brasileiras dela.
- [ ] Enquanto o plano `2026-07-31-escala-unificada-pol-pod.md` não estiver entregue, montar a lista com um helper local que une portos de POD e de POL da viagem. Deixar um comentário `ponytail:` nomeando o teto (duas fontes unidas à mão) e o caminho de upgrade (trocar pela projeção unificada).
- [ ] Gravar o porto já normalizado por `normalizePortCode`.
- [ ] Embarques existentes com porto divergente continuam funcionando; a correção deles é manual e fica fora deste plano.

**Verificação:** teste do fluxo de criação garantindo que o porto gravado é o código da escala selecionada.

## Task 8: Um cálculo só para a linha de serviço

- [ ] A aba e o impresso passam a calcular o total da linha por `totalLinha` (`vaziosCusto.ts`), a mesma função que compõe o total da operação — acaba a divergência em linhas legadas de armazenagem com `percentual` não nulo.
- [ ] Remover o campo morto `costs.rows` da derivação.

**Verificação:** teste com uma linha legada de armazenagem com `percentual = 50`: a soma das linhas exibidas é idêntica ao "Total da operação".

## Task 9: Restaurar a revalidação do snapshot no fechamento

A migration `224` reescreveu `close_agency_departure_report` para trocar o gate (3 departamentos no lugar de 7 seções) e, no caminho, removeu a validação de forma, chaves e tamanho criada pela `218` — que a ADR 0027 e a `RASTREABILIDADE.md` ainda afirmam existir.

- [ ] Criar `249_agency_report_snapshot_validation.sql` restaurando, sobre a versão vigente da `224`: tipos de `header`/`sections`/`occurrences`/`signoffs`, allowlist de chaves de topo (incluindo `departmentSignoffs`, Task 5), allowlist de seções refletindo o que a aba envia hoje (`costs`, `vaziosUnidades` inclusive) e o teto de 1 MiB.
- [ ] Preservar o gate de 3/3 departamentos e o fechamento dos alertas legados como estão na `224`.
- [ ] Cabeçalho da migration com intent, funções afetadas, consumidores e rollback, conforme o padrão do diretório.

**Verificação:** `agencyReportSnapshotValidationMigration.test.ts` inspecionando o SQL — presença das allowlists, do teto e do gate de 3/3 preservado.

## Task 10: Aviso de dado órfão

- [ ] Quando a viagem tiver granito ou Embarque de Vazios num porto que não é escala dela, a aba avisa — porto e quantidade — em vez de exibir seção zerada.
- [ ] O aviso é informativo: não bloqueia resolução nem fechamento.

**Verificação:** teste com granito em `BRSSA` numa viagem cuja única escala é `BRVIX`: a seção mostra o aviso, não um total zerado.

## Task 11: Documentação viva

- [ ] `CONTEXT.md`: ajustar *ADR* (o que a seção de carga descarregada conta e de onde), *Baplie EDI* (autoridade física preservada; contagem de cheios é documental), *Transbordo* (a carga conta no ADR do porto de descarga) e acrescentar *Listagem do operado* como termo do relatório.
- [ ] `docs/RASTREABILIDADE.md`: atualizar a linha de `/viagens/:voyageId?tab=adr&escala=:port` (fontes, avisos, impresso com resoluções e assinaturas) e a linha de `/embarquevazios` (porto por seleção); registrar a migration `249`.
- [ ] `docs/ARCHITECTURE.md`: fontes de derivação do ADR.
- [ ] `docs/CHANGELOG.md`: entrega registrada.
- [ ] Mover este plano para `docs/archive/plans/` e remover a linha de `docs/plans/README.md` **no mesmo change** que conclui a execução.

**Verificação:** `npm run docs:check`.

---

## Gates finais

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run docs:check`
- [ ] Conferir numa escala real: descarga com transbordo, granito com porto por extenso e uma seção sem dado — nenhuma delas pode exibir zero como fato.
