# Escala com múltiplos terminais e ADR por terminal

Status: **em desenho** — sessão de grilling aberta em 2026-08-18.

Esta spec registra decisões de domínio já fechadas que **ainda não estão
implementadas**. Enquanto ela viver aqui, o `CONTEXT.md`, o
`docs/ARCHITECTURE.md` e o schema continuam descrevendo o comportamento atual
— identidade `(viagem, porto)`. A atualização daqueles documentos acontece na
mesma mudança que implementar o modelo, junto com a ADR de engenharia e a
migration.

## Caso operacional que motiva a mudança

GREEN PECEM V.9, escala BRVIX:

1. Atraca no terminal **T.V.V** e descarrega os containers de importação.
2. Terminada a descarga, faz **shifting** para o terminal **PORTMAC**.
3. Na PORTMAC descarrega a carga solta e embarca **granito** e **containers
   vazios**.

Um porto, uma escala, dois terminais — e os escopos operados são **disjuntos**:
nada do que foi feito no TVV foi feito na PORTMAC. Hoje o sistema produz um
relatório só para os dois.

## Decisão 1 — a identidade do ADR passa a ser (viagem, porto, terminal)

Cada Terminal da Escala gera o seu próprio ADR, com as suas seis seções, os
seus três sign-offs departamentais e o seu fechamento próprios, declarando
apenas o que foi operado naquele terminal. O terminal deixa de ser rótulo do
cabeçalho e passa a ser parte da identidade.

Isso supersede:

- `CONTEXT.md`, verbete **ADR (Agency Departure Report)**: "A identidade do ADR
  é (viagem, porto): uma escala que opera em dois terminais mantém um único
  ADR, com o terminal como atributo do cabeçalho."
- ADR 0027, que ancorou o relatório em `(voyage_id, port)`.
- ADR 0035, que reafirmou a âncora `(viagem, porto brasileiro)` e decidiu que a
  escala gera **um** ADR nos três casos (só importação, só exportação, ambos).

O que **não** muda: a Escala continua sendo `(Viagem, porto)`, portos
estrangeiros continuam fora, e escala que só embarca continua gerando ADR com
os três sign-offs.

## Superfície afetada (levantada, não decidida)

| Onde | Estado atual |
|---|---|
| `supabase/migrations/213_agency_departure_reports.sql:18` | `UNIQUE (voyage_id, port)` |
| `agency_departure_reports.terminal` | texto livre, sem vínculo com o Cadastro de Terminais |
| RPC `set_agency_report_terminal(p_voyage_id, p_port, p_terminal)` | grava o rótulo do cabeçalho |
| `src/services/agencyDepartureReport.ts` | lê o relatório por `(voyage_id, port)` |
| `src/components/voyages/VoyageAgencyReportTab.tsx` | `<input>` de terminal no cabeçalho |
| `src/services/voyageRouteSchedules.ts` | `VoyageEscalaSchedule` não tem terminal |
| `docs/ARCHITECTURE.md` | documenta a âncora `(voyage_id, port)` |
| `CONTEXT.md` (Embarque de Vazios, Cadastro de Terminais) | repetem a identidade `(viagem, porto)` |

## Decisão 2 — a Escala planeja seus terminais; os ADRs derivam da lista

Uma escala pode ter mais de um terminal. A lista vive na **Escala**, não no ADR:
é ela que o Line-Up, o Painel e a TV leem. O ADR não inventa terminal — deriva.

## Decisão 3 — terminal é sempre um terminal cadastrado, nunca texto livre

O `agency_departure_reports.terminal` de texto livre acaba. O terminal passa a
referenciar o cadastro do sistema.

Pendência que isso abre: a tabela `depots` **não tem porto** (colunas: `code`,
`name`, `tipo`, `free_time_*`, `active`). Um terminal cadastrado hoje não sabe a
que porto pertence, então nada impediria vincular um terminal de Santos a uma
escala de Vitória.

## Decisão 4 — a atribuição do operado ao terminal é manual e obrigatória

Nenhum módulo de origem carrega terminal, e não haverá inferência. O usuário
**aponta** a que terminal cada parcela da operação pertence, e o preenchimento é
**impeditivo** — sem ele a operação não segue.

O grão da atribuição **não é a seção do ADR**. Verificado em
`src/components/voyages/AgencyReportDocument.tsx:583` e `:621`: "Carga solta" e
"Matriz de descarga" pertencem ambas à seção `carga_descarregada`, com o mesmo
dono e o mesmo sign-off. No caso GREEN PECEM os containers de importação foram
ao TVV e a carga solta à PORTMAC — dois terminais dentro de uma seção só. Uma
atribuição por seção não representaria o caso que motivou a mudança.

## Decisão 5 — cada terminal gera uma linha no Line-Up, no Painel e na TV

Chegadas e Saídas não é afetado.

## Questões em aberto

Ordenadas por dependência.

| # | Bloco | Questão |
|---|---|---|
| A2 | Modelo | ADR nasce só quando há terminal — e a escala sem terminal declarado? |
| A3.1 | Modelo | Terminal cadastrado precisa de porto; e quem pode ser escolhido (`tipo`)? |
| B1 | Atribuição | Qual é exatamente a lista de parcelas atribuíveis, e como chamá-la |
| B2 | Atribuição | O que "impeditivo" bloqueia, e em que momento |
| C1 | Datas | Quais datas são da escala e quais da atracação (o shifting cria uma segunda) |
| D1 | ADR | Embarque de Vazios: um por escala ou um por terminal |
| D2 | ADR | Prazo departamental (ADR 0039) e alerta pós-ATD com dois ADRs |
| D3 | ADR | Fechamento e impresso |
| E1 | Superfícies | Terminal × sentido: quantas linhas exatamente |
| E2 | Superfícies | Aba de terminal no Painel — escopo |
| F1 | Transição | Os `terminal` de texto livre já gravados, e a migration |

### Colisão de terminologia a resolver em B1

"Natureza da carga" não serve como nome: **natureza** já é três coisas neste
domínio — Natureza do Serviço (armazenagem/transporte/geral), a natureza da
matriz de descarga (tipo × natureza) e a `natureza` do vazio de importação
(cama/cover plate).
