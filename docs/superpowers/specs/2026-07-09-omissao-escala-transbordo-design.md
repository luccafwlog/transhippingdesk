# Omissão de Escala e Transbordo — Design

> **Status:** proposto · **Data:** 2026-07-09 · **Escopo:** registro operacional
> do evento (rastreabilidade, timeline, visibilidade no Portal). Financeiro
> permanece manual nesta entrega.

Termos de domínio seguem [`CONTEXT.md`](../../../CONTEXT.md); arquitetura segue
[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md); o módulo afetado é
[Viagens](../../modules/viagens.md).

## 1. Problema

Uma viagem já cadastrada (rota, escalas, CE Mercante por B/L, taxas emitidas)
pode ter uma **escala omitida pelo armador** perto da chegada. A carga daquele
porto é **descarregada no porto que manteve a escala**, e depois cada B/L segue
um de dois caminhos:

- **Transbordo (transshipment):** o destino final é preservado; a carga segue
  em um **navio de terceiros** do porto de descarga até o destino original.
- **COD (Change of Destination):** o cliente opta por tornar o **porto de
  descarga o novo destino final**; não há perna adicional.

Caso de referência: viagem **CHASE V.1** (POLs QINGDAO/TAICANG/NANSHA/NINGBO →
PODs Salvador e Vitória). O armador **omite Salvador**; toda a carga desce em
**Vitória**. Por padrão os B/Ls de Salvador entram em **transbordo** (navio de
terceiros Vitória → Salvador); exceções viram **COD** (destino final = Vitória).

Hoje o sistema não tem conceito de escala omitida, transbordo nem COD. Um B/L
pertence a uma única viagem (`bls.voyage_id`) e a rota/escala vive em schedules
POD/POL reconstruídos de `audit_logs`.

## 2. Escopo

**Dentro:**

- Marcar uma escala (POD) de uma viagem como **omitida**, apontando o **porto de
  descarga** (outro POD ativo da mesma viagem).
- Registrar, por B/L do porto omitido, a **disposição** (`transshipment` padrão,
  `cod` exceção) e, no transbordo, a **referência leve** do navio de terceiros.
- No COD, reescrever o POD do B/L para o porto de descarga (auditado).
- Registrar o evento no **Histórico do B/L** (interno) e na **timeline da
  Viagem**.
- Emitir uma **notificação no Portal** por B/L afetado (tradução mínima de
  "timeline do evento" para o cliente).

**Fora (permanece manual):**

- CE Mercante do transbordo (retificação/baldeação no Mercante federal).
- Recálculo de taxas locais e de demurrage; início do free time (descarga em
  Vitória vs. entrega em Salvador).
- Modelar o navio de terceiros como Viagem completa (decidido: referência leve).
- Seleção de B/L a B/L do conjunto afetado: o conjunto é **derivado da escala**
  (todos os B/Ls do POD omitido); a disposição é que é por B/L.

## 3. Modelo de dados

Duas tabelas novas (grãos distintos) mais um marcador no schedule existente.

### 3.1 `voyage_omissions` (grão: escala)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `voyage_id` | BIGINT FK `voyages(id)` | |
| `omitted_pod` | TEXT | POD omitido (ex.: `Salvador`) |
| `discharge_pod` | TEXT | POD que manteve a escala e recebeu a carga (ex.: `Vitória`); deve ser um POD ativo da mesma viagem |
| `reason` | TEXT NULL | Justificativa do armador |
| `omitted_by` | UUID FK `auth.users(id)` | |
| `omitted_at` | TIMESTAMPTZ DEFAULT now() | |

Restrição: um POD só pode ter uma omissão ativa por viagem
(`UNIQUE(voyage_id, omitted_pod)`).

### 3.2 `bl_transshipments` (grão: B/L)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `bl_id` | TEXT FK `bls(id)` | |
| `omission_id` | BIGINT FK `voyage_omissions(id)` | |
| `disposition` | TEXT CHECK (`transshipment`,`cod`) | Padrão `transshipment` |
| `onward_vessel_name` | TEXT NULL | Só transbordo |
| `onward_carrier` | TEXT NULL | Terceiro; só transbordo |
| `onward_voyage_number` | TEXT NULL | Só transbordo |
| `onward_etd` | TIMESTAMPTZ NULL | ETD do porto de descarga; só transbordo |
| `onward_eta` | TIMESTAMPTZ NULL | ETA no destino final; só transbordo |
| `created_by` | UUID FK `auth.users(id)` | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ DEFAULT now() | |

Restrição: `UNIQUE(bl_id, omission_id)` (um registro de disposição por B/L por
omissão). Os campos `onward_*` só fazem sentido quando `disposition =
'transshipment'`; um CHECK garante que ficam nulos no COD.

### 3.3 Marcador `omitted` no schedule POD

Reaproveita o padrão insert-only de `audit_logs` já usado para POD schedules
(igual ao `deleted=true` de exclusão de POD). Ao omitir, grava-se um evento
`entity_type='voyage_pod_schedule'`, `entity_id='<voyageId>::<POD>'`,
`field_name='omitted'`, `new_value='true'`. O leitor de schedules passa a expor
`omitted` por POD, análogo a `deleted`.

**Por que um marcador separado de `deleted`:** exclusão significa "POD nunca foi
real"; omissão significa "POD era real e confirmado, mas cancelado pelo armador,
com carga redirecionada". São semânticas distintas e disparam fluxos distintos.

## 4. Integração com derivações existentes (crítico)

Uma escala omitida **nunca recebe ATA/ATD**. Duas funções em
`src/services/voyageRouteSchedules.ts` precisam ignorar PODs omitidos:

1. `getProximaEscala` (menor ETA entre PODs sem ATA) — sem tratamento,
   apontaria eternamente para o porto omitido. Deve **excluir** PODs `omitted`.
2. `syncVoyageStatusAfterAtdChange` (marca `completed` só quando **todos** os
   PODs ativos têm ATD) — sem tratamento, a viagem nunca concluiria. Deve
   tratar POD `omitted` como **não pendente** (equivalente a ter ATD para fins
   de conclusão).

Ambas já ignoram PODs `deleted`; o mesmo ponto de leitura passa a ignorar
`omitted`. Os filtros de rail/período (`src/lib/viagensFilters.ts`) herdam o
comportamento via `getProximaEscala`.

## 5. Fluxo operacional

```
1. Operador abre a Viagem → aba Visão geral → aciona "Omitir escala" num POD.
   verify: modal lista PODs ativos da viagem como destino de descarga.
2. Confirma POD omitido + porto de descarga + motivo.
   → grava voyage_omissions, marca omitted=true no schedule POD.
   → cria bl_transshipments (disposition='transshipment') para cada B/L do POD.
   verify: POD some da "próxima escala"; B/Ls do POD ganham registro de transbordo.
3. Operador preenche a referência do navio de terceiros por B/L (ou em lote).
   verify: onward_* salvos; auditados no Histórico do B/L.
4. Exceções COD: operador marca B/Ls específicos como COD.
   → disposition='cod'; bls.pod/place_of_delivery reescritos para discharge_pod
     (auditado); onward_* limpos.
   verify: POD do B/L reflete o novo destino; evento COD no Histórico.
5. Sistema emite portal_notifications por B/L afetado (transbordo ou COD).
   verify: notificação aparece no sino do Portal do cliente dono do B/L.
```

## 6. COD (Change of Destination)

COD é uma **disposição** do mesmo registro `bl_transshipments`, não uma entidade
separada. Efeito adicional: o POD do B/L (`bls.pod` e, quando aplicável,
`bls.place_of_delivery`) é reescrito para o `discharge_pod`, com evento de
auditoria (quem, de qual valor para qual, motivo `COD — escala <X> omitida`).
Reverter COD para transbordo restaura a disposição e limpa o POD reescrito via
novo evento auditado (o histórico preserva ambos).

## 7. Portal do Cliente

O Portal não possui timeline de B/L. A tradução mínima de "timeline do evento"
é uma entrada em **`portal_notifications`** (reusa `NotificationBell`, polling
de 30 s e escopo por cliente). Introduz-se um `type` novo (ex.: `transshipment`)
com mensagens distintas:

- Transbordo: "Escala de <omitted_pod> omitida. Sua carga do B/L <n> foi
  descarregada em <discharge_pod> e seguirá em transbordo para <destino>."
- COD: "A pedido, o destino final do B/L <n> foi alterado para <discharge_pod>
  (COD), após a omissão da escala de <omitted_pod>."

Sem badge no B/L e sem nova ETA no Portal nesta entrega (decisão de escopo).

## 8. Auditoria e timeline interna

- **Histórico do B/L:** eventos de omissão, definição de transbordo, mudança de
  disposição e COD entram como eventos do Histórico; os deliberados com
  justificativa (COD, motivo da omissão) contam como Auditoria.
- **Timeline da Viagem** (`src/services/voyageTimeline.ts`): passa a incluir o
  evento de omissão de escala (fonte `audit_logs` do marcador `omitted` +
  `voyage_omissions`). Mantém-se não financeira.

## 9. Invariantes

1. `discharge_pod` deve ser um POD ativo (não omitido, não deletado) da mesma
   viagem.
2. Todo B/L com POD igual ao `omitted_pod` de uma omissão ativa tem exatamente
   um `bl_transshipments` para aquela omissão.
3. `disposition='cod'` ⇒ `onward_*` nulos **e** `bls.pod = discharge_pod`.
4. `disposition='transshipment'` ⇒ `bls.pod` permanece o destino original.
5. POD `omitted` é excluído de `getProximaEscala` e tratado como não pendente na
   conclusão da viagem.
6. Registrar o evento **não** altera CE Mercante, taxas locais nem demurrage
   (financeiro manual).

## 10. Testes e verificação (alvo)

- Unit: `getProximaEscala` ignora POD omitido; `syncVoyageStatusAfterAtdChange`
  conclui viagem com POD omitido presente.
- Unit: criação de omissão gera um `bl_transshipments` por B/L do POD.
- Unit: alternar disposição transbordo↔COD reescreve/restaura `bls.pod` e mantém
  invariantes 3–4.
- Contrato SQL: RLS/grants das tabelas novas; unicidade e CHECKs.
- Verificação em runtime do fluxo 1–5 quando a implementação existir.

## 11. Impacto em documentação viva (contrato)

Atualizar na mesma mudança de implementação:

- `CONTEXT.md`: termos **Omissão de Escala**, **Transbordo**, **COD**, **Porto
  de Descarga**.
- `docs/modules/viagens.md`: catálogo de ações (omitir escala, definir
  transbordo, marcar COD) e invariantes; nota sobre `getProximaEscala`/conclusão.
- `docs/modules/portal-cliente.md`: novo `type` de `portal_notifications`.
- `docs/RASTREABILIDADE.md`: rota/ação → componentes/serviços/tabelas novas.
- Novo **ADR**: decisão de registro operacional com financeiro manual, navio de
  transbordo como referência leve, e omissão distinta de exclusão de POD.
- `docs/spec/*-behavioral-spec.csv`: linhas do novo comportamento.

## 12. Decisões registradas (deste brainstorming)

- Objetivo: **registrar o evento operacional**; financeiro manual.
- Navio de transbordo: **referência leve** (não é Viagem completa).
- Conjunto afetado: **derivado da escala**; disposição **por B/L**.
- Disposição padrão: **Transbordo**; **COD** é exceção marcada pelo operador.
- Portal: **timeline do evento** via `portal_notifications`.
