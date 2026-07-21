# Plano — ADR: sign-off departamental, seções na ordem do ciclo e operação de pátio

Base de decisão: [ADR 0029](../adr/0029-adr-signoff-departamental-fases-ciclo.md)
(supersede parcialmente a [0027](../adr/0027-agency-departure-report-agregado-escala-snapshot.md),
estende a [0028](../adr/0028-adr-signoff-historico-justificativa-audit-logs.md)).
Glossário atualizado em `CONTEXT.md` (Seção do ADR, Resolução de Seção, Sign-off
Departamental, Operação de Pátio, Ocorrência da Escala, Fechamento do ADR).

Status: TODO. Superfície desta fase: **aba na tela**. O documento impresso
(`AgencyReportDocument`) é redesenhado em fase posterior (ver Task 8).

## Invariantes (não regridem)

- ADR é exibição derivada: só terminal, ocorrências e resolução/sign-offs são
  digitados. Nenhum campo novo redigitado.
- Identidade `(voyage_id, port)`; snapshot de fechamento imutável; Financeiro sem
  ato próprio de aprovação.
- Histórico auditável e justificativa da 0028 preservados.

## Tarefas

### Task 1 — Enum de seções + mapa de donos
Adicionar `operacao_patio` ao enum/lista de seções e ao mapa
`AGENCY_REPORT_SECTIONS` (dono = `equipamentos`). Passa a haver **8 seções**.
- Arquivos: `src/services/agencyDepartureReport.ts` (`AGENCY_REPORT_SECTIONS`,
  tipos `AgencyReportSection`, labels), migração de enum se aplicável.
- Verify: type-check + teste unitário do mapa dono↔seção cobrindo as 8 seções.

### Task 2 — Resolução de seção separada do sign-off departamental
Modelar dois conceitos: **resolução de seção** (Pendente/Confirmado/Nada a
declarar, pré-requisito, por seção) e **sign-off departamental** (ato por
departamento, habilitado quando todas as seções do depto estão resolvidas).
- Schema: manter a resolução por seção (tabela/estado atual dos signoffs) e
  derivar/persistir o estado departamental; reabrir depto exige justificativa
  (reusar `audit_logs`, padrão 0028, `entity_type` para o ato departamental).
- RPC: `set_agency_report_signoff` continua gravando resolução por seção;
  novo caminho para o ato/reabertura departamental com `p_justification`.
- Verify: teste de migração (nomear na convenção sequencial da ADR 0016) +
  teste de que o sign-off departamental só habilita com todas as seções
  resolvidas, e que reabrir exige justificativa.

### Task 3 — Fechamento por 3 departamentos
Trocar o gate de "7 seções assinadas" por "3 departamentos assinados". Ajustar
`useCloseAgencyReport`, o contador `confirmadas X/7` → `X/3` e a validação de
fechamento (cliente + RPC).
- Arquivos: `src/hooks/useAgencyReport.ts`, `src/components/voyages/VoyageAgencyReportTab.tsx`,
  RPC de fechamento.
- Verify: teste — fechar bloqueado até os 3 deptos; snapshot inalterado no formato.

### Task 4 — Alertas por departamento
Migrar os alertas de pendência de "seção pendente" para "departamento pendente",
mantendo o gatilho após o ATD.
- Arquivos: `src/services/alerts.ts` (+ testes de cópia de alerta já existentes:
  `agencyReportPendingAlertsMigration`, `agencyReportAlertCopyMigration`).
- Verify: teste de que uma seção pendente gera um alerta por depto, não por seção.

### Task 5 — Ocorrências: qualquer departamento + tag opcional de seção
Ampliar o insert de ocorrência para os três departamentos (hoje `canEditOperations`);
adicionar referência opcional a uma das 8 seções; Operações permanece dona do
sign-off do diário.
- Schema: coluna `section` (nullable) em `agency_report_occurrences`; RLS/insert
  ampliado.
- Arquivos: `useAddAgencyReportOccurrence`, `VoyageAgencyReportTab.tsx`.
- Verify: teste de insert por Documentação/Equipamentos + ocorrência com e sem tag.

### Task 6 — Layout por fases do ciclo + barra-resumo
Reorganizar a aba em 5 faixas com título (Escala → Importação → Operação de
pátio → Exportação → Registro) e uma barra-resumo dos 3 deptos no topo (estado +
assinar + Fechar ADR). Mover storage/overtime/depots/OS/serviço extra da seção
"Embarque de vazios" para a fase **Operação de pátio**.
- Arquivo: `src/components/voyages/VoyageAgencyReportTab.tsx`.
- Verify: teste de componente — as 5 faixas renderizam; barra-resumo mostra 3
  deptos; operação de pátio fora do bloco de embarque.

### Task 7 — Números-herói, IMO destacado, legendas e cópia
Por bloco: número-herói (containers descarregados: total + tipo + **IMO à
parte**; carga solta: peso ton; vazios descarregados: total + tipo; veículos:
VINs + por marca + local de desova + BLs; storage: dias; granito: peso + blocos;
embarque: total; cabeçalho: janela **ATB→ATD**). Legenda curta sempre visível,
voltada ao Financeiro ("o que o número conta + estado"; vazios desc./veículos/
pátio = só definição). Cópia: "Container com veículo" → "Veículos"; "Matriz de
descarga (tipo × categoria)" → "Descarga de importação".
- Arquivo: `VoyageAgencyReportTab.tsx` (+ helpers de agregação em
  `agencyDepartureReport.ts` se necessário).
- Verify: teste de que IMO aparece separado da contagem geral; snapshots de cópia.

### Task 8 — (fase seguinte) Espelhar o impresso
Redesenhar `AgencyReportDocument` para as 5 fases / 3 sign-offs — fora do escopo
desta fase, registrado para não divergir do snapshot que o Financeiro aprova.

## Verificação final

`npm run docs:check`, `npm run lint`, `npm test`, `npm run build`.
Nunca executar o script de reset suspenso.

## Riscos / pendências

- Divergência temporária aba × impresso até a Task 8 (aceito na ADR 0029).
- Migração dos sign-offs por seção existentes deve preservar o histórico em
  `audit_logs` (0028).
