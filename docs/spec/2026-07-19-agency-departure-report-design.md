# ADR (Agency Departure Report) — design da funcionalidade

Data: 2026-07-19. Decisões confirmadas em sessão de grill com o usuário.
Termos em [`CONTEXT.md`](../../CONTEXT.md); decisão arquitetural na
[ADR 0027](../adr/0027-agency-departure-report-agregado-escala-snapshot.md).

## Problema

O ADR é o relatório completo de uma escala brasileira do navio (uma escala =
um ADR) e a fonte que o Financeiro usa para aprovar pagamentos de faturas.
Hoje vive fora do sistema. Parte do conteúdo já existe em módulos (datas,
carga, granito, veículos, vazios); parte não existe em lugar nenhum (porto de
embarque/depot/overtime dos vazios, ocorrências, completude por departamento,
consolidação estável).

## Decisões (todas confirmadas)

1. **Âncora:** tabela `agency_departure_reports` com chave natural
   `(voyage_id, port)` — sem promover escala a entidade. Só PODs brasileiros.
2. **UI:** aba "ADR" em `/viagens/:voyageId`, com seletor de escala e
   deep-link (`?tab=adr&escala=BRSSA`). Sem rota top-level nova.
3. **Derivação:** o ADR exibe dados construídos nos módulos donos; não
   redigita. Nasce no ADR apenas: ocorrências e sign-offs.
4. **Vazios EXP estendido (não recriado):** porto de embarque, depot e
   overtime (handling e transporte) por container/booking em
   `vazios_bookings`; entrada por colunas novas na planilha modelo + edição
   inline na tabela.
5. **Completude:** sign-off por seção com dono departamental
   (Pendente → Confirmado | Nada a declarar). Donos: Operações — datas
   confirmadas, ocorrências; Equipamentos — vazios embarcados, veículos;
   Documentação — carga descarregada, carga carregada, vazios descarregados.
6. **Equipamentos** vira perfil RBAC novo (escrita em VAZIOS EXP e Veículos +
   sign-offs próprios; leitura no restante).
7. **Ciclo de vida:** ADR existe desde que a escala existe; pendências viram
   alertas (em `/alertas`, por departamento) somente após o ATD da escala.
8. **Fechamento com snapshot:** ação explícita, exige todas as seções com
   sign-off; congela snapshot derivado + próprio. Reabertura auditada com
   justificativa. Financeiro só consulta (sem ato de aprovação próprio).
9. **Saída:** documento imprimível via navegador, reutilizando o padrão de
   `InvoiceDocumentKit`/`window.print()`.
10. **Carga carregada** = granito + vazios embarcados; não há outra carga de
    exportação a modelar.

## Modelo de dados

### Novas tabelas

- `agency_departure_reports`
  - `id`, `voyage_id` FK → `voyages`, `port` (código normalizado do POD),
    `status` (`open` | `closed`), `closed_at`, `closed_by`,
    `closed_snapshot jsonb` (nulo enquanto aberto), `created_at`.
  - Unique `(voyage_id, port)`. Criado lazy: o registro materializa no
    primeiro sign-off/ocorrência ou no fechamento; antes disso a aba renderiza
    a partir das fontes derivadas sem linha persistida.
- `adr_section_signoffs` *(prefixo de tabela `adr_` é aceitável; em tipos e
  código usar nomes completos `AgencyDepartureReport*`)*
  - `report_id` FK, `section` (enum: `datas`, `carga_descarregada`,
    `carga_carregada`, `veiculos`, `vazios_embarcados`, `vazios_descarregados`,
    `ocorrencias`), `state` (`pending` | `confirmed` | `nothing_to_declare`),
    `department` dono, `signed_by`, `signed_at`. Unique `(report_id, section)`.
- `adr_occurrences`
  - `report_id` FK, `body text`, `author_id`, `department`, `created_at`.
    Append-only (sem update/delete via RLS; correção = novo lançamento).

### Alterações em tabelas existentes

- `vazios_bookings`: + `embark_port` (código de porto, espelha o `pod` de
  `vazios_importacao_containers`), + `depot text`, + `overtime_handling
  boolean`, + `overtime_transport boolean`.
- `user_profiles`: novo papel `equipamentos` + policies/RPCs de escopo
  (escrita em `vazios_manifests`/`vazios_bookings`/`vehicles`; sign-off das
  seções próprias; leitura no restante).

### Snapshot de fechamento

`closed_snapshot` guarda o payload completo exibido no relatório no momento do
fechamento (datas, contagens e listas por seção, ocorrências, sign-offs).
Depois de fechado, a aba e a impressão leem o snapshot; o modo aberto lê as
fontes vivas. Reabertura (`reopen`) exige justificativa, grava auditoria
(padrão `audit_logs`), limpa `closed_*` e retorna as seções afetadas a
Pendente quando a justificativa indicar.

## Derivação por seção (fontes)

| Seção | Fonte | Dono |
|---|---|---|
| Datas confirmadas | Projeção `voyage_pod_schedule` (ETA/ATA/ETB/ATB/ETD/ATD, escala Mercante) | Operações |
| Carga descarregada | B/Ls + containers do POD (CNTR), BB dos B/Ls, `granite_bls` com `discharge_port` = porto | Documentação |
| Carga carregada | `granite_manifests/bls` com `loading_port` = porto + vazios embarcados | Documentação |
| Veículos | `vehicles` da viagem (marcas distintas, qtd de BLs, qtd de chassis) | Equipamentos |
| Vazios embarcados | `vazios_bookings` com `embark_port` = porto (inclui depot e overtime) | Equipamentos |
| Vazios descarregados | `vazios_importacao_containers` com `pod` = porto | Documentação |
| Ocorrências | `adr_occurrences` | Operações |

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
   `vazios_bookings`, planilha modelo, edição inline, papel `equipamentos` e
   policies. Verificável isoladamente.
2. **Aba ADR (leitura derivada):** agregação por escala, seções somente
   leitura. Sem persistência própria ainda.
3. **Sign-offs + ocorrências + alertas pós-ATD.**
4. **Fechamento com snapshot + reabertura auditada + impressão.**

## Fora de escopo

- Promover escala a entidade (`port_calls`) — evolução futura registrada na
  ADR 0027.
- Ato de aprovação do Financeiro no ADR.
- Página/lista top-level de ADRs cross-viagem (possível fase futura).
- Taxonomia de ocorrências.
- Qualquer automação financeira a partir do ADR.

## Glossário afetado

`CONTEXT.md` já atualizado: ADR (Agency Departure Report), Seção do ADR,
Sign-off de Seção do ADR, Fechamento do ADR, Ocorrência da Escala,
Equipamentos, Escopo de Equipamentos, Overtime (de escala), Depot de Vazios.
