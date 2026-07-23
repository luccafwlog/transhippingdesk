# 0030 — Observações por seção substituem Ocorrências; reabertura não reseta seções/assinaturas

Status: aceito — 2026-07-22

## Contexto

Uma sessão de revisão pós-implementação da ADR 0029 (2026-07-22) encontrou
dois problemas de modelo de dados na aba do Agency Departure Report (ADR),
além dos ajustes de apresentação registrados como nota editorial na ADR 0029:

1. **"Ocorrências" mistura autoria com responsabilidade.** Qualquer
   departamento lança uma ocorrência, mas só Operações assina a seção — o
   sign-off de Operações fica travado exigindo um estado explícito
   ("Pendente"/"Confirmado"/"Nada a declarar") mesmo quando não há nenhuma
   ocorrência de fato. A tag opcional de seção de uma ocorrência também não
   tinha nenhuma restrição: qualquer departamento podia marcar uma ocorrência
   com a seção de outro departamento.
2. **Reabrir reseta demais.** Reabrir um ADR fechado reseta as 7 seções para
   "Pendente" e apaga as 3 assinaturas departamentais, mesmo quando a
   reabertura serve só para corrigir um dado pontual de uma única seção —
   forçando os três departamentos a re-confirmar tudo do zero.

## Decisão

**Observação opcional por seção substitui a seção "Ocorrências" e a fase
"Registro".** Cada uma das 7 seções remanescentes (`datas`,
`carga_descarregada`, `carga_carregada`, `veiculos`, `vazios_embarcados`,
`vazios_descarregados`, `operacao_patio`) ganha um campo de Observação —
nota única editável, sem histórico de múltiplas entradas, sem exigir
justificativa para sobrescrever, preenchida só pelo departamento dono da
seção (mesma regra de RBAC de `agency_report_section_owner`, sem mudança).
Sobrescrever o valor é edição livre e não grava evento em `audit_logs`. A
lista de seções que compõem cada departamento
(`set_agency_report_department_signoff`, `detect_agency_report_pending`)
deixa de incluir `ocorrencias`; Operações passa a ter 1 seção própria
(`datas`) em vez de 2. A fase "Registro" é removida da aba por não ter mais
nenhuma seção própria. `agency_departure_report_occurrences` e
`add_agency_report_occurrence` deixam de ser usadas pela aba — a migração
que remove seu uso documenta o tratamento dado às ocorrências já registradas
em produção.

**Reabrir só destrava a edição.** `reopen_agency_departure_report` deixa de
resetar `agency_departure_report_signoffs` e
`agency_departure_report_department_signoffs`. Passa a só alterar o status
do relatório para `open` e limpar `closed_at`/`closed_by`/`closed_snapshot`,
mantendo a exigência de justificativa e o registro em `audit_logs` (fluxo
já existente da 0028, sem mudança). Corrigir uma seção já confirmada
continua exigindo justificativa auditada, como hoje.

## Considered Options

- **Manter "Ocorrências" e só restringir a tag de seção** (rejeitada):
  resolveria a restrição de RBAC, mas manteria o sign-off de Operações
  travado por um estado que não reflete responsabilidade real da seção.
- **Observações com histórico de múltiplas entradas, como as ocorrências
  atuais** (rejeitada): a demanda de uso real é uma nota de apoio editável,
  não um diário; histórico e justificativa de sobrescrita adicionariam
  burocracia sem necessidade — o dado formal do ADR continua sendo a
  resolução de seção e o sign-off departamental, não a Observação.
- **Reabertura seletiva por seção** (permitir escolher quais seções
  resetar) (rejeitada): mais complexa que resolve o problema; a reabertura
  já é um ato raro e auditado — bastava parar de resetar por padrão.

## Consequências

- **Supersede parcialmente a 0029** quanto a: divisão de seções (remove
  `ocorrencias`), autoria/RBAC de ocorrências (seção deixa de existir),
  gate de sign-off por departamento (Operações com 1 seção em vez de 2) e
  comportamento de reabertura (não reseta mais seções/assinaturas).
  Permanecem da 0029: sign-off por departamento com resolução por seção
  como pré-requisito, fechamento 3/3 departamentos, `operacao_patio` como
  seção sob Equipamentos, e justificativa auditada para alterar uma seção
  já resolvida.
- **Estende a 0028:** a exigência de justificativa auditada ao alterar uma
  seção já resolvida permanece inalterada; a Observação, por não ser um
  dado formal do ADR, fica fora desse contrato — sobrescrever não grava em
  `audit_logs`.
- **Schema/RPC:** coluna de observação (texto, nullable) em cada uma das 7
  seções remanescentes, associada a `agency_departure_report_signoffs`;
  nova RPC de escrita restrita ao dono da seção
  (`agency_report_section_owner`); `agency_departure_report_occurrences` e
  `add_agency_report_occurrence` ficam sem uso pela aba, documentado na
  migration; `reopen_agency_departure_report` deixa de executar os
  `UPDATE`s que resetam sign-offs de seção e departamentais.
- **RBAC inalterado:** a regra de que só o dono de uma seção pode alterá-la
  (resolução, sign-off ou Observação) já existe e não muda.
- **Migração de dados:** decisão de implementação sobre como tratar as
  ocorrências já registradas em produção (mapear para a Observação da seção
  tagueada, quando houver, ou preservar como registro histórico à parte,
  fora da aba) fica documentada na migration correspondente. A mesma
  migration também precisa tratar as linhas de
  `agency_departure_report_signoffs` com `section = 'ocorrencias'`
  (existentes desde a 0029, quando o gate departamental ainda incluía essa
  seção) antes de estreitar o enum/CHECK de seções para as 7 remanescentes
  — apagar ou arquivar essas linhas é decisão de implementação a ser
  documentada junto com a migração das ocorrências.
- Os ajustes de apresentação relacionados (agrupamento visual de "Vazios
  embarcados" junto de "Operação de pátio"; remoção da legenda-resumo de
  todas as seções) ficam registrados como nota editorial na ADR 0029, por
  serem mudanças de apresentação, não de modelo de dados/RBAC.
- O documento impresso (`AgencyReportDocument`) fica fora de escopo desta
  decisão — continua refletindo o modelo anterior até uma fase seguinte, já
  registrada em plano próprio.
