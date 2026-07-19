# ADR (Agency Departure Report) — design da funcionalidade

Data: 2026-07-19. Decisões confirmadas em sessão de grill com o usuário,
validadas contra o modelo real da empresa (`ADR_LOGIN_ENDURANCE_081N.pdf`,
escala Salvador/TECON SSA do LOGIN ENDURANCE/081N). Termos em
[`CONTEXT.md`](../../CONTEXT.md); decisão arquitetural na
[ADR 0027](../adr/0027-agency-departure-report-agregado-escala-snapshot.md).

## Problema

O ADR é o relatório completo de uma escala brasileira do navio (uma escala =
um ADR) e a fonte que o Financeiro usa para aprovar pagamentos de faturas.
Hoje vive fora do sistema (planilha/PDF por escala). Parte do conteúdo já
existe em módulos (datas, carga, granito, veículos, vazios, restow); parte não
existe em lugar nenhum (depot/hand-in/hand-out/overtime/material dos vazios,
serviços extra de reorganização, ocorrências, completude por departamento,
consolidação estável).

## Decisões (todas confirmadas)

1. **Âncora:** tabela `agency_departure_reports` com chave natural
   `(voyage_id, port)` — sem promover escala a entidade. Só PODs brasileiros.
   Escala com dois terminais mantém um ADR; terminal é atributo do cabeçalho.
   Armador do cabeçalho deriva de `vessels.carrier_id`.
2. **UI:** aba "ADR" em `/viagens/:voyageId`, com seletor de escala e
   deep-link (`?tab=adr&escala=BRSSA`). Sem rota top-level nova.
3. **Derivação:** o ADR exibe dados construídos nos módulos donos; não
   redigita. Nasce no ADR apenas: ocorrências, sign-offs e o campo terminal.
4. **Vazios EXP estendido (não recriado):** ver modelo de dados abaixo.
   Entrada por colunas novas na planilha modelo + edição inline na tabela.
5. **Completude:** sign-off por seção com dono departamental
   (Pendente → Confirmado | Nada a declarar). Donos: Operações — datas
   confirmadas, ocorrências; Equipamentos — vazios embarcados (incl. serviços
   extra), veículos; Documentação — carga descarregada, carga carregada,
   vazios descarregados.
6. **Equipamentos** vira perfil RBAC novo (escrita em VAZIOS EXP e Veículos +
   sign-offs próprios; leitura no restante).
7. **Ciclo de vida:** ADR existe desde que a escala existe; pendências viram
   alertas (em `/alertas`, por departamento) somente após o ATD da escala.
8. **Fechamento com snapshot:** ação explícita, exige todas as seções com
   sign-off; congela snapshot derivado + próprio. Reabertura auditada com
   justificativa. Financeiro só consulta (sem ato de aprovação próprio).
9. **Saída:** documento imprimível via navegador, reutilizando o padrão de
   `InvoiceDocumentKit`/`window.print()`, espelhando o layout do modelo real.
10. **Granito é exportação** (glossário corrigido): entra exclusivamente na
    seção carga carregada, filtrado por `loading_port` = porto da escala.
    Não aparece em carga descarregada — sem dupla contagem.
11. **Vazios descarregados** têm natureza: `cama` (base de estiva) ou
    `cover_plate` (tampas de porões). A coluna OOCL do modelo antigo foi
    descontinuada; Empréstimo Intermarítima idem — ambos fora do escopo.
12. **Serviços extra de reorganização** (bundle, desova, visual check):
    quantidade por tipo de container × tarifa configurável (tarifas do modelo
    estão desatualizadas; nunca fixar em código).
13. **Overtime** cobrado como % sobre a tarifa do depot; o percentual é
    registrado por depot na operação de vazios da escala; as quantidades
    derivam das marcações por container.
14. **Storage** deriva de hand-in/hand-out por container (dias = diferença).
15. **Restow** deriva do campo `rtw` existente na projeção da escala
    (planejamento por POD); exibido como total da escala.
16. **Local de desova** de veículos é atributo do container com veículo,
    preenchido na tela de Veículos.

## Modelo de dados

Nomenclatura: prefixo completo `agency_departure_report_` em todas as tabelas
do agregado — nunca `adr_` (colide com Architecture Decision Record; regra do
CONTEXT.md).

### Novas tabelas

- `agency_departure_reports`
  - `id`, `voyage_id` FK → `voyages`, `port` (código normalizado do POD),
    `terminal text` (cabeçalho, editável por Operações), `status`
    (`open` | `closed`), `closed_at`, `closed_by`, `closed_snapshot jsonb`
    (nulo enquanto aberto), `created_at`. Unique `(voyage_id, port)`.
    Criado lazy: materializa no primeiro dado próprio (sign-off, ocorrência,
    terminal) ou no fechamento; antes disso a aba renderiza das fontes
    derivadas sem linha persistida.
- `agency_departure_report_signoffs`
  - `report_id` FK, `section` (enum: `datas`, `carga_descarregada`,
    `carga_carregada`, `veiculos`, `vazios_embarcados`,
    `vazios_descarregados`, `ocorrencias`), `state`
    (`pending` | `confirmed` | `nothing_to_declare`), `department` dono,
    `signed_by`, `signed_at`. Unique `(report_id, section)`.
- `agency_departure_report_occurrences`
  - `report_id` FK, `body text`, `author_id`, `department`, `created_at`.
    Append-only (sem update/delete via RLS; correção = novo lançamento).
- `vazios_export_operations` — a operação de vazios da escala
  - `voyage_id`, `embark_port`, `os_number text`, timestamps. Unique
    `(voyage_id, embark_port)`.
- `vazios_export_overtime_depots` — % de overtime aplicado por depot
  - `operation_id` FK, `depot text`, `percent numeric`. As quantidades não
    ficam aqui: derivam das flags por container.
- `vazios_reorg_services` — serviços extra de reorganização
  - `operation_id` FK, `service` (enum: `bundle`, `desova`, `visual_check`),
    `container_type`, `qty`. Valor = qty × tarifa vigente.
- `vazios_reorg_rates` — tarifas configuráveis por serviço
  - `service`, `rate_brl`, vigência/`active` (mesmo padrão de
    `granite_rates`/`demurrage_rates`).

### Alterações em tabelas existentes

- `vazios_bookings` (por container): + `embark_port` (espelha o `pod` de
  `vazios_importacao_containers`), + `depot text` (nulo = Embarque Direto),
  + `material boolean` (material do armador), + `bundle boolean`,
  + `transporte boolean` (transporte depot→terminal), + `hand_in_date`,
  + `hand_out_date` (storage dias = diferença), + `overtime_handling
  boolean`, + `overtime_transport boolean`.
- `vazios_importacao_containers`: + `natureza` (`cama` | `cover_plate`).
- `bl_containers`: + `unpacking_location text` (local de desova; preenchido
  na tela de Veículos para containers com veículo).
- `user_profiles`: novo papel `equipamentos` + policies/RPCs de escopo
  (escrita em `vazios_manifests`/`vazios_bookings`/`vazios_export_*`/
  `vazios_reorg_*`/`vehicles` e no `unpacking_location`; sign-off das seções
  próprias; leitura no restante).

### Snapshot de fechamento

`closed_snapshot` guarda o payload completo exibido no relatório no momento do
fechamento (cabeçalho, matrizes por tipo, contagens, listas, ocorrências,
sign-offs, valores de serviços extra). Depois de fechado, a aba e a impressão
leem o snapshot; o modo aberto lê as fontes vivas. Reabertura exige
justificativa, grava auditoria (padrão `audit_logs`), limpa `closed_*` e
retorna a Pendente as seções indicadas.

## Blocos do relatório e fontes de derivação

Espelham o modelo real da empresa:

| Bloco do modelo | Fonte | Seção / dono |
|---|---|---|
| Cabeçalho (armador, navio/viagem, porto, terminal, ATA, ATD) | `vessels.carrier_id`, viagem, projeção `voyage_pod_schedule`; `terminal` no próprio ADR | Datas — Operações |
| Restow | Campo `rtw` da projeção da escala (total) | Datas — Operações |
| Carga solta (máquinas, packages, ton, cbm) | Campos BB dos B/Ls do porto | Carga descarregada — Documentação |
| Descarga containers (matriz tipo × carga geral/veículos/transbordo/IMO) | Containers dos B/Ls + Baplie do POD (`size_type`, flags IMO, veículos via `vehicles`, transbordo via registro de omissão/transbordo) | Carga descarregada — Documentação |
| Vazios descarregados (cama / cover plate) | `vazios_importacao_containers` com `pod` = porto + `natureza` | Vazios descarregados — Documentação |
| Granito (ton, blocos) | `granite_bls` com `loading_port` = porto (`real_weight_kg`, `blocks_qty`) | Carga carregada — Documentação |
| Container com veículo (marca, qty BL, qty VIN, local desova) | `vehicles` (brand, bl_id, chassis) + `bl_containers.unpacking_location` | Veículos — Equipamentos |
| Embarque container vazio (matriz tipo × embarcado/material/transporte/bundles/hand-in/hand-out/overtime) + OS + embarque direto + depots | `vazios_bookings` com `embark_port` = porto + `vazios_export_operations` | Vazios embarcados — Equipamentos |
| Serviço extra — reorganização (qty × tarifa) | `vazios_reorg_services` × `vazios_reorg_rates` | Vazios embarcados — Equipamentos |
| Storage cntrs (total, dias) | Derivado de `hand_in_date`/`hand_out_date` | Vazios embarcados — Equipamentos |
| Over time (qty, %, depot) | Flags de overtime por container + `vazios_export_overtime_depots` | Vazios embarcados — Equipamentos |
| Ocorrências | `agency_departure_report_occurrences` | Ocorrências — Operações |

## Alertas de faltantes

- Gatilho: escala com ATD e seção em `pending` ⇒ pendência por departamento
  dono, exibida em `/alertas` e no Painel (mesmo padrão dos alertas internos
  existentes; sem email).
- ADR fechado encerra as pendências da escala.

## Fluxo da aba

1. Seletor de escala (PODs brasileiros da viagem; omitidas marcadas e sem ADR).
2. Blocos por seção com dados derivados + chip de estado do sign-off; o botão
   Confirmar/Nada a declarar aparece para o departamento dono (e
   Administrativo).
3. Diário de ocorrências (lista + campo de novo lançamento).
4. Barra de status: X/7 seções confirmadas; botão **Fechar ADR** habilita com
   7/7; fechado mostra data/autor, botão Imprimir e ação Reabrir (com
   justificativa).

## Fases de implementação sugeridas

1. **Fundações Vazios EXP + Equipamentos:** colunas novas em
   `vazios_bookings` e `vazios_importacao_containers`, tabelas
   `vazios_export_*` e `vazios_reorg_*`, planilha modelo, edição inline,
   papel `equipamentos` e policies. Verificável isoladamente.
2. **Aba ADR (leitura derivada):** agregação por escala, matrizes por tipo,
   seções somente leitura. Sem persistência própria ainda (exceto terminal).
3. **Sign-offs + ocorrências + alertas pós-ATD.**
4. **Fechamento com snapshot + reabertura auditada + impressão no layout do
   modelo real.**

## Fora de escopo

- Promover escala a entidade (`port_calls`) — evolução futura registrada na
  ADR 0027.
- Ato de aprovação do Financeiro no ADR.
- Página/lista top-level de ADRs cross-viagem (possível fase futura).
- Taxonomia de ocorrências.
- Coluna OOCL e Empréstimo Intermarítima do modelo antigo (descontinuados).
- Qualquer automação financeira a partir do ADR (os valores de serviços extra
  são informativos para conferência, não geram invoice).

## Glossário afetado

`CONTEXT.md` já atualizado: ADR (Agency Departure Report), Seção do ADR,
Sign-off de Seção do ADR, Fechamento do ADR, Ocorrência da Escala,
Equipamentos, Escopo de Equipamentos, Overtime (de escala), Depot de Vazios,
Embarque Direto, Hand-in/Hand-out, Material do Armador, Serviço Extra de
Reorganização, OS da Operação de Vazios, Natureza do Vazio Descarregado,
Restow, Local de Desova; definição de Granito corrigida (carga de exportação;
"importação" é ingestão de planilha).
