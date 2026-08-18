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

## Questões em aberto

1. **Ciclo de vida.** Quando os dois ADRs passam a existir? O shifting costuma
   ser decidido com o navio já atracado, então o segundo terminal não é
   previsível no cadastro da escala. Escala sem terminal declarado produziria
   zero ADRs — regressão do buraco de alerta silencioso que a ADR 0035 fechou.
2. **Atribuição do operado.** Nenhum módulo de origem carrega terminal: B/L,
   carga solta, granito e veículos não têm o campo. Sem isso, dois ADRs
   mostrariam os mesmos números duplicados. Só a Unidade Embarcada tem `local`,
   e ainda assim é o local de *origem* do vazio, não o terminal de operação.
3. **Datas.** Quais pertencem à escala e quais ao terminal. ATA e ATD do porto
   são um só; a atracação (ATB) é por terminal, e o shifting cria uma segunda.
4. **Natureza do terminal.** Continua texto livre ou passa a referenciar o
   Cadastro de Terminais (tipo `terminal_portuario`)?
5. **Embarque de Vazios.** Hoje existe um por escala, "com a mesma identidade do
   ADR". Passa a ser um por terminal?
6. **Prazo e alertas.** ADR 0039 mede o prazo de conclusão por departamento;
   com dois ADRs, o SLA passa a contar duas vezes na mesma escala.
7. **Line-Up, Painel e Programação do Portal.** A escala com dois terminais
   vira duas linhas, ou continua uma?
8. **Aba de terminal no Painel.** Escopo e conteúdo ainda não definidos.
9. **Dados existentes.** O que fazer com os `terminal` de texto livre já
   gravados.
