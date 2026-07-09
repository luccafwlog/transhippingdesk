# Plan 04: Portal projeta a Viagem (RPC `portal_ship_schedule` + widget)

> **Executor instructions**: Follow step by step. Run every verification. Honor
> STOP conditions. Update the status row in `../README.md` when done.
>
> **Drift check (run first)**:
> `git log --oneline -3 -- src/components/portal/ShipScheduleWidget.tsx src/services/vesselSchedules.ts`
>
> **SECURITY BOUNDARY**: esta é a mudança sensível. O Portal usa o cliente
> `anon` (`supabasePortal`). Em vez de conceder `voyages`/`audit_logs` ao `anon`,
> exponha os dados projetados por uma **RPC `SECURITY DEFINER`** allowlisted,
> seguindo ADR 0004 (RLS/RPC como fronteira), 0011 (default-deny `anon`) e 0013
> (exceção `anon` limitada). Consulte a skill `supabase-migration`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED-HIGH (fronteira de segurança do Portal)
- **Depends on**: 01, 02
- **Category**: feature (ADR 0021)

## Why this matters

O quadro do cliente deixa de ler `vessel_schedules` e passa a projetar as
viagens visíveis (`show_on_portal`), ordenadas por ETA, saindo sozinhas quando
`completed`. Sem duas fontes, sem divergência.

## Current state

- `ShipScheduleWidget.tsx` lê via `useVesselSchedules` →
  `listVesselSchedules()` (`src/services/vesselSchedules.ts:4-16`), que faz
  `supabasePortal.from('vessel_schedules').select('*')`.
- Padrão de RPC do Portal já existe: `portalListOperationBls()` chama
  `supabasePortal.rpc('portal_list_operation_bls')` (`portalOperation.ts:106-112`).

## Tasks

### Task 1: RPC `portal_ship_schedule` (SECURITY DEFINER)

**Files:**
- Create: `supabase/migrations/172_portal_ship_schedule.sql`
- Test: `src/services/__tests__/portalShipScheduleMigration.test.ts`

- [ ] **Step 1: Teste de contrato (falha)**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('define portal_ship_schedule como definer allowlisted a anon', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations')
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')

  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.portal_ship_schedule/i)
  expect(sql).toMatch(/SECURITY DEFINER/i)
  expect(sql).toMatch(/SET search_path = public, pg_temp/i)
  // só viagens visíveis e ativas
  expect(sql).toMatch(/show_on_portal/i)
  expect(sql).toMatch(/status\s*=\s*'active'/i)
  // fronteira: revoga geral e concede execução ao Portal
  expect(sql).toMatch(/REVOKE\s+ALL[\s\S]*portal_ship_schedule[\s\S]*FROM\s+PUBLIC/i)
  expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.portal_ship_schedule[\s\S]*TO\s+anon/i)
})
```

- [ ] **Step 2: Rodar (falha)** — `npx vitest run src/services/__tests__/portalShipScheduleMigration.test.ts`

- [ ] **Step 3: Escrever a migração**

A RPC devolve **uma linha por viagem visível**, com o navio, VOY, IMO e a data
por code de porto (ETD para POL, ETA para POD). Os schedules vivem em
`audit_logs` (event-sourced); pegamos o valor mais recente por
`(entity_id, field_name)`.

`supabase/migrations/172_portal_ship_schedule.sql`:

```sql
-- ADR 0021: o Portal projeta as viagens visíveis em vez de ler vessel_schedules.
-- Definer + allowlist a anon (ADR 0004/0011/0013): nenhuma tabela nova é
-- concedida ao Portal; só esta função.
CREATE OR REPLACE FUNCTION public.portal_ship_schedule()
RETURNS TABLE (
  voyage_id   bigint,
  vessel_name text,
  voyage      text,
  imo_number  text,
  port_code   text,
  kind        text,      -- 'pol' | 'pod'
  date_value  text       -- ISO (YYYY-MM-DD) ou date texto guardada
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    SELECT v.id, ve.name AS vessel_name, v.voyage_number, ve.imo
    FROM public.voyages v
    JOIN public.vessels ve ON ve.id = v.vessel_id
    WHERE v.show_on_portal AND v.status = 'active'
  ),
  -- último valor por (entity_id, field_name) dos schedules de rota
  latest AS (
    SELECT DISTINCT ON (a.entity_id, a.field_name)
      a.entity_type, a.entity_id, a.field_name, a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY a.entity_id, a.field_name, a.changed_at DESC
  ),
  pol AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code, new_value AS etd
    FROM latest WHERE entity_type = 'voyage_pol_schedule' AND field_name = 'etd'
      AND new_value IS NOT NULL
  ),
  pod AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code, new_value AS eta
    FROM latest WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'eta'
      AND new_value IS NOT NULL
      -- excluir PODs soft-deleted
      AND NOT EXISTS (
        SELECT 1 FROM latest d
        WHERE d.entity_type = 'voyage_pod_schedule' AND d.entity_id = latest.entity_id
          AND d.field_name = 'deleted' AND d.new_value = 'true'
      )
  )
  SELECT vis.id, vis.vessel_name, vis.voyage_number, vis.imo,
         pol.port_code, 'pol', pol.etd
  FROM visible vis JOIN pol ON pol.vid = vis.id
  UNION ALL
  SELECT vis.id, vis.vessel_name, vis.voyage_number, vis.imo,
         pod.port_code, 'pod', pod.eta
  FROM visible vis JOIN pod ON pod.vid = vis.id;
$$;

REVOKE ALL ON FUNCTION public.portal_ship_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO anon, authenticated;
```

> Nota sobre a correlação do `deleted` na CTE `pod`: se o dialeto não permitir
> referenciar `latest` no `NOT EXISTS` como acima, materialize os `deleted` numa
> CTE própria e faça `LEFT JOIN ... WHERE deleted IS NULL`. Valide com
> `EXPLAIN`/execução real no Step 4.

- [ ] **Step 4: Aplicar e validar** contra o banco (MCP Supabase). Insira uma
  viagem visível de teste com um POL e um POD e confirme que
  `select * from portal_ship_schedule();` como `anon` retorna as linhas.
  Expected: linhas pol/pod corretas; viagem `completed` ou `show_on_portal=false`
  não aparece.

- [ ] **Step 5: Rodar teste de contrato (passa)**

- [ ] **Step 6: Commit** — `git commit -m "feat(portal): RPC portal_ship_schedule projeta viagens visíveis (ADR 0021)"`

### Task 2: Serviço + projeção em linhas do widget

**Files:**
- Create: `src/services/portalScheduleVoyages.ts`
- Test: `src/services/__tests__/portalScheduleVoyages.test.ts`

- [ ] **Step 1: Teste que falha** (projeção pura: RPC rows → linhas por lane,
  ordenadas por ETA)

```ts
import { describe, expect, it } from 'vitest'
import { projectPortalScheduleRows, type PortalScheduleRpcRow } from '../portalScheduleVoyages'

describe('projectPortalScheduleRows', () => {
  const rows: PortalScheduleRpcRow[] = [
    { voyage_id: 2, vessel_name: 'B', voyage: '2', imo_number: null, port_code: 'BRSSA', kind: 'pod', date_value: '2026-02-01' },
    { voyage_id: 1, vessel_name: 'A', voyage: '1', imo_number: '900', port_code: 'CNTAO', kind: 'pol', date_value: '2026-01-04' },
    { voyage_id: 1, vessel_name: 'A', voyage: '1', imo_number: '900', port_code: 'BRSSA', kind: 'pod', date_value: '2026-01-22' },
  ]

  it('agrupa por viagem, indexa data por lane e ordena por ETA mais próxima', () => {
    const out = projectPortalScheduleRows(rows)
    expect(out.map((v) => v.voyageId)).toEqual([1, 2]) // ETA 01-22 antes de 02-01
    expect(out[0].datesByLabel['QINGDAO']).toBe('2026-01-04')
    expect(out[0].datesByLabel['SALVADOR']).toBe('2026-01-22')
    expect(out[0].datesByLabel['VITÓRIA']).toBeUndefined() // não escala
  })
})
```

- [ ] **Step 2: Rodar (falha)**

- [ ] **Step 3: Implementar** (`portalScheduleVoyages.ts`): mapeia
  `port_code → label` via `PORTAL_SCHEDULE_LANES`+`portalLaneCode`, agrupa por
  `voyage_id`, calcula a menor ETA (POD) da viagem para ordenar, e expõe
  `fetchPortalScheduleVoyages()` que chama
  `supabasePortal.rpc('portal_ship_schedule')` e passa por
  `projectPortalScheduleRows`.

```ts
import { supabasePortal } from './supabase'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from './portalScheduleLanes'

export type PortalScheduleRpcRow = {
  voyage_id: number; vessel_name: string; voyage: string; imo_number: string | null
  port_code: string; kind: 'pol' | 'pod'; date_value: string | null
}
export type PortalScheduleVoyage = {
  voyageId: number; vesselName: string; voyage: string; imoNumber: string | null
  datesByLabel: Record<string, string>; earliestEta: string | null
}

const LABEL_BY_CODE = new Map(PORTAL_SCHEDULE_LANES.map((l) => [portalLaneCode(l), l.label]))

export function projectPortalScheduleRows(rows: PortalScheduleRpcRow[]): PortalScheduleVoyage[] {
  const byVoyage = new Map<number, PortalScheduleVoyage>()
  for (const r of rows) {
    const v = byVoyage.get(r.voyage_id) ?? {
      voyageId: r.voyage_id, vesselName: r.vessel_name, voyage: r.voyage,
      imoNumber: r.imo_number, datesByLabel: {}, earliestEta: null,
    }
    const label = LABEL_BY_CODE.get(r.port_code)
    if (label && r.date_value) {
      v.datesByLabel[label] = r.date_value
      if (r.kind === 'pod' && (v.earliestEta === null || r.date_value < v.earliestEta)) {
        v.earliestEta = r.date_value
      }
    }
    byVoyage.set(r.voyage_id, v)
  }
  return Array.from(byVoyage.values()).sort((a, b) => {
    if (a.earliestEta && b.earliestEta) return a.earliestEta < b.earliestEta ? -1 : a.earliestEta > b.earliestEta ? 1 : 0
    if (a.earliestEta) return -1
    if (b.earliestEta) return 1
    return a.voyage.localeCompare(b.voyage, 'pt-BR')
  })
}

export async function fetchPortalScheduleVoyages(): Promise<PortalScheduleVoyage[]> {
  const { data, error } = await supabasePortal.rpc('portal_ship_schedule')
  if (error) throw error
  return projectPortalScheduleRows((data ?? []) as PortalScheduleRpcRow[])
}
```

- [ ] **Step 4: Rodar (passa)**

- [ ] **Step 5: Commit** — `git commit -m "feat(portal): projeção das viagens visíveis em linhas do quadro"`

### Task 3: Reapontar o widget

**Files:**
- Modify: `src/components/portal/ShipScheduleWidget.tsx`
- Modify: `src/hooks/useVesselSchedules.ts` (ou criar `usePortalScheduleVoyages`)

- [ ] **Step 1**: Criar `usePortalScheduleVoyages` (mesma forma de
  `useVesselSchedules.ts`, `queryKey: ['portal-schedule-voyages']`,
  `queryFn: fetchPortalScheduleVoyages`). O realtime channel de `vessel_schedules`
  (`ShipScheduleWidget.tsx:46-53`) pode ser removido (voyages não emite pelo mesmo
  canal); invalidar via refetch/`staleTime` é suficiente — ou assine
  `postgres_changes` em `voyages` filtrando `show_on_portal`.

- [ ] **Step 2**: Renderizar as colunas a partir de `PORTAL_SCHEDULE_LANES`
  (substitui os `<th>` hardcoded de `ShipScheduleWidget.tsx:91-124` e as
  `<DateCell>` de 149-166). Cada célula: `voyage.datesByLabel[lane.label]` ou
  o marcador de "não escala" (`—`/`X`). `parseDate` local passa a receber ISO
  (`new Date(value)`); a lógica "data no passado" continua.

- [ ] **Step 3**: Ajustar o teste
  `src/components/portal/__tests__/ShipScheduleWidget.test.tsx` para o novo hook/
  shape. Rode: `npx vitest run src/components/portal/__tests__/ShipScheduleWidget.test.tsx`.

- [ ] **Step 4: Commit** — `git commit -m "feat(portal): widget projeta viagens (colunas via constante, ordena por ETA)"`

## Docs to update

- `docs/ARCHITECTURE.md` / `docs/RASTREABILIDADE.md`: o widget do Portal e a RPC
  `portal_ship_schedule` como novo caminho de leitura.
- Rodar `npm run docs:check`.

## STOP conditions

- A CTE `pod`/`deleted` não valida no banco real (Step 4 da Task 1) — refatore
  conforme a nota e revalide antes de seguir.
- Conceder `anon` à RPC dispara alerta do `get_advisors` de segurança — revise
  com a skill `supabase-migration`; a função não deve retornar dado de viagem
  não-visível.
