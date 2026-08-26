# Revisão dos alertas e da tela `/alertas/regras`

**Data:** 2026-08-26 · **Escopo:** catálogo de alertas, produtores SQL, roteamento
por setor e o manual `/alertas/regras` · **Documento histórico:** registra o
estado encontrado e as correções aplicadas nesta passagem.

## Pergunta que originou a revisão

> "Sinto falta de diversos alertas. Por exemplo, quando falta a finalização do
> ADR da parte de Equipamentos, deve ser emitido um alerta direcionado ao setor
> e isso não está incluído em Regras de Alertas. A minha principal dúvida é se
> os alertas que não constam lá de fato existem ou apenas foram deixados de
> constar nesta tela/manual. Além disso, alguns alertas são emitidos a mais de
> um setor, o que foi omitido também."

## Resposta

Os alertas existem no motor. A falha estava no manual: `/alertas/regras`
descrevia cada regra com **um único setor responsável**, enquanto o roteamento
real notifica um conjunto de setores. Nenhum detector precisou ser criado.

A única exceção é o inverso: duas regras que o manual prometia **não existem
mais** como alerta.

## Evidência de como o roteamento funciona

| Peça | Papel |
|---|---|
| `alert_type_catalog.responsible_department` | setor "dono" declarado do tipo |
| `alert_type_catalog.audience_departments` | audiência fixa da notificação |
| `alert_items.department` | setor gravado pelo produtor em cada item; agrupa a fila `/alertas` |
| `fanout_alert_item_for_department` (migration `338`) | audiência efetiva = `audience_departments` ∪ `{alert_items.department}` |
| fallback | item crítico sem destinatário ativo vai para Administrativo/Admin e a falha entra em `alert_notification_failures` |

Consulta de verificação no projeto remoto (`alert_type_catalog`, 28 linhas) e
leitura de `pg_get_functiondef` dos produtores confirmaram que o repositório e o
banco estavam alinhados entre si — a divergência era só com a tela.

## Achados

### 1. ADR: o alerta de Equipamentos existe e estava documentado como Documentação

`reconcile_agency_report_alerts` e `reconcile_agency_report_alerts_for_scale`
(migrations `323` e `342`) percorrem `ARRAY['operacoes','documentacao','equipamentos']`
e chamam `upsert_alert_item(..., v_department, ...)` para cada um. A pendência
por departamento é calculada por `agency_report_section_owner`:

| Setor | Seções do ADR |
|---|---|
| Operações | Escala (`datas`) |
| Equipamentos | Granito (`carga_carregada`), Veículos (`veiculos`), Embarque de vazios (`vazios_embarcados`) |
| Documentação | Carga descarregada (`carga_descarregada`), Vazios descarregados (`vazios_descarregados`) |

Ou seja: **ADR de Equipamentos pendente gera `agency_report_department_pending`
com `department = 'equipamentos'`**, aparece na fila filtrada por Equipamentos e
notifica o setor. O mesmo vale para `agency_report_deadline_missed` (prazo de 3
dias úteis a partir do ATD do terminal, cobrado por departamento sem sign-off).

O manual listava as duas regras como "Documentação", e o filtro por setor as
escondia de quem filtrava por Equipamentos.

### 2. Alertas dirigidos a mais de um setor não eram representáveis

`AlertRule.department` era um único valor. Casos reais de audiência múltipla:

| Tipo | Responsável na fila | Também notificado |
|---|---|---|
| `pix_unreconciled` | Documentação | Equipamentos |
| `voyage_schedule_date_pending` | Operações | Documentação |
| `voyage_terminal_date_pending` | Operações | Documentação |
| `agency_report_department_pending` | Operações, Documentação, Equipamentos (um item cada) | Documentação, pela audiência fixa |
| `agency_report_deadline_missed` | Operações, Documentação, Equipamentos (um item cada) | Documentação, pela audiência fixa |

Com o filtro antigo, "Equipamentos" devolvia **1 regra**; o correto são **4**.

### 3. Duas regras documentadas não existem mais

`invoice_payment_invalid` e `invoice_cancel_blocked` estavam `active = true` no
catálogo e no manual, mas:

- a migration `327` removeu os dois do `WHEN` do gatilho
  `route_catalog_alert_insert` e fechou os itens abertos;
- `register_invoice_payment` e `cancel_invoice` apenas gravam a recusa em
  `audit_logs` e devolvem erro ao operador;
- as únicas funções que ainda citam os tipos são resolvedores.

Nenhum item novo desses tipos pode nascer.

### 4. Descrição de datas defasada desde a atracação por terminal (`342`)

| Tipo | Manual antigo | Detector vigente |
|---|---|---|
| `voyage_schedule_date_pending` | "sem ATA, ETB ou ETD; ETD é previsão da escala" | ATA (a partir do ETA) e ETB (existir atracação com ETB previsto) |
| `voyage_terminal_date_pending` | "sem ATB ou ATD" | ATB (a partir do ETB), **ETD do terminal** (após a ATB) e ATD (a partir do ETD) |

O ETD deixou de ser data da escala e passou a ser data do terminal; o manual
ainda descrevia o modelo anterior e omitia uma das três etapas do terminal.

### 5. `voyage_export_after_atd` com gatilho genérico

O texto falava em "vínculos obrigatórios de exportação". A condição real é:
escala com `tem_exportacao`, terminal já com ATD e manifesto de Granito e/ou de
Vazios previsto ainda não vinculado à viagem.

### 6. Tipos legados fora do catálogo (sem ação)

`portal_invoice_created`, `portal_consolidation_obsoleted` e `demurrage`
continuam em `TYPE_LABELS` para rotular linhas históricas, não estão no
`alert_type_catalog` e não têm produtor. A ausência deles no manual está
correta.

## Correções aplicadas

- `src/services/alertRulesCatalog.ts`: a regra passa a ter
  `responsibleDepartments` (setores gravados no item) e `catalogAudience`
  (audiência SQL), com `notifiedDepartments` derivado da mesma união que o
  `fanout`; ganha `status`/`statusNote` para regras aposentadas e `routingNote`
  para explicar a distribuição. As seções do ADR por setor são derivadas de
  `AGENCY_REPORT_SECTIONS`, sem segunda cópia.
- `src/pages/AlertasRegras.tsx`: o filtro de setor passa a considerar todos os
  setores notificados; o verbete separa "Setor responsável" de "Setores
  notificados"; novo filtro de situação (ativas por padrão) com selo de regra
  aposentada e deep-link que ignora o filtro padrão.
- Textos corrigidos de ADR (pendência e prazo), PIX, datas de escala, datas de
  terminal e exportação pós-ATD.
- `supabase/migrations/347_alerts_retire_dead_invoice_types.sql`: marca
  `invoice_payment_invalid` e `invoice_cancel_blocked` como inativos no
  catálogo. Sem mudança de comportamento — os dois caminhos que consultam
  `active` já eram inalcançáveis para esses tipos.
- Testes: `src/services/__tests__/alertCatalogSql.ts` lê o catálogo direto das
  migrations `317`, `325` e `347`; `AlertasCatalogContract.test.ts` e
  `AlertasRegrasCatalog.test.tsx` passam a comparar gravidade e audiência de
  cada verbete com o SQL, além de cobrir ADR por departamento, filtro por setor
  notificado e situação.

## Não alterado de propósito

- **Roteamento real.** Nenhuma audiência SQL foi mexida. Documentação continua
  na audiência fixa dos dois tipos de ADR e, portanto, recebe também as
  notificações dos itens de Operações e Equipamentos. Isso é ruído conhecido, e
  mudá-lo é decisão de operação, não de documentação.
- **`TYPE_LABELS`/`ActiveAlertType`** mantêm os três tipos legados para que
  linhas históricas continuem legíveis.

## Verificação

`npm test` (2357 testes), `npm run lint`, `npm run build` e `npm run docs:check`
executados com sucesso nesta passagem. A migration `347` não foi aplicada
manualmente: chega ao projeto remoto pela integração GitHub do Supabase no
merge (WORKFLOW §5).
