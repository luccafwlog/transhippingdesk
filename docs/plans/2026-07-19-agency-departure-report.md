# Agency Departure Report — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o ADR (Agency Departure Report) — relatório por escala brasileira com exibição derivada, sign-off departamental e fechamento com snapshot — conforme a spec `docs/spec/2026-07-19-agency-departure-report-design.md` e a ADR 0027.

**Architecture:** Agregado `agency_departure_reports` ancorado em `(voyage_id, port)`; dados derivados dos módulos donos (projeção de escala, B/Ls, granito, veículos, vazios); dados próprios apenas para terminal, sign-offs, ocorrências e snapshot de fechamento. VAZIOS EXP é estendido (colunas por container + operação da escala + serviços de reorganização). Novo papel RBAC `equipamentos`.

**Tech Stack:** React SPA + TanStack Query, Supabase (migrations SQL numeradas, RLS, RPCs `SECURITY DEFINER`), Vitest, `@e965/xlsx`.

**Regras transversais:**

- Migrations numeradas sequenciais (ADR 0016). Este plano usa 205–209; se outro trabalho ocupar um número, use o próximo livre e ajuste as referências.
- `src/types/database.ts` é arquivo **protegido** (CLAUDE.md): as tasks que o alteram exigem autorização explícita do usuário antes do edit — peça antes de executar.
- Nunca usar `adr` em schema/código: prefixo completo `agency_departure_report_` (CONTEXT.md).
- Cada task termina com commit. Rodar `npm test` (Vitest) no escopo indicado; antes do push final: `npm run docs:check && npm run lint && npm test && npm run build`.

---

## Parte 1 — Fundações: Vazios EXP estendido + papel Equipamentos

### Task 1: Migration 205 — colunas novas por container

**Files:**
- Create: `supabase/migrations/205_vazios_adr_container_fields.sql`
- Test: `src/services/__tests__/vaziosAdrFieldsMigration.test.ts`

- [ ] **Step 1: Escrever a migration**

```sql
-- Vazios/ADR: campos por container exigidos pelo Agency Departure Report.
-- Intent: o ADR (spec 2026-07-19) deriva embarque de vazios, depot, overtime,
--   material, bundles, hand-in/hand-out e storage de dados por container que
--   hoje nao existem. Vazios descarregados ganham natureza (cama/cover plate)
--   e containers com veiculo ganham local de desova.
-- Escopo: aditivo — colunas novas anulaveis; RPC de import reescrita para
--   aceitar os campos novos (assinatura inalterada: p_bookings JSONB).
-- Rollback: DROP COLUMN das colunas adicionadas e reaplicar a definicao da
--   funcao de 146_import_vazios_transactional.sql.

ALTER TABLE public.vazios_bookings
  ADD COLUMN IF NOT EXISTS embark_port TEXT,
  ADD COLUMN IF NOT EXISTS depot TEXT,
  ADD COLUMN IF NOT EXISTS material BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bundle BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transporte BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hand_in_date DATE,
  ADD COLUMN IF NOT EXISTS hand_out_date DATE,
  ADD COLUMN IF NOT EXISTS overtime_handling BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overtime_transport BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vazios_bookings_embark_port
  ON public.vazios_bookings(embark_port);

ALTER TABLE public.vazios_importacao_containers
  ADD COLUMN IF NOT EXISTS natureza TEXT
    CHECK (natureza IS NULL OR natureza IN ('cama', 'cover_plate'));

ALTER TABLE public.bl_containers
  ADD COLUMN IF NOT EXISTS unpacking_location TEXT;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional(
  p_voyage_id BIGINT,
  p_description TEXT,
  p_uploaded_by UUID,
  p_bookings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_manifest_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa para importar bookings.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_description, jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB)), p_uploaded_by)
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_bookings (
    manifest_id, booking_number, container_number, container_type,
    movement_date, origin_terminal, destination, notes,
    embark_port, depot, material, bundle, transporte,
    hand_in_date, hand_out_date, overtime_handling, overtime_transport
  )
  SELECT
    v_manifest_id, item.booking_number, item.container_number, item.container_type,
    item.movement_date, item.origin_terminal, item.destination, item.notes,
    item.embark_port, item.depot, COALESCE(item.material, FALSE),
    COALESCE(item.bundle, FALSE), COALESCE(item.transporte, FALSE),
    item.hand_in_date, item.hand_out_date,
    COALESCE(item.overtime_handling, FALSE), COALESCE(item.overtime_transport, FALSE)
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(
    booking_number TEXT,
    container_number TEXT,
    container_type TEXT,
    movement_date DATE,
    origin_terminal TEXT,
    destination TEXT,
    notes TEXT,
    embark_port TEXT,
    depot TEXT,
    material BOOLEAN,
    bundle BOOLEAN,
    transporte BOOLEAN,
    hand_in_date DATE,
    hand_out_date DATE,
    overtime_handling BOOLEAN,
    overtime_transport BOOLEAN
  );

  RETURN jsonb_build_object('manifest_id', v_manifest_id);
END;
$function$;
```

- [ ] **Step 2: Escrever o teste de contrato SQL (padrão `vaziosImportsAtomic.test.ts`)**

```ts
// src/services/__tests__/vaziosAdrFieldsMigration.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/205_vazios_adr_container_fields.sql'),
  'utf-8',
)

describe('migration 205 — campos ADR por container', () => {
  it('adiciona os campos novos de vazios_bookings', () => {
    for (const col of [
      'embark_port', 'depot', 'material', 'bundle', 'transporte',
      'hand_in_date', 'hand_out_date', 'overtime_handling', 'overtime_transport',
    ]) {
      expect(sql).toContain(col)
    }
  })

  it('restringe natureza de vazios descarregados a cama/cover_plate', () => {
    expect(sql).toMatch(/natureza IN \('cama', 'cover_plate'\)/)
  })

  it('reescreve a RPC de import repassando os campos novos', () => {
    expect(sql).toContain('import_vazios_bookings_transactional')
    expect(sql).toMatch(/INSERT INTO public\.vazios_bookings[\s\S]*overtime_transport/)
  })
})
```

- [ ] **Step 3: Rodar o teste**

Run: `npx vitest run src/services/__tests__/vaziosAdrFieldsMigration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/205_vazios_adr_container_fields.sql src/services/__tests__/vaziosAdrFieldsMigration.test.ts
git commit -m "feat(vazios): campos por container para o ADR (migration 205)"
```

### Task 2: Migration 206 — operação de vazios da escala, overtime por depot e serviços de reorganização

**Files:**
- Create: `supabase/migrations/206_vazios_export_operations.sql`
- Test: `src/services/__tests__/vaziosExportOperationsMigration.test.ts`

- [ ] **Step 1: Escrever a migration**

```sql
-- Vazios/ADR: operacao de vazios da escala, overtime por depot e servicos
-- extra de reorganizacao (spec 2026-07-19, blocos EMBARQUE CONTAINER VAZIO,
-- OVER TIME e SERVICO EXTRA do modelo real).
-- Intent: OS por (viagem, porto); % de overtime aplicado por depot (as
--   quantidades derivam das flags por container da migration 205); servicos
--   bundle/desova/visual_check com qty por tipo x tarifa configuravel
--   (mesmo padrao de granite_rates — tarifas nunca fixas em codigo).
-- Rollback: DROP TABLE das quatro tabelas.

CREATE TABLE IF NOT EXISTS public.vazios_export_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  embark_port TEXT NOT NULL,
  os_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, embark_port)
);

CREATE TABLE IF NOT EXISTS public.vazios_export_overtime_depots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  depot TEXT NOT NULL,
  percent NUMERIC(5,2) NOT NULL CHECK (percent >= 0),
  UNIQUE (operation_id, depot)
);

CREATE TABLE IF NOT EXISTS public.vazios_reorg_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.vazios_export_operations(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('bundle', 'desova', 'visual_check')),
  container_type TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  UNIQUE (operation_id, service, container_type)
);

CREATE TABLE IF NOT EXISTS public.vazios_reorg_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL CHECK (service IN ('bundle', 'desova', 'visual_check')),
  rate_brl NUMERIC(10,2) NOT NULL CHECK (rate_brl >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vazios_export_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_export_overtime_depots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_reorg_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vazios_reorg_rates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vazios_export_operations', 'vazios_export_overtime_depots',
    'vazios_reorg_services', 'vazios_reorg_rates'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (public.is_active_user())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())', t, t);
  END LOOP;
END $$;
```

- [ ] **Step 2: Teste de contrato**

```ts
// src/services/__tests__/vaziosExportOperationsMigration.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/206_vazios_export_operations.sql'),
  'utf-8',
)

describe('migration 206 — operacao de vazios da escala', () => {
  it('cria as quatro tabelas com RLS', () => {
    for (const t of [
      'vazios_export_operations', 'vazios_export_overtime_depots',
      'vazios_reorg_services', 'vazios_reorg_rates',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`)
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
    }
  })

  it('garante unicidade da operacao por (viagem, porto)', () => {
    expect(sql).toContain('UNIQUE (voyage_id, embark_port)')
  })

  it('restringe servicos aos tres tipos com tarifa configuravel', () => {
    expect(sql).toMatch(/service IN \('bundle', 'desova', 'visual_check'\)/)
    expect(sql).toContain('rate_brl')
  })
})
```

- [ ] **Step 3: Rodar o teste**

Run: `npx vitest run src/services/__tests__/vaziosExportOperationsMigration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/206_vazios_export_operations.sql src/services/__tests__/vaziosExportOperationsMigration.test.ts
git commit -m "feat(vazios): operacao da escala, overtime por depot e reorganizacao (migration 206)"
```

### Task 3: Migration 207 — papel `equipamentos`

**Files:**
- Create: `supabase/migrations/207_role_equipamentos.sql`

- [ ] **Step 1: Escrever a migration**

O constraint atual vem da migration `040_portal_login_rate_limit.sql`.

```sql
-- RBAC: papel Equipamentos (spec ADR 2026-07-19; CONTEXT.md "Escopo de
-- Equipamentos" — escrita em VAZIOS EXP e Veiculos, sign-off das suas secoes).
-- Intent: o sign-off departamental do Agency Departure Report exige o papel;
--   a autoridade fina por secao fica nas RPCs da migration 208.
-- Rollback: reaplicar o constraint de 040 sem 'equipamentos' (apenas se nao
--   houver usuarios com o papel).

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('admin', 'operator', 'administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos'));
```

- [ ] **Step 2: Atualizar `UserProfileRole`** *(arquivo protegido — pedir autorização explícita antes de editar `src/types/database.ts`)*

Em `src/types/database.ts:10`:

```ts
export type UserProfileRole = 'admin' | 'operator' | 'administrativo' | 'financeiro' | 'operacoes' | 'documentacao' | 'equipamentos'
```

- [ ] **Step 3: Teste primeiro — permissões do papel (RED)**

Adicionar ao `src/hooks/__tests__/roleHasPermission.test.ts`:

```ts
describe('papel equipamentos', () => {
  it('edita vazios e veiculos, mas nao faturamento nem clientes', () => {
    expect(roleHasPermission('equipamentos', 'vazios_edit')).toBe(true)
    expect(roleHasPermission('equipamentos', 'veiculos_edit')).toBe(true)
    expect(roleHasPermission('equipamentos', 'faturamento_edit')).toBe(false)
    expect(roleHasPermission('equipamentos', 'customers_edit')).toBe(false)
  })

  it('documentacao e administrativo tambem editam vazios e veiculos', () => {
    expect(roleHasPermission('documentacao', 'vazios_edit')).toBe(true)
    expect(roleHasPermission('administrativo', 'veiculos_edit')).toBe(true)
  })
})
```

Run: `npx vitest run src/hooks/__tests__/roleHasPermission.test.ts`
Expected: FAIL (permissões `vazios_edit`/`veiculos_edit` não existem)

- [ ] **Step 4: Implementar em `src/hooks/useAuth.tsx`**

Adicionar à union `Permission` (linha 8):

```ts
  | 'vazios_edit'
  | 'veiculos_edit'
```

No `switch` de `roleHasPermission` (linha 27):

```ts
    case 'equipamentos':
      return permission === 'vazios_edit' || permission === 'veiculos_edit'
```

E incluir `'vazios_edit', 'veiculos_edit'` no array do case `documentacao`.

- [ ] **Step 5: Rodar o teste**

Run: `npx vitest run src/hooks/__tests__/roleHasPermission.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/207_role_equipamentos.sql src/types/database.ts src/hooks/useAuth.tsx src/hooks/__tests__/roleHasPermission.test.ts
git commit -m "feat(rbac): papel equipamentos com escopo de vazios e veiculos (migration 207)"
```

### Task 4: Tipos das tabelas novas e colunas estendidas

**Files:**
- Modify: `src/types/database.ts` *(protegido — pedir autorização explícita)*

- [ ] **Step 1: Estender `VaziosBooking` (linha ~1568) e `VaziosImportacaoContainer` (linha ~1602)**

```ts
export type VaziosBooking = {
  id: string
  manifest_id: string
  booking_number: string
  container_number: string | null
  container_type: string | null
  movement_date: string | null
  origin_terminal: string | null
  destination: string | null
  notes: string | null
  embark_port: string | null
  depot: string | null
  material: boolean
  bundle: boolean
  transporte: boolean
  hand_in_date: string | null
  hand_out_date: string | null
  overtime_handling: boolean
  overtime_transport: boolean
  created_at: string | null
}
```

Em `VaziosImportacaoContainer`, adicionar após `pod`:

```ts
  natureza: 'cama' | 'cover_plate' | null
```

Em `BLContainer` (localizar `export type BLContainer`), adicionar:

```ts
  unpacking_location: string | null
```

- [ ] **Step 2: Adicionar os tipos novos (após o bloco Vazios)**

```ts
export type VaziosExportOperation = {
  id: string
  voyage_id: number
  embark_port: string
  os_number: string | null
  created_at: string
  updated_at: string
}

export type VaziosExportOvertimeDepot = {
  id: string
  operation_id: string
  depot: string
  percent: number
}

export type VaziosReorgServiceType = 'bundle' | 'desova' | 'visual_check'

export type VaziosReorgService = {
  id: string
  operation_id: string
  service: VaziosReorgServiceType
  container_type: string
  qty: number
}

export type VaziosReorgRate = {
  id: string
  service: VaziosReorgServiceType
  rate_brl: number
  active: boolean
  valid_from: string
  valid_to: string | null
  created_at: string
}
```

E registrar no mapa `Tables` (linha ~614, junto de `vazios_bookings`):

```ts
      vazios_export_operations: Row<VaziosExportOperation>
      vazios_export_overtime_depots: Row<VaziosExportOvertimeDepot>
      vazios_reorg_services: Row<VaziosReorgService>
      vazios_reorg_rates: Row<VaziosReorgRate>
```

- [ ] **Step 3: Typecheck e commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: sem erros

```bash
git add src/types/database.ts
git commit -m "feat(types): tabelas e colunas do modulo de vazios para o ADR"
```

### Task 5: Parser e import de vazios com as colunas novas

**Files:**
- Modify: `src/services/vaziosImport.ts`
- Test: `src/services/__tests__/vaziosImportAdrColumns.test.ts`

- [ ] **Step 1: Teste primeiro (RED)**

```ts
// src/services/__tests__/vaziosImportAdrColumns.test.ts
import { describe, expect, it } from 'vitest'
import { utils, write } from '@e965/xlsx'
import { parseVaziosManifestBuffer } from '../vaziosImport'

function sheetBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet(rows))
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parser de vazios — colunas do ADR', () => {
  it('mapeia porto, depot, flags e datas de hand-in/hand-out', async () => {
    const buffer = sheetBuffer([
      ['Booking', 'Container', 'Tipo', 'Porto Embarque', 'Depot', 'Material', 'Bundle', 'Transporte', 'Hand-in', 'Hand-out', 'OT Handling', 'OT Transporte'],
      ['BK1', 'ABCD1234567', '40HC', 'BRSSA', 'VBR', 'sim', '', 'sim', '01/07/2026', '05/07/2026', 'sim', ''],
    ])
    const parsed = await parseVaziosManifestBuffer(buffer)
    expect(parsed.bookings).toHaveLength(1)
    const b = parsed.bookings[0]
    expect(b.embark_port).toBe('BRSSA')
    expect(b.depot).toBe('VBR')
    expect(b.material).toBe(true)
    expect(b.bundle).toBe(false)
    expect(b.transporte).toBe(true)
    expect(b.hand_in_date).toBe('2026-07-01')
    expect(b.hand_out_date).toBe('2026-07-05')
    expect(b.overtime_handling).toBe(true)
    expect(b.overtime_transport).toBe(false)
  })

  it('planilha antiga (sem colunas novas) continua importando', async () => {
    const buffer = sheetBuffer([
      ['Booking', 'Container', 'Tipo'],
      ['BK2', 'ABCD1234568', '20GP'],
    ])
    const parsed = await parseVaziosManifestBuffer(buffer)
    expect(parsed.bookings[0].embark_port).toBeNull()
    expect(parsed.bookings[0].material).toBe(false)
  })
})
```

Run: `npx vitest run src/services/__tests__/vaziosImportAdrColumns.test.ts`
Expected: FAIL (`parseVaziosManifestBuffer` não exportado / campos ausentes)

- [ ] **Step 2: Implementar em `src/services/vaziosImport.ts`**

Exportar `parseVaziosManifestBuffer` (hoje é privada, linha 47). Adicionar ao `HEADER_MAP`:

```ts
  'porto embarque': 'embark_port',
  'porto': 'embark_port',
  'pol': 'embark_port',
  'depot': 'depot',
  'material': 'material',
  'bundle': 'bundle',
  'bundles': 'bundle',
  'transporte': 'transporte',
  'hand-in': 'hand_in_date',
  'hand in': 'hand_in_date',
  'hand-out': 'hand_out_date',
  'hand out': 'hand_out_date',
  'ot handling': 'overtime_handling',
  'overtime handling': 'overtime_handling',
  'ot transporte': 'overtime_transport',
  'overtime transporte': 'overtime_transport',
```

Estender `ParsedVaziosBooking`:

```ts
  embark_port: string | null
  depot: string | null
  material: boolean
  bundle: boolean
  transporte: boolean
  hand_in_date: string | null
  hand_out_date: string | null
  overtime_handling: boolean
  overtime_transport: boolean
```

No loop de parsing, após `notes`:

```ts
      embark_port: normalizePortCode(String(mapped['embark_port'] ?? '')) ?? null,
      depot: String(mapped['depot'] ?? '').trim() || null,
      material: parseBoolBR(mapped['material']),
      bundle: parseBoolBR(mapped['bundle']),
      transporte: parseBoolBR(mapped['transporte']),
      hand_in_date: parseDateBR(String(mapped['hand_in_date'] ?? '')),
      hand_out_date: parseDateBR(String(mapped['hand_out_date'] ?? '')),
      overtime_handling: parseBoolBR(mapped['overtime_handling']),
      overtime_transport: parseBoolBR(mapped['overtime_transport']),
```

Helper novo no mesmo arquivo (e import de `normalizePortCode` de `./portCode`):

```ts
function parseBoolBR(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'sim' || v === 's' || v === 'x' || v === 'true' || v === '1' || v === 'yes'
}
```

Em `importVaziosManifest`, repassar os campos novos no map de `bookings` (mesmos nomes).

- [ ] **Step 3: Rodar os testes do módulo**

Run: `npx vitest run src/services/__tests__/vaziosImportAdrColumns.test.ts src/services/__tests__/vaziosImportsAtomic.test.ts`
Expected: PASS

- [ ] **Step 4: Atualizar a planilha modelo**

Gerar `public/templates/vazios-modelo.xlsx` com o cabeçalho novo via script one-off (não commitá-lo):

```bash
node -e "
const XLSX = require('@e965/xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([[
  'Booking','Container','Tipo','Data Movimentação','Terminal Origem','Destino','Observações',
  'Porto Embarque','Depot','Material','Bundle','Transporte','Hand-in','Hand-out','OT Handling','OT Transporte'
]]);
XLSX.utils.book_append_sheet(wb, ws, 'Vazios');
XLSX.writeFile(wb, 'public/templates/vazios-modelo.xlsx');
"
```

- [ ] **Step 5: Commit**

```bash
git add src/services/vaziosImport.ts src/services/__tests__/vaziosImportAdrColumns.test.ts public/templates/vazios-modelo.xlsx
git commit -m "feat(vazios): parser e template com colunas do ADR"
```

### Task 6: Serviço da operação de vazios e edição inline

**Files:**
- Create: `src/services/vaziosExportOperations.ts`
- Modify: `src/pages/EmbarqueVazios.tsx`
- Test: `src/services/__tests__/vaziosExportOperations.test.ts`

- [ ] **Step 1: Teste do helper puro de storage (RED)**

```ts
// src/services/__tests__/vaziosExportOperations.test.ts
import { describe, expect, it } from 'vitest'
import { computeStorageTotals } from '../vaziosExportOperations'

describe('computeStorageTotals', () => {
  it('soma containers e dias derivados de hand-in/hand-out', () => {
    const totals = computeStorageTotals([
      { hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' }, // 4 dias
      { hand_in_date: '2026-07-02', hand_out_date: '2026-07-02' }, // 0 dias
      { hand_in_date: null, hand_out_date: null },                 // ignorado
    ])
    expect(totals).toEqual({ containers: 2, days: 4 })
  })
})
```

Run: `npx vitest run src/services/__tests__/vaziosExportOperations.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 2: Implementar `src/services/vaziosExportOperations.ts`**

```ts
import { supabase } from './supabase'
import type {
  VaziosBooking,
  VaziosExportOperation,
  VaziosExportOvertimeDepot,
  VaziosReorgRate,
  VaziosReorgService,
} from '../types/database'

export function computeStorageTotals(
  rows: Array<Pick<VaziosBooking, 'hand_in_date' | 'hand_out_date'>>,
): { containers: number; days: number } {
  let containers = 0
  let days = 0
  for (const row of rows) {
    if (!row.hand_in_date || !row.hand_out_date) continue
    const diff = Math.round(
      (Date.parse(row.hand_out_date) - Date.parse(row.hand_in_date)) / 86_400_000,
    )
    if (diff < 0) continue
    containers += 1
    days += diff
  }
  return { containers, days }
}

export async function updateVaziosBooking(
  id: string,
  patch: Partial<Pick<VaziosBooking,
    'embark_port' | 'depot' | 'material' | 'bundle' | 'transporte' |
    'hand_in_date' | 'hand_out_date' | 'overtime_handling' | 'overtime_transport'
  >>,
) {
  const { error } = await supabase.from('vazios_bookings').update(patch).eq('id', id)
  if (error) throw error
}

export async function getVaziosExportOperation(voyageId: number, embarkPort: string) {
  const { data, error } = await supabase
    .from('vazios_export_operations')
    .select('*, overtime:vazios_export_overtime_depots(*), reorg:vazios_reorg_services(*)')
    .eq('voyage_id', voyageId)
    .eq('embark_port', embarkPort)
    .maybeSingle()
  if (error) throw error
  return data as (VaziosExportOperation & {
    overtime: VaziosExportOvertimeDepot[]
    reorg: VaziosReorgService[]
  }) | null
}

export async function upsertVaziosExportOperation(input: {
  voyageId: number
  embarkPort: string
  osNumber: string | null
}) {
  const { data, error } = await supabase
    .from('vazios_export_operations')
    .upsert(
      {
        voyage_id: input.voyageId,
        embark_port: input.embarkPort,
        os_number: input.osNumber,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'voyage_id,embark_port' },
    )
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function upsertOvertimeDepot(input: {
  operationId: string
  depot: string
  percent: number
}) {
  const { error } = await supabase
    .from('vazios_export_overtime_depots')
    .upsert(
      { operation_id: input.operationId, depot: input.depot, percent: input.percent },
      { onConflict: 'operation_id,depot' },
    )
  if (error) throw error
}

export async function upsertReorgService(input: {
  operationId: string
  service: VaziosReorgService['service']
  containerType: string
  qty: number
}) {
  const { error } = await supabase
    .from('vazios_reorg_services')
    .upsert(
      {
        operation_id: input.operationId,
        service: input.service,
        container_type: input.containerType,
        qty: input.qty,
      },
      { onConflict: 'operation_id,service,container_type' },
    )
  if (error) throw error
}

export async function listActiveReorgRates(): Promise<VaziosReorgRate[]> {
  const { data, error } = await supabase
    .from('vazios_reorg_rates')
    .select('*')
    .eq('active', true)
  if (error) throw error
  return (data ?? []) as VaziosReorgRate[]
}
```

- [ ] **Step 3: Rodar o teste**

Run: `npx vitest run src/services/__tests__/vaziosExportOperations.test.ts`
Expected: PASS

- [ ] **Step 4: Edição inline em `src/pages/EmbarqueVazios.tsx`**

Na tabela existente, adicionar colunas: Porto, Depot, Material, Bundle, Transp., Hand-in, Hand-out, OT Hand., OT Transp. Cada célula editável abre em foco (padrão input/checkbox controlado) e salva no blur/change via `updateVaziosBooking`, invalidando `['vazios-bookings']`. Gate de escrita: `can('vazios_edit')` — sem a permissão as células são somente leitura. Acima da tabela, quando o filtro de viagem está ativo, renderizar um card "Operação da escala" com: select de porto (portos distintos de `embark_port` dos bookings + entrada livre), input OS (salva via `upsertVaziosExportOperation`), lista de overtime por depot (depot + % — `upsertOvertimeDepot`) e grade de serviços de reorganização (service × tipo × qty — `upsertReorgService`), exibindo valor = qty × tarifa de `listActiveReorgRates()`.

- [ ] **Step 5: Verificar manualmente e commitar**

Run: `npm run lint && npx vitest run src/pages src/services`
Expected: PASS

```bash
git add src/services/vaziosExportOperations.ts src/services/__tests__/vaziosExportOperations.test.ts src/pages/EmbarqueVazios.tsx
git commit -m "feat(vazios): edicao inline e operacao da escala no VAZIOS EXP"
```

### Task 7: Natureza dos vazios descarregados e local de desova dos veículos

**Files:**
- Modify: `src/pages/VaziosImportacao.tsx`, `src/pages/Veiculos.tsx`
- Create: `src/services/vaziosNatureza.ts`

- [ ] **Step 1: Serviço mínimo**

```ts
// src/services/vaziosNatureza.ts
import { supabase } from './supabase'

export async function setVazioImportacaoNatureza(
  id: string,
  natureza: 'cama' | 'cover_plate' | null,
) {
  const { error } = await supabase
    .from('vazios_importacao_containers')
    .update({ natureza })
    .eq('id', id)
  if (error) throw error
}

export async function setContainerUnpackingLocation(
  containerId: number,
  unpackingLocation: string | null,
) {
  const { error } = await supabase
    .from('bl_containers')
    .update({ unpacking_location: unpackingLocation })
    .eq('id', containerId)
  if (error) throw error
}
```

- [ ] **Step 2: UI**

Em `VaziosImportacao.tsx`: coluna "Natureza" com `Select` inline (`—`, `Cama`, `Cover plate`) chamando `setVazioImportacaoNatureza` e invalidando a query da lista. Em `Veiculos.tsx`: coluna "Local desova" com input inline por linha (o veículo referencia `container_id`) chamando `setContainerUnpackingLocation`; gate `can('veiculos_edit')`.

- [ ] **Step 3: Lint, teste e commit**

Run: `npm run lint && npx vitest run src/pages`
Expected: PASS

```bash
git add src/services/vaziosNatureza.ts src/pages/VaziosImportacao.tsx src/pages/Veiculos.tsx
git commit -m "feat(vazios): natureza cama/cover-plate e local de desova de veiculos"
```

---

## Parte 2 — Aba ADR (leitura derivada)

### Task 8: Serviço de agregação do ADR

**Files:**
- Create: `src/services/agencyDepartureReport.ts`
- Test: `src/services/__tests__/agencyDepartureReport.test.ts`

- [ ] **Step 1: Testes dos helpers puros (RED)**

```ts
// src/services/__tests__/agencyDepartureReport.test.ts
import { describe, expect, it } from 'vitest'
import {
  AGENCY_REPORT_SECTIONS,
  buildContainerTypeMatrix,
  groupVehiclesByBrand,
} from '../agencyDepartureReport'

describe('buildContainerTypeMatrix', () => {
  it('agrupa contagens por tipo e categoria', () => {
    const matrix = buildContainerTypeMatrix([
      { type: '40HC', category: 'carga_geral' },
      { type: '40HC', category: 'carga_geral' },
      { type: '40HC', category: 'imo' },
      { type: '20GP', category: 'veiculos' },
    ])
    expect(matrix.rows['40HC']).toEqual({ carga_geral: 2, imo: 1 })
    expect(matrix.rows['20GP']).toEqual({ veiculos: 1 })
    expect(matrix.totals).toEqual({ carga_geral: 2, imo: 1, veiculos: 1 })
  })
})

describe('groupVehiclesByBrand', () => {
  it('agrega marcas com qty de BLs distintos e chassis', () => {
    const grouped = groupVehiclesByBrand([
      { brand: 'BYD', bl_id: 'a', chassis: '1' },
      { brand: 'BYD', bl_id: 'a', chassis: '2' },
      { brand: 'BYD', bl_id: 'b', chassis: '3' },
      { brand: 'GWM', bl_id: 'c', chassis: '4' },
    ])
    expect(grouped).toEqual([
      { brand: 'BYD', blCount: 2, vinCount: 3 },
      { brand: 'GWM', blCount: 1, vinCount: 1 },
    ])
  })
})

describe('AGENCY_REPORT_SECTIONS', () => {
  it('mapeia as 7 secoes aos departamentos donos', () => {
    expect(AGENCY_REPORT_SECTIONS).toEqual({
      datas: 'operacoes',
      carga_descarregada: 'documentacao',
      carga_carregada: 'documentacao',
      veiculos: 'equipamentos',
      vazios_embarcados: 'equipamentos',
      vazios_descarregados: 'documentacao',
      ocorrencias: 'operacoes',
    })
  })
})
```

Run: `npx vitest run src/services/__tests__/agencyDepartureReport.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 2: Implementar helpers + agregador**

```ts
// src/services/agencyDepartureReport.ts
import { supabase } from './supabase'
import { listVoyagePodSchedules, buildVoyagePodEntityId } from './voyageRouteSchedules'
import { computeStorageTotals } from './vaziosExportOperations'
import type { UserProfileRole } from '../types/database'

export type AgencyReportSection =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'
  | 'ocorrencias'

export const AGENCY_REPORT_SECTIONS: Record<AgencyReportSection, UserProfileRole> = {
  datas: 'operacoes',
  carga_descarregada: 'documentacao',
  carga_carregada: 'documentacao',
  veiculos: 'equipamentos',
  vazios_embarcados: 'equipamentos',
  vazios_descarregados: 'documentacao',
  ocorrencias: 'operacoes',
}

export type MatrixCategory =
  | 'carga_geral' | 'veiculos' | 'transbordo' | 'imo'
  | 'vazio_cama' | 'vazio_cover_plate'

export function buildContainerTypeMatrix(
  items: Array<{ type: string; category: MatrixCategory | string }>,
) {
  const rows: Record<string, Record<string, number>> = {}
  const totals: Record<string, number> = {}
  for (const item of items) {
    const type = item.type || '—'
    rows[type] = rows[type] ?? {}
    rows[type][item.category] = (rows[type][item.category] ?? 0) + 1
    totals[item.category] = (totals[item.category] ?? 0) + 1
  }
  return { rows, totals }
}

export function groupVehiclesByBrand(
  vehicles: Array<{ brand: string; bl_id: string; chassis: string }>,
) {
  const byBrand = new Map<string, { bls: Set<string>; vins: Set<string> }>()
  for (const v of vehicles) {
    const entry = byBrand.get(v.brand) ?? { bls: new Set(), vins: new Set() }
    entry.bls.add(v.bl_id)
    entry.vins.add(v.chassis)
    byBrand.set(v.brand, entry)
  }
  return [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, e]) => ({ brand, blCount: e.bls.size, vinCount: e.vins.size }))
}

export async function getAgencyReportDerivedData(voyageId: number, port: string) {
  const entityId = buildVoyagePodEntityId(voyageId, port)
  const [schedules, vehiclesRes, vaziosExpRes, vaziosImpRes, graniteRes, containersRes] =
    await Promise.all([
      listVoyagePodSchedules([entityId]),
      supabase.from('vehicles').select('brand, bl_id, chassis, container_id').eq('voyage_id', voyageId),
      supabase
        .from('vazios_bookings')
        .select('*, manifest:vazios_manifests!inner(voyage_id)')
        .eq('manifest.voyage_id', voyageId)
        .eq('embark_port', port),
      supabase
        .from('vazios_importacao_containers')
        .select('container_type, natureza, pod, manifest:vazios_importacao_manifests!inner(voyage_id)')
        .eq('manifest.voyage_id', voyageId)
        .eq('pod', port),
      supabase
        .from('granite_bls')
        .select('real_weight_kg, blocks_qty, loading_port, manifest:granite_manifests!inner(voyage_id)')
        .eq('manifest.voyage_id', voyageId)
        .eq('loading_port', port),
      supabase
        .from('baplie_containers')
        .select('container_number, size_type, status, is_imo, pod')
        .eq('voyage_id', voyageId)
        .eq('pod', port),
    ])

  for (const res of [vehiclesRes, vaziosExpRes, vaziosImpRes, graniteRes, containersRes]) {
    if (res.error) throw res.error
  }

  const schedule = schedules.get(entityId) ?? null
  return {
    schedule,
    vehicles: vehiclesRes.data ?? [],
    vaziosExp: vaziosExpRes.data ?? [],
    vaziosImp: vaziosImpRes.data ?? [],
    granite: graniteRes.data ?? [],
    containers: containersRes.data ?? [],
    storage: computeStorageTotals((vaziosExpRes.data ?? []) as never),
  }
}
```

*(Nota: a categoria de cada container da matriz é derivada no componente: `veiculos` quando o container aparece em `vehicles.container_id`; `imo` quando `is_imo`; vazios importação usam `natureza`; o restante é `carga_geral`. Transbordo deriva do registro de omissão/transbordo — quando ausente, coluna zerada.)*

- [ ] **Step 3: Rodar os testes**

Run: `npx vitest run src/services/__tests__/agencyDepartureReport.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/agencyDepartureReport.ts src/services/__tests__/agencyDepartureReport.test.ts
git commit -m "feat(adr-report): servico de agregacao derivada por escala"
```

### Task 9: Aba ADR no detalhe da Viagem

**Files:**
- Create: `src/components/voyages/VoyageAgencyReportTab.tsx`
- Create: `src/hooks/useAgencyReport.ts`
- Modify: `src/components/voyages/VoyageCard.tsx:55,209,363`

- [ ] **Step 1: Hook**

```ts
// src/hooks/useAgencyReport.ts
import { useQuery } from '@tanstack/react-query'
import { getAgencyReportDerivedData } from '../services/agencyDepartureReport'

export function useAgencyReportDerived(voyageId: number, port: string | null) {
  return useQuery({
    queryKey: ['agency-report', voyageId, port],
    queryFn: () => getAgencyReportDerivedData(voyageId, port as string),
    enabled: Boolean(port),
  })
}
```

- [ ] **Step 2: Componente da aba (somente leitura nesta parte)**

`VoyageAgencyReportTab.tsx` recebe `{ voyageId, voyageLabel, pods }` (pods = escalas ativas não omitidas, mesmas do planejamento). Renderiza: seletor de escala (botões-chip por POD, estado em `useState` iniciado pelo primeiro POD ou pelo query param `escala`); cabeçalho (armador via vessel/carrier já presente no card, porto, ATA/ATB/ATD da projeção, restow = `rtw`); blocos por seção usando `buildContainerTypeMatrix`/`groupVehiclesByBrand`/`computeStorageTotals` sobre `useAgencyReportDerived`. Sem persistência própria nesta task.

- [ ] **Step 3: Registrar a aba em `VoyageCard.tsx`**

```ts
type VoyageTabKey = 'visao' | 'importacao' | 'exportacao' | 'manifestos' | 'adr'
```

No array de tabs (linha 209): `{ key: 'adr', label: 'ADR' }`. No corpo (após `manifestos`, linha ~363):

```tsx
{activeTab === 'adr' ? (
  <VoyageAgencyReportTab voyageId={voyage.id} voyageLabel={voyageLabel} pods={activePods} />
) : null}
```

*(`activePods` = mesma lista de PODs já usada pela aba Escalas & Manifestos; `voyageLabel` idem às outras abas.)* Suporte a deep-link: em `Viagens.tsx`, propagar `?tab=adr&escala=XXX` para o estado inicial do card, seguindo o mecanismo existente de seleção de viagem.

- [ ] **Step 4: Lint, testes e commit**

Run: `npm run lint && npx vitest run src/components src/pages`
Expected: PASS

```bash
git add src/components/voyages/VoyageAgencyReportTab.tsx src/hooks/useAgencyReport.ts src/components/voyages/VoyageCard.tsx src/pages/Viagens.tsx
git commit -m "feat(adr-report): aba ADR derivada no detalhe da viagem"
```

---

## Parte 3 — Sign-offs, ocorrências e alertas

### Task 10: Migration 208 — agregado do ADR e RPCs de sign-off/ocorrência

**Files:**
- Create: `supabase/migrations/208_agency_departure_reports.sql`
- Test: `src/services/__tests__/agencyReportMigration.test.ts`

- [ ] **Step 1: Escrever a migration**

```sql
-- Agency Departure Report: agregado por escala (ADR 0027, spec 2026-07-19).
-- Intent: ancora (voyage_id, port) sem promover escala a entidade; secoes com
--   sign-off departamental; ocorrencias append-only. Fechamento na migration
--   seguinte. Nunca abreviar para "adr" (colide com Architecture Decision
--   Record).
-- Rollback: DROP das tabelas e funcoes criadas aqui.

CREATE TABLE IF NOT EXISTS public.agency_departure_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voyage_id BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  port TEXT NOT NULL,
  terminal TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by UUID,
  closed_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, port)
);

CREATE TABLE IF NOT EXISTS public.agency_departure_report_signoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN (
    'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
    'vazios_embarcados', 'vazios_descarregados', 'ocorrencias'
  )),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'confirmed', 'nothing_to_declare')),
  department TEXT NOT NULL,
  signed_by UUID,
  signed_at TIMESTAMPTZ,
  UNIQUE (report_id, section)
);

CREATE TABLE IF NOT EXISTS public.agency_departure_report_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.agency_departure_reports(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id UUID NOT NULL,
  department TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_departure_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_departure_report_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_departure_report_occurrences ENABLE ROW LEVEL SECURITY;

-- Leitura interna ampla; escrita somente pelas RPCs (nenhuma policy de
-- INSERT/UPDATE/DELETE — append-only e transicoes controladas).
DROP POLICY IF EXISTS agency_departure_reports_select ON public.agency_departure_reports;
CREATE POLICY agency_departure_reports_select ON public.agency_departure_reports
  FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS agency_departure_report_signoffs_select ON public.agency_departure_report_signoffs;
CREATE POLICY agency_departure_report_signoffs_select ON public.agency_departure_report_signoffs
  FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS agency_departure_report_occurrences_select ON public.agency_departure_report_occurrences;
CREATE POLICY agency_departure_report_occurrences_select ON public.agency_departure_report_occurrences
  FOR SELECT TO authenticated USING (public.is_active_user());

CREATE OR REPLACE FUNCTION public.agency_report_section_owner(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'operacoes'
    WHEN 'ocorrencias' THEN 'operacoes'
    WHEN 'veiculos' THEN 'equipamentos'
    WHEN 'vazios_embarcados' THEN 'equipamentos'
    ELSE 'documentacao'
  END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, upper(trim(p_port)))
  ON CONFLICT (voyage_id, port) DO UPDATE SET port = EXCLUDED.port
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_signoff(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_section TEXT,
  p_state TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report_id UUID;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  v_owner := public.agency_report_section_owner(p_section);
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Secao pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Estado invalido.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (v_report_id, p_section, p_state, v_owner, auth.uid(),
          CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET
    state = EXCLUDED.state,
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  -- Encerra alertas de pendencia da secao quando confirmada.
  IF p_state <> 'pending' THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_section_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = p_voyage_id || '::' || upper(trim(p_port)) || '::' || p_section
      AND status <> 'closed';
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_agency_report_occurrence(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_body TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF trim(COALESCE(p_body, '')) = '' THEN
    RAISE EXCEPTION 'Ocorrencia vazia.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  INSERT INTO public.agency_departure_report_occurrences (report_id, body, author_id, department)
  VALUES (v_report_id, trim(p_body), auth.uid(),
          CASE v_role WHEN 'admin' THEN 'administrativo'
                      WHEN 'operator' THEN 'documentacao'
                      ELSE v_role END);

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_terminal(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_terminal TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  UPDATE public.agency_departure_reports
  SET terminal = NULLIF(trim(p_terminal), '')
  WHERE id = v_report_id AND status = 'open';
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_agency_departure_report(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_agency_report_terminal(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_agency_departure_report(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_signoff(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_agency_report_occurrence(BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_report_terminal(BIGINT, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 2: Teste de contrato**

```ts
// src/services/__tests__/agencyReportMigration.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/208_agency_departure_reports.sql'),
  'utf-8',
)

describe('migration 208 — agregado do Agency Departure Report', () => {
  it('ancora em (voyage_id, port) com unicidade', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agency_departure_reports')
    expect(sql).toContain('UNIQUE (voyage_id, port)')
  })

  it('nunca usa o prefixo abreviado adr_', () => {
    expect(sql).not.toMatch(/\badr_/)
  })

  it('sign-off valida o departamento dono da secao', () => {
    expect(sql).toContain('agency_report_section_owner')
    expect(sql).toMatch(/v_role NOT IN \('administrativo', v_owner\)/)
  })

  it('bloqueia sign-off com ADR fechado e nao cria policies de escrita', () => {
    expect(sql).toContain("status = 'closed'")
    expect(sql).not.toMatch(/CREATE POLICY \S+ ON public\.agency_departure_report\S* FOR (INSERT|UPDATE|DELETE|ALL)/)
  })
})
```

- [ ] **Step 3: Rodar o teste**

Run: `npx vitest run src/services/__tests__/agencyReportMigration.test.ts`
Expected: PASS

- [ ] **Step 4: Tipos** *(protegido — pedir autorização)*: adicionar em `src/types/database.ts`:

```ts
export type AgencyReportSectionKey =
  | 'datas' | 'carga_descarregada' | 'carga_carregada' | 'veiculos'
  | 'vazios_embarcados' | 'vazios_descarregados' | 'ocorrencias'

export type AgencyDepartureReport = {
  id: string
  voyage_id: number
  port: string
  terminal: string | null
  status: 'open' | 'closed'
  closed_at: string | null
  closed_by: string | null
  closed_snapshot: Json | null
  created_at: string
}

export type AgencyReportSignoff = {
  id: string
  report_id: string
  section: AgencyReportSectionKey
  state: 'pending' | 'confirmed' | 'nothing_to_declare'
  department: string
  signed_by: string | null
  signed_at: string | null
}

export type AgencyReportOccurrence = {
  id: string
  report_id: string
  body: string
  author_id: string
  department: string
  created_at: string
}
```

E no mapa `Tables`:

```ts
      agency_departure_reports: Row<AgencyDepartureReport>
      agency_departure_report_signoffs: Row<AgencyReportSignoff>
      agency_departure_report_occurrences: Row<AgencyReportOccurrence>
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/208_agency_departure_reports.sql src/services/__tests__/agencyReportMigration.test.ts src/types/database.ts
git commit -m "feat(adr-report): agregado, sign-offs e ocorrencias (migration 208)"
```

### Task 11: Sign-offs e ocorrências na aba

**Files:**
- Modify: `src/services/agencyDepartureReport.ts`, `src/hooks/useAgencyReport.ts`, `src/components/voyages/VoyageAgencyReportTab.tsx`

- [ ] **Step 1: Funções de serviço**

Adicionar a `src/services/agencyDepartureReport.ts`:

```ts
export async function getAgencyReportOwnData(voyageId: number, port: string) {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('*, signoffs:agency_departure_report_signoffs(*), occurrences:agency_departure_report_occurrences(*)')
    .eq('voyage_id', voyageId)
    .eq('port', port)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function setSignoff(input: {
  voyageId: number
  port: string
  section: AgencyReportSection
  state: 'pending' | 'confirmed' | 'nothing_to_declare'
}) {
  const { error } = await supabase.rpc('set_agency_report_signoff', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_section: input.section,
    p_state: input.state,
  })
  if (error) throw error
}

export async function addOccurrence(input: { voyageId: number; port: string; body: string }) {
  const { error } = await supabase.rpc('add_agency_report_occurrence', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_body: input.body,
  })
  if (error) throw error
}

export async function setTerminal(input: { voyageId: number; port: string; terminal: string }) {
  const { error } = await supabase.rpc('set_agency_report_terminal', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_terminal: input.terminal,
  })
  if (error) throw error
}
```

*(As RPCs novas ainda não estão no mapa `Functions` de `database.ts`; adicioná-las lá na mesma autorização da Task 10, com `Args`/`Returns` conforme a migration.)*

- [ ] **Step 2: Hook + UI**

`useAgencyReport.ts`: query `['agency-report-own', voyageId, port]` para `getAgencyReportOwnData` + mutations (`setSignoff`, `addOccurrence`, `setTerminal`) invalidando `['agency-report-own']`. Na aba: cada bloco de seção ganha chip de estado (Pendente/Confirmado/Nada a declarar) e botões de transição visíveis quando `effectiveRole === AGENCY_REPORT_SECTIONS[section] || isAdmin`; input de terminal no cabeçalho; diário de ocorrências (lista `occurrences` ordenada + textarea com botão Lançar). Barra de progresso "X/7 confirmadas" calculada dos sign-offs (seção ausente = pendente).

- [ ] **Step 3: Lint, testes e commit**

Run: `npm run lint && npx vitest run src`
Expected: PASS

```bash
git add src/services/agencyDepartureReport.ts src/hooks/useAgencyReport.ts src/components/voyages/VoyageAgencyReportTab.tsx src/types/database.ts
git commit -m "feat(adr-report): sign-offs por secao e diario de ocorrencias"
```

### Task 12: Alertas de pendência pós-ATD

**Files:**
- Create: `supabase/migrations/209_agency_report_pending_alerts.sql` *(RPC de detecção; o fechamento entra na Task 13, mesma migration)*
- Modify: `src/pages/Alertas.tsx`

- [ ] **Step 1: RPC de detecção (parte 1 da migration 209)**

```sql
-- Agency Departure Report: deteccao de pendencias pos-ATD e fechamento com
-- snapshot (ADR 0027). Pendencia = escala com ATD e secao sem sign-off.
-- A escala e a projecao de audit_logs (voyage_pod_schedule): o ATD vigente e o
-- new_value mais recente do campo 'atd'.
-- Rollback: DROP das funcoes.

CREATE OR REPLACE FUNCTION public.detect_agency_report_pending()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  WITH latest_atd AS (
    SELECT DISTINCT ON (entity_id) entity_id, new_value
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'atd'
    ORDER BY entity_id, changed_at DESC
  ),
  departed AS (
    SELECT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      split_part(entity_id, '::', 2) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> ''
  ),
  sections AS (
    SELECT unnest(ARRAY[
      'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
      'vazios_embarcados', 'vazios_descarregados', 'ocorrencias'
    ]) AS section
  ),
  pending AS (
    SELECT d.voyage_id, d.port, s.section
    FROM departed d
    CROSS JOIN sections s
    LEFT JOIN public.agency_departure_reports r
      ON r.voyage_id = d.voyage_id AND r.port = d.port
    LEFT JOIN public.agency_departure_report_signoffs so
      ON so.report_id = r.id AND so.section = s.section
    WHERE COALESCE(r.status, 'open') = 'open'
      AND COALESCE(so.state, 'pending') = 'pending'
  ),
  inserted AS (
    INSERT INTO public.alerts (type, entity_type, entity_id, message, status)
    SELECT
      'agency_report_section_pending',
      'agency_departure_report',
      p.voyage_id || '::' || p.port || '::' || p.section,
      'ADR ' || p.port || ': secao "' || p.section || '" pendente ('
        || public.agency_report_section_owner(p.section) || ').',
      'open'
    FROM pending p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alerts a
      WHERE a.type = 'agency_report_section_pending'
        AND a.entity_id = p.voyage_id || '::' || p.port || '::' || p.section
        AND a.status <> 'closed'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.detect_agency_report_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_agency_report_pending() TO authenticated;
```

- [ ] **Step 2: Disparo na página de alertas**

Em `src/pages/Alertas.tsx`, junto do carregamento existente (`listAlerts`), disparar a detecção (padrão `detectOverdueInvoices` de `src/services/alerts.ts`):

```ts
// src/services/alerts.ts
export async function detectAgencyReportPending(): Promise<void> {
  await supabase.rpc('detect_agency_report_pending')
}
```

E na página, antes do `useQuery` de alerts, um `useEffect` de montagem que chama `detectAgencyReportPending().catch(() => {})` e invalida `['alerts']`.

- [ ] **Step 3: Teste de contrato**

Adicionar ao `src/services/__tests__/agencyReportMigration.test.ts`:

```ts
const sql209 = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/209_agency_report_pending_alerts.sql'),
  'utf-8',
)

describe('migration 209 — pendencias pos-ATD', () => {
  it('so alerta escala com ATD vigente e secao pendente de ADR aberto', () => {
    expect(sql209).toContain("field_name = 'atd'")
    expect(sql209).toContain("COALESCE(r.status, 'open') = 'open'")
    expect(sql209).toContain("COALESCE(so.state, 'pending') = 'pending'")
  })

  it('deduplica por alerta aberto do mesmo entity_id', () => {
    expect(sql209).toMatch(/NOT EXISTS[\s\S]*agency_report_section_pending/)
  })
})
```

Run: `npx vitest run src/services/__tests__/agencyReportMigration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/209_agency_report_pending_alerts.sql src/services/alerts.ts src/pages/Alertas.tsx src/services/__tests__/agencyReportMigration.test.ts
git commit -m "feat(adr-report): alertas de secao pendente pos-ATD"
```

---

## Parte 4 — Fechamento com snapshot e impressão

### Task 13: RPCs de fechamento e reabertura (continuação da migration 209)

**Files:**
- Modify: `supabase/migrations/209_agency_report_pending_alerts.sql` *(se a 209 já tiver sido aplicada em ambiente remoto, criar `210_agency_report_close.sql` com o mesmo conteúdo abaixo)*

- [ ] **Step 1: Acrescentar as funções**

```sql
CREATE OR REPLACE FUNCTION public.close_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
  v_pending INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR p_snapshot = 'null'::JSONB THEN
    RAISE EXCEPTION 'Snapshot obrigatorio no fechamento.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  SELECT 7 - COUNT(*) INTO v_pending
  FROM public.agency_departure_report_signoffs
  WHERE report_id = v_report_id AND state <> 'pending';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Fechamento exige as 7 secoes confirmadas (% pendentes).', v_pending
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(),
      closed_snapshot = p_snapshot
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR ja fechado.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_section_pending'
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE p_voyage_id || '::' || upper(trim(p_port)) || '::%'
    AND status <> 'closed';

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(
  p_voyage_id BIGINT,
  p_port TEXT,
  p_justification TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF trim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_report_id FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = upper(trim(p_port)) AND status = 'closed';
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR nao esta fechado.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_voyage_id || '::' || upper(trim(p_port)),
          'status', 'closed', 'open', auth.uid(), trim(p_justification));

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_agency_departure_report(BIGINT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_agency_departure_report(BIGINT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_agency_departure_report(BIGINT, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 2: Teste de contrato**

Adicionar ao describe da 209 em `agencyReportMigration.test.ts`:

```ts
  it('fechamento veta secoes pendentes e reabertura exige justificativa auditada', () => {
    expect(sql209).toMatch(/7 - COUNT\(\*\)/)
    expect(sql209).toContain('Reabertura exige justificativa')
    expect(sql209).toMatch(/INSERT INTO public\.audit_logs[\s\S]*'agency_departure_report'/)
  })
```

Run: `npx vitest run src/services/__tests__/agencyReportMigration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/209_agency_report_pending_alerts.sql src/services/__tests__/agencyReportMigration.test.ts
git commit -m "feat(adr-report): fechamento com snapshot e reabertura auditada"
```

### Task 14: Fechamento na UI + documento imprimível

**Files:**
- Create: `src/components/voyages/AgencyReportDocument.tsx`
- Modify: `src/services/agencyDepartureReport.ts`, `src/hooks/useAgencyReport.ts`, `src/components/voyages/VoyageAgencyReportTab.tsx`

- [ ] **Step 1: Serviço**

```ts
export async function closeReport(input: {
  voyageId: number
  port: string
  snapshot: unknown
}) {
  const { error } = await supabase.rpc('close_agency_departure_report', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_snapshot: input.snapshot,
  })
  if (error) throw error
}

export async function reopenReport(input: {
  voyageId: number
  port: string
  justification: string
}) {
  const { error } = await supabase.rpc('reopen_agency_departure_report', {
    p_voyage_id: input.voyageId,
    p_port: input.port,
    p_justification: input.justification,
  })
  if (error) throw error
}
```

- [ ] **Step 2: Snapshot e modos da aba**

Na aba: o botão **Fechar ADR** (habilitado com 7/7 seções não-pendentes) monta o snapshot como o objeto completo já renderizado (cabeçalho, matrizes, veículos, vazios, storage, overtime, serviços com valores, ocorrências, sign-offs) e chama `closeReport`. Quando `report.status === 'closed'`, a aba renderiza a partir de `closed_snapshot` (não das queries derivadas) com selo "Fechado em {data} por {autor}", botão **Imprimir** e ação **Reabrir** (modal com justificativa obrigatória → `reopenReport`).

- [ ] **Step 3: Documento imprimível**

`AgencyReportDocument.tsx`: componente de impressão no padrão de `src/components/shared/InvoiceDocumentKit.tsx` (cabeçalho da empresa + título "AGENCY DEPARTURE REPORT"), com os blocos na ordem do modelo real: cabeçalho (armador, navio/viagem, porto, terminal, ATA, ATD), carga solta, granito, matriz de descarga, container com veículo, embarque de vazios (com OS, embarque direto, depots), serviço extra, storage e overtime, ocorrências. Recebe o snapshot como prop; impressão via `window.print()` com as regras existentes de `src/index.css`.

- [ ] **Step 4: Lint, testes, build e commit**

Run: `npm run lint && npx vitest run src && npm run build`
Expected: PASS

```bash
git add src/components/voyages/AgencyReportDocument.tsx src/services/agencyDepartureReport.ts src/hooks/useAgencyReport.ts src/components/voyages/VoyageAgencyReportTab.tsx
git commit -m "feat(adr-report): fechamento com snapshot congelado e impressao"
```

### Task 15: Documentação viva e verificação final

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`, `docs/spec/README.md`, `docs/plans/README.md`
- Move: `docs/spec/2026-07-19-agency-departure-report-design.md` → `docs/archive/specs/`, este plano → `docs/archive/plans/`

- [ ] **Step 1: Atualizar documentação viva**

- `docs/ARCHITECTURE.md`: fluxo operacional ganha o nó do Agency Departure Report; seção de migrations menciona 205–209; nenhuma rota nova (aba em `/viagens/:voyageId`).
- `docs/RASTREABILIDADE.md`: linhas novas para a aba ADR (componente `VoyageAgencyReportTab`, hook `useAgencyReport`, serviço `agencyDepartureReport.ts`, RPCs `set_agency_report_signoff`/`add_agency_report_occurrence`/`close_agency_departure_report`/`reopen_agency_departure_report`/`detect_agency_report_pending`, testes) e para as extensões de VAZIOS EXP.

- [ ] **Step 2: Ciclo de vida de plano/spec (docs/CONVENCOES.md)**

No mesmo change que concluir a implementação: mover a spec para `docs/archive/specs/` e este plano para `docs/archive/plans/`, removendo as linhas de `docs/spec/README.md` e `docs/plans/README.md`.

- [ ] **Step 3: Verificação completa**

Run: `npm run docs:check && npm run lint && npm test && npm run build`
Expected: tudo PASS

- [ ] **Step 4: Commit final**

```bash
git add docs/
git commit -m "docs: rastreabilidade e arquitetura do Agency Departure Report; arquivar plano e spec"
```

---

## Cobertura da spec (self-review)

| Item da spec | Task |
|---|---|
| Âncora (voyage_id, port), terminal, armador derivado | 10, 9 |
| Aba na Viagem + deep-link | 9 |
| Derivação sem redigitação | 8, 9 |
| Vazios EXP: colunas por container + planilha + inline | 1, 5, 6 |
| Operação da escala (OS), overtime % por depot, serviços extra × tarifa | 2, 6 |
| Papel Equipamentos | 3 |
| Sign-off por seção com dono | 10, 11 |
| Alertas pós-ATD por departamento | 12 |
| Fechamento com snapshot, reabertura auditada | 13, 14 |
| Impressão no layout do modelo real | 14 |
| Granito só em carga carregada (loading_port) | 8 |
| Natureza cama/cover plate | 1, 7 |
| Local de desova de veículos | 1, 7 |
| Restow derivado de `rtw` | 9 |
| Storage derivado de hand-in/hand-out | 6, 8 |
| Docs vivas + ciclo plano/spec | 15 |
