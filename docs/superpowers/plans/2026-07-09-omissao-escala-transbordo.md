# Omissão de Escala e Transbordo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar operacionalmente a omissão de escala pelo armador, o transbordo em navio de terceiros e o COD (Change of Destination), com rastreabilidade interna e visibilidade mínima no Portal — sem automatizar financeiro.

**Architecture:** Duas tabelas novas (`voyage_omissions` no grão escala, `bl_transshipments` no grão B/L) com RPCs `SECURITY DEFINER` auditadas. A omissão de um POD é marcada no padrão insert-only de `audit_logs` (`field_name='omitted'`, igual ao `deleted`), e três leitores de schedule passam a ignorar PODs omitidos (`getProximaEscala`, `syncVoyageStatusAfterAtdChange`, RPC `portal_ship_schedule`). A UI vive no módulo Viagens; o Portal recebe uma `portal_notifications` do tipo novo `transshipment`.

**Tech Stack:** Supabase Postgres (migrations SQL numeradas — ADR 0016), RLS + RPCs (ADR 0004/0011), React + TypeScript SPA, TanStack Query, Vitest (unit + testes de contrato SQL por regex sobre as migrations).

**Spec:** `docs/superpowers/specs/2026-07-09-omissao-escala-transbordo-design.md` (fonte deste plano).

---

## Convenções deste repositório (leia antes)

- **Migrations** são numeradas sequencialmente em `supabase/migrations/NNN_nome.sql`. A última é `173`. Use `174`, `175`, … Nunca edite migrations existentes (guard de arquivos protegidos).
- **`src/types/database.ts` é protegido.** Não regenere nem edite. Para tabelas novas, acesse via cast `as never` no cliente Supabase — exatamente como `src/services/voyageRouteSchedules.ts` faz com `voyage_route_ce_master` (ex.: `supabase.from('voyage_omissions' as never)`, `supabase.rpc('omit_voyage_escala' as never, {...} as never)`).
- **RLS**: tabelas internas usam `public.is_active_user()` (ver migration `170`). RPCs `SECURITY DEFINER` validam `auth.uid()`, `is_active_user()` e `p_changed_by = auth.uid()`, e escrevem em `audit_logs`.
- **Testes de contrato SQL** concatenam todas as migrations e fazem `expect(sql).toMatch(/regex/)`. Modelo: `src/services/__tests__/portalShipScheduleMigration.test.ts`.
- **Entity IDs de schedule** são `` `${voyageId}::${normalizePortValue(pod)}` `` (POD em maiúsculas/trim). Ver `buildVoyagePodEntityId` em `voyageRouteSchedules.ts`.
- **Rodar um teste único:** `npx vitest run caminho/do/test.ts -t "nome"`.
- **Commits frequentes.** Configure uma vez: `git config user.email noreply@anthropic.com && git config user.name Claude`. Trabalhe no branch `claude/ship-omission-transshipment-flow-efaqs1` (PR #351).

---

## File Structure

**Criar:**
- `supabase/migrations/174_voyage_omissions_transshipments.sql` — tabelas, RLS, RPCs, alteração do CHECK de `portal_notifications.type`.
- `supabase/migrations/175_portal_ship_schedule_hide_omitted.sql` — recria `portal_ship_schedule` excluindo PODs omitidos.
- `src/services/transshipments.ts` — camada de serviço (chama as RPCs, lê as tabelas).
- `src/hooks/useTransshipments.ts` — queries/mutations TanStack Query.
- `src/components/voyages/OmitEscalaModal.tsx` — modal de omissão de escala.
- `src/components/voyages/TransshipmentPanel.tsx` — painel por B/L (referência do navio de terceiros + botão COD).
- Testes: `src/services/__tests__/voyageOmissionsMigration.test.ts`, `src/services/__tests__/portalShipScheduleOmitted.test.ts`, `src/services/__tests__/transshipments.test.ts`, `src/services/__tests__/voyageSummaries.omitted.test.ts`, `src/services/__tests__/voyageRouteSchedules.omitted.test.ts`.

**Modificar:**
- `src/services/voyageRouteSchedules.ts` — adicionar `omitted` à reconstrução de POD schedule e ao `syncVoyageStatusAfterAtdChange`.
- `src/services/voyageSummaries.ts` — `getProximaEscala` e `PodScheduleRow` passam a considerar `omitted`.
- `src/components/voyages/VoyageCard.tsx` — botão "Omitir escala", montar `podRows` com `omitted`, embutir `TransshipmentPanel`.
- `src/services/queryKeys.ts` — família de cache `transshipments`.
- Docs: `CONTEXT.md`, `docs/modules/viagens.md`, `docs/modules/portal-cliente.md`, `docs/modules/chegadas-saidas.md`, `docs/RASTREABILIDADE.md`, novo `docs/adr/0022-*.md` (+ índice), `docs/spec/*-behavioral-spec.csv`.

---

## Phase 1 — Banco de dados e RPCs

### Task 1: Migration das tabelas, RLS e RPCs

**Files:**
- Create: `supabase/migrations/174_voyage_omissions_transshipments.sql`
- Test: `src/services/__tests__/voyageOmissionsMigration.test.ts`

- [ ] **Step 1: Escrever o teste de contrato que falha**

Create `src/services/__tests__/voyageOmissionsMigration.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const sql = fs
  .readdirSync(path.resolve(process.cwd(), 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', f), 'utf8'))
  .join('\n')

it('cria voyage_omissions e bl_transshipments com RLS de usuario ativo', () => {
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.voyage_omissions/i)
  expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.bl_transshipments/i)
  expect(sql).toMatch(/UNIQUE\s*\(voyage_id,\s*omitted_pod\)/i)
  expect(sql).toMatch(/disposition[\s\S]*CHECK[\s\S]*'transshipment'[\s\S]*'cod'/i)
  expect(sql).toMatch(/ALTER TABLE public\.voyage_omissions ENABLE ROW LEVEL SECURITY/i)
  expect(sql).toMatch(/ALTER TABLE public\.bl_transshipments ENABLE ROW LEVEL SECURITY/i)
  expect(sql).toMatch(/is_active_user\(\)/i)
})

it('adiciona o tipo transshipment ao CHECK de portal_notifications', () => {
  expect(sql).toMatch(/portal_notifications[\s\S]*ADD CONSTRAINT[\s\S]*'transshipment'/i)
})

it('define as RPCs auditadas de omissao, transbordo e COD', () => {
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.omit_voyage_escala/i)
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_transshipment/i)
  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_bl_cod/i)
  expect(sql).toMatch(/SECURITY DEFINER/i)
  expect(sql).toMatch(/field_name\s*,?\s*[\s\S]*'omitted'/i)
  // omit gera notificacao de transbordo ao cliente
  expect(sql).toMatch(/INSERT INTO public\.portal_notifications[\s\S]*'transshipment'/i)
  // grants: RPC para authenticated, revogado de anon
  expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.omit_voyage_escala[\s\S]*TO authenticated/i)
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/services/__tests__/voyageOmissionsMigration.test.ts`
Expected: FAIL (migration não existe ainda).

- [ ] **Step 3: Escrever a migration**

Create `supabase/migrations/174_voyage_omissions_transshipments.sql`:

```sql
-- Omissao de escala + transbordo/COD (spec 2026-07-09).
-- Grao escala: voyage_omissions. Grao B/L: bl_transshipments.
-- Financeiro (CE Mercante, taxas, demurrage) permanece manual: aqui so registro.
-- Padrao de RLS/RPC segue migrations 167/170 (voyage_route_ce_master).

-- 1. Tabelas -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voyage_omissions (
  id            BIGSERIAL PRIMARY KEY,
  voyage_id     BIGINT NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
  omitted_pod   TEXT NOT NULL,
  discharge_pod TEXT NOT NULL,
  reason        TEXT,
  omitted_by    UUID REFERENCES auth.users(id),
  omitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (voyage_id, omitted_pod),
  CHECK (upper(btrim(omitted_pod)) <> upper(btrim(discharge_pod)))
);
CREATE INDEX IF NOT EXISTS voyage_omissions_voyage_idx
  ON public.voyage_omissions(voyage_id);

CREATE TABLE IF NOT EXISTS public.bl_transshipments (
  id                   BIGSERIAL PRIMARY KEY,
  bl_id                TEXT NOT NULL REFERENCES public.bls(id) ON DELETE CASCADE,
  omission_id          BIGINT NOT NULL REFERENCES public.voyage_omissions(id) ON DELETE CASCADE,
  disposition          TEXT NOT NULL DEFAULT 'transshipment'
                         CHECK (disposition IN ('transshipment', 'cod')),
  onward_vessel_name   TEXT,
  onward_carrier       TEXT,
  onward_voyage_number TEXT,
  onward_etd           TIMESTAMPTZ,
  onward_eta           TIMESTAMPTZ,
  created_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bl_id, omission_id),
  -- COD nao carrega dados de navio de terceiros (invariante 3 do spec).
  CHECK (disposition = 'transshipment' OR (
    onward_vessel_name IS NULL AND onward_carrier IS NULL AND
    onward_voyage_number IS NULL AND onward_etd IS NULL AND onward_eta IS NULL))
);
CREATE INDEX IF NOT EXISTS bl_transshipments_bl_idx
  ON public.bl_transshipments(bl_id);
CREATE INDEX IF NOT EXISTS bl_transshipments_omission_idx
  ON public.bl_transshipments(omission_id);

-- 2. RLS (usuarios internos ativos; Portal nao acessa direto) -----------------
ALTER TABLE public.voyage_omissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bl_transshipments  ENABLE ROW LEVEL SECURITY;

CREATE POLICY voyage_omissions_select_active ON public.voyage_omissions
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY bl_transshipments_select_active ON public.bl_transshipments
  FOR SELECT TO authenticated USING (public.is_active_user());
-- Escrita so via RPCs SECURITY DEFINER abaixo; sem policies de INSERT/UPDATE/DELETE.

-- 3. Tipo novo de notificacao do Portal --------------------------------------
ALTER TABLE public.portal_notifications DROP CONSTRAINT IF EXISTS portal_notifications_type_check;
ALTER TABLE public.portal_notifications ADD CONSTRAINT portal_notifications_type_check
  CHECK (type IN ('invoice_issued','demurrage_issued','dispute_responded',
                  'dispute_opened','system','transshipment'));

-- 4. RPC: omitir escala -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.omit_voyage_escala(
  p_voyage_id BIGINT, p_omitted_pod TEXT, p_discharge_pod TEXT,
  p_reason TEXT, p_changed_by UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_omitted   TEXT := upper(btrim(COALESCE(p_omitted_pod, '')));
  v_discharge TEXT := upper(btrim(COALESCE(p_discharge_pod, '')));
  v_entity_id TEXT := p_voyage_id::text || '::' || v_omitted;
  v_omission_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_omitted = '' OR v_discharge = '' OR v_omitted = v_discharge THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % nao encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  -- registra o cabecalho da omissao (idempotente por UNIQUE)
  INSERT INTO public.voyage_omissions(voyage_id, omitted_pod, discharge_pod, reason, omitted_by)
  VALUES (p_voyage_id, v_omitted, v_discharge, NULLIF(btrim(COALESCE(p_reason, '')), ''), p_changed_by)
  ON CONFLICT (voyage_id, omitted_pod)
  DO UPDATE SET discharge_pod = EXCLUDED.discharge_pod, reason = EXCLUDED.reason,
                omitted_by = EXCLUDED.omitted_by, omitted_at = now()
  RETURNING id INTO v_omission_id;

  -- marca o POD como omitido (padrao insert-only, igual ao 'deleted')
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage_pod_schedule', v_entity_id, 'omitted', 'false', 'true', p_changed_by,
          'Escala omitida pelo armador; carga descarregada em ' || v_discharge);

  -- evento na timeline da viagem
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyage', p_voyage_id::text, 'escala_omitida', v_omitted, v_discharge, p_changed_by,
          COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala'));

  -- cria um bl_transshipments (transbordo por padrao) para cada B/L do POD omitido
  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  -- notifica o cliente dono de cada B/L afetado (tradução minima de "timeline do evento")
  INSERT INTO public.portal_notifications(customer_id, type, title, message, link)
  SELECT b.customer_id, 'transshipment', 'Escala omitida',
         'A escala de ' || v_omitted || ' foi omitida. A carga do B/L ' || b.id ||
         ' foi descarregada em ' || v_discharge || ' e seguira em transbordo para ' || v_omitted || '.',
         NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;

  RETURN v_omission_id;
END;
$function$;

-- 5. RPC: definir/atualizar transbordo (tambem reverte COD -> transbordo) ------
CREATE OR REPLACE FUNCTION public.set_bl_transshipment(
  p_bl_id TEXT, p_omission_id BIGINT,
  p_onward_vessel_name TEXT, p_onward_carrier TEXT, p_onward_voyage_number TEXT,
  p_onward_etd TIMESTAMPTZ, p_onward_eta TIMESTAMPTZ, p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_was TEXT;
  v_original_pod TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT t.disposition, o.omitted_pod INTO v_was, v_original_pod
  FROM public.bl_transshipments t
  JOIN public.voyage_omissions o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.bl_transshipments
  SET disposition = 'transshipment',
      onward_vessel_name = NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
      onward_carrier = NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
      onward_voyage_number = NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
      onward_etd = p_onward_etd, onward_eta = p_onward_eta, updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  -- se estava em COD, restaura o destino original do B/L (auditado)
  IF v_was = 'cod' THEN
    UPDATE public.bls SET pod = v_original_pod, updated_at = now() WHERE id = p_bl_id;
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bls', p_bl_id, 'pod', NULL, v_original_pod, p_changed_by, 'Reversao de COD para transbordo');
  END IF;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'transbordo', v_was, 'transshipment', p_changed_by,
          'Definicao de transbordo (navio de terceiros)');
END;
$function$;

-- 6. RPC: marcar COD (Change of Destination) ----------------------------------
CREATE OR REPLACE FUNCTION public.set_bl_cod(
  p_bl_id TEXT, p_omission_id BIGINT, p_changed_by UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_discharge TEXT;
  v_omitted TEXT;
  v_old_pod TEXT;
  v_customer BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuario sem permissao ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT o.discharge_pod, o.omitted_pod INTO v_discharge, v_omitted
  FROM public.bl_transshipments t
  JOIN public.voyage_omissions o ON o.id = t.omission_id
  WHERE t.bl_id = p_bl_id AND t.omission_id = p_omission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transbordo do B/L % nao encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  SELECT pod, customer_id INTO v_old_pod, v_customer FROM public.bls WHERE id = p_bl_id;

  UPDATE public.bl_transshipments
  SET disposition = 'cod', onward_vessel_name = NULL, onward_carrier = NULL,
      onward_voyage_number = NULL, onward_etd = NULL, onward_eta = NULL, updated_at = now()
  WHERE bl_id = p_bl_id AND omission_id = p_omission_id;

  UPDATE public.bls SET pod = v_discharge, updated_at = now() WHERE id = p_bl_id;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bls', p_bl_id, 'pod', v_old_pod, v_discharge, p_changed_by,
          'COD apos omissao da escala de ' || v_omitted);

  IF v_customer IS NOT NULL THEN
    INSERT INTO public.portal_notifications(customer_id, type, title, message, link)
    VALUES (v_customer, 'transshipment', 'Destino alterado (COD)',
            'A pedido, o destino final do B/L ' || p_bl_id || ' foi alterado para ' || v_discharge ||
            ' (COD), apos a omissao da escala de ' || v_omitted || '.', NULL);
  END IF;
END;
$function$;

-- 7. Grants -------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.omit_voyage_escala(BIGINT, TEXT, TEXT, TEXT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_transshipment(TEXT, BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bl_cod(TEXT, BIGINT, UUID) TO authenticated;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/services/__tests__/voyageOmissionsMigration.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/174_voyage_omissions_transshipments.sql src/services/__tests__/voyageOmissionsMigration.test.ts
git commit -m "feat(db): tabelas e RPCs de omissao de escala e transbordo"
```

### Task 2: Esconder PODs omitidos no cronograma do Portal

**Files:**
- Create: `supabase/migrations/175_portal_ship_schedule_hide_omitted.sql`
- Test: `src/services/__tests__/portalShipScheduleOmitted.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/services/__tests__/portalShipScheduleOmitted.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

it('portal_ship_schedule exclui PODs omitidos, alem dos deletados', () => {
  const dir = path.resolve(process.cwd(), 'supabase/migrations')
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  // a ultima definicao da funcao deve referenciar um CTE de PODs omitidos
  const lastDef = sql.slice(sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.portal_ship_schedule'))
  expect(lastDef).toMatch(/omitted_pods/i)
  expect(lastDef).toMatch(/field_name\s*=\s*'omitted'/i)
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/services/__tests__/portalShipScheduleOmitted.test.ts`
Expected: FAIL.

- [ ] **Step 3: Escrever a migration (recria a funcao com CTE omitted_pods)**

Create `supabase/migrations/175_portal_ship_schedule_hide_omitted.sql`. Copie a definicao da `173_portal_ship_schedule.sql` e adicione o CTE `omitted_pods` (espelho do `deleted_pods`) e o filtro no CTE `pod`:

```sql
-- PODs omitidos (escala cancelada pelo armador) tambem somem do cronograma do
-- Portal. Sem isso o cliente veria a escala cancelada como se fosse ocorrer.
CREATE OR REPLACE FUNCTION public.portal_ship_schedule()
RETURNS TABLE (
  voyage_id bigint, vessel_name text, voyage text, imo_number text,
  port_code text, kind text, date_value text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH visible AS (
    SELECT v.id, ve.name AS vessel_name, v.voyage_number, ve.imo
    FROM public.voyages v
    JOIN public.vessels ve ON ve.id = v.vessel_id
    WHERE v.show_on_portal AND v.status = 'active'
  ),
  latest AS (
    SELECT DISTINCT ON (a.entity_type, a.entity_id, a.field_name)
      a.entity_type, a.entity_id, a.field_name, a.new_value
    FROM public.audit_logs a
    WHERE a.entity_type IN ('voyage_pol_schedule', 'voyage_pod_schedule')
    ORDER BY a.entity_type, a.entity_id, a.field_name, a.changed_at DESC
  ),
  deleted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'deleted' AND new_value = 'true'
  ),
  omitted_pods AS (
    SELECT entity_id FROM latest
    WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'omitted' AND new_value = 'true'
  ),
  pol AS (
    SELECT split_part(entity_id, '::', 1)::bigint AS vid,
           split_part(entity_id, '::', 2) AS port_code, new_value AS etd
    FROM latest
    WHERE entity_type = 'voyage_pol_schedule' AND field_name = 'etd' AND new_value IS NOT NULL
  ),
  pod AS (
    SELECT split_part(l.entity_id, '::', 1)::bigint AS vid,
           split_part(l.entity_id, '::', 2) AS port_code, l.new_value AS eta
    FROM latest l
    LEFT JOIN deleted_pods d ON d.entity_id = l.entity_id
    LEFT JOIN omitted_pods o ON o.entity_id = l.entity_id
    WHERE l.entity_type = 'voyage_pod_schedule' AND l.field_name = 'eta'
      AND l.new_value IS NOT NULL AND d.entity_id IS NULL AND o.entity_id IS NULL
  )
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pol.port_code, 'pol', pol.etd
  FROM visible JOIN pol ON pol.vid = visible.id
  UNION ALL
  SELECT visible.id, visible.vessel_name, visible.voyage_number, visible.imo,
         pod.port_code, 'pod', pod.eta
  FROM visible JOIN pod ON pod.vid = visible.id;
$$;

REVOKE ALL ON FUNCTION public.portal_ship_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_ship_schedule() TO anon, authenticated;
```

- [ ] **Step 4: Rodar e confirmar que passa (incluindo o teste existente)**

Run: `npx vitest run src/services/__tests__/portalShipScheduleOmitted.test.ts src/services/__tests__/portalShipScheduleMigration.test.ts`
Expected: PASS em ambos.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/175_portal_ship_schedule_hide_omitted.sql src/services/__tests__/portalShipScheduleOmitted.test.ts
git commit -m "feat(db): oculta PODs omitidos no cronograma do Portal"
```

---

## Phase 2 — Reconstrução de schedule e derivações

### Task 3: Reconstruir `omitted` no POD schedule

**Files:**
- Modify: `src/services/voyageRouteSchedules.ts`

- [ ] **Step 1: Adicionar `omitted` ao tipo `VoyagePodSchedule`**

Em `src/services/voyageRouteSchedules.ts`, no tipo `VoyagePodSchedule` (logo após `deleted?: boolean`, ~linha 40):

```ts
  /** POD removido do planejamento (soft-delete via audit log). */
  deleted?: boolean
  /** Escala omitida pelo armador (carga descarregada em outro POD). */
  omitted?: boolean
```

- [ ] **Step 2: Popular `omitted` nas duas reconstruções**

Em `listVoyagePodSchedules` (~linha 138, junto ao `deleted`):

```ts
    if (row.field_name === 'deleted' && !seenFields.has('deleted')) current.deleted = normalizeBooleanValue(row.new_value) ?? false
    if (row.field_name === 'omitted' && !seenFields.has('omitted')) current.omitted = normalizeBooleanValue(row.new_value) ?? false
```

Faça o mesmo bloco na segunda reconstrução dentro de `listVoyagePodSchedulesByVoyageIds` (a leitura por prefixo de viagem, ~linha 517, junto do `deleted` correspondente — se lá o `deleted` não for lido, adicione ambos os `if` espelhando o de `listVoyagePodSchedules`).

- [ ] **Step 3: Garantir que `omitted` também seja filtrado como `deleted` na leitura de rotas**

Verifique se `listVoyagePodSchedules*` ou seus consumidores excluem `deleted`. Onde houver `.filter(s => !s.deleted)` para montar rotas ativas, acrescente `&& !s.omitted` (ex.: derivação de PODs planejados exibidos na grade). Grep: `rg "\.deleted" src/services src/components/voyages`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/services/voyageRouteSchedules.ts
git commit -m "feat(voyages): reconstroi marcador omitted no POD schedule"
```

### Task 4: `getProximaEscala` ignora POD omitido

**Files:**
- Modify: `src/services/voyageSummaries.ts`
- Test: `src/services/__tests__/voyageSummaries.omitted.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/services/__tests__/voyageSummaries.omitted.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getProximaEscala } from '../voyageSummaries'

describe('getProximaEscala com PODs omitidos', () => {
  it('ignora o POD omitido ao escolher a proxima escala', () => {
    const rows = [
      { pod: 'SALVADOR', eta: '2026-07-10', ata: null, omitted: true },
      { pod: 'VITORIA', eta: '2026-07-20', ata: null },
    ]
    expect(getProximaEscala(rows)?.pod).toBe('VITORIA')
  })

  it('retorna null quando o unico POD pendente esta omitido', () => {
    const rows = [{ pod: 'SALVADOR', eta: '2026-07-10', ata: null, omitted: true }]
    expect(getProximaEscala(rows)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/services/__tests__/voyageSummaries.omitted.test.ts`
Expected: FAIL (primeiro caso escolhe SALVADOR).

- [ ] **Step 3: Atualizar `getProximaEscala` e os tipos de linha**

Em `src/services/voyageSummaries.ts`, ~linha 295:

```ts
/** Próxima escala: menor ETA entre PODs com ETA, sem ATA e não omitidos. */
export function getProximaEscala(
  podRows: Array<{ pod: string; eta: string | null; ata: string | null; omitted?: boolean }> | null | undefined,
) {
  const pending = (podRows ?? []).filter((row) => row.eta && !row.ata && !row.omitted)
  if (!pending.length) return null
  const next = pending.reduce((earliest, row) => (String(row.eta) < String(earliest.eta) ? row : earliest))
  return { pod: next.pod, eta: next.eta as string }
}
```

E estenda `PodScheduleRow` (~linha 331) para carregar o marcador:

```ts
type PodScheduleRow = { pod: string; eta: string | null; ata: string | null; omitted?: boolean }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/services/__tests__/voyageSummaries.omitted.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/voyageSummaries.ts src/services/__tests__/voyageSummaries.omitted.test.ts
git commit -m "feat(voyages): proxima escala ignora POD omitido"
```

### Task 5: Conclusão da viagem trata POD omitido como não pendente

**Files:**
- Modify: `src/services/voyageRouteSchedules.ts:433-447` (`syncVoyageStatusAfterAtdChange`)
- Test: `src/services/__tests__/voyageRouteSchedules.omitted.test.ts`

- [ ] **Step 1: Refatorar a decisão de status para uma função pura testável**

Em `voyageRouteSchedules.ts`, acima de `syncVoyageStatusAfterAtdChange`, adicione e exporte:

```ts
/** Viagem conclui quando todo POD ativo tem ATD; POD omitido nao conta como pendente. */
export function computeVoyageStatusFromPods(
  pods: Array<{ atd: string | null; omitted?: boolean }>,
): 'active' | 'completed' {
  const relevant = pods.filter((p) => !p.omitted)
  if (relevant.length === 0) return 'active'
  return relevant.every((p) => p.atd) ? 'completed' : 'active'
}
```

- [ ] **Step 2: Escrever o teste que falha**

Create `src/services/__tests__/voyageRouteSchedules.omitted.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeVoyageStatusFromPods } from '../voyageRouteSchedules'

describe('computeVoyageStatusFromPods', () => {
  it('conclui a viagem quando o unico POD nao-omitido tem ATD', () => {
    expect(computeVoyageStatusFromPods([
      { atd: '2026-07-20', omitted: false },
      { atd: null, omitted: true },
    ])).toBe('completed')
  })
  it('mantem ativa quando um POD nao-omitido ainda nao tem ATD', () => {
    expect(computeVoyageStatusFromPods([
      { atd: null, omitted: false },
      { atd: null, omitted: true },
    ])).toBe('active')
  })
})
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run src/services/__tests__/voyageRouteSchedules.omitted.test.ts`
Expected: FAIL (função não existe / não importada).

- [ ] **Step 4: Usar a função pura dentro de `syncVoyageStatusAfterAtdChange`**

Substitua o cálculo inline (linhas ~436-447) para montar `podAtdValues` com `omitted` e delegar:

```ts
  const podEntries: Array<{ atd: string | null; omitted?: boolean }> = []
  for (const [entityId, schedule] of allPodSchedules) {
    if (schedule.voyageId !== voyageId) continue
    const pod = entityId.split('::')[1] ?? '-'
    const atd = pod === changedPod ? newAtd : schedule.atd
    podEntries.push({ atd, omitted: schedule.omitted })
  }
  if (podEntries.length === 0) return
  const newStatus = computeVoyageStatusFromPods(podEntries)
```

(Remova a variável `allAtdSet` antiga; mantenha o restante do fetch/update de `voyages.status`.)

- [ ] **Step 5: Rodar os testes e o typecheck**

Run: `npx vitest run src/services/__tests__/voyageRouteSchedules.omitted.test.ts && npx tsc --noEmit`
Expected: PASS + sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/services/voyageRouteSchedules.ts src/services/__tests__/voyageRouteSchedules.omitted.test.ts
git commit -m "feat(voyages): conclusao da viagem ignora POD omitido"
```

---

## Phase 3 — Camada de serviço (frontend)

### Task 6: Serviço `transshipments.ts`

**Files:**
- Create: `src/services/transshipments.ts`
- Test: `src/services/__tests__/transshipments.test.ts`

- [ ] **Step 1: Escrever o teste que falha (com mock do supabase)**

Create `src/services/__tests__/transshipments.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { omitVoyageEscala } from '../transshipments'

describe('omitVoyageEscala', () => {
  beforeEach(() => rpc.mockReset())
  it('chama a RPC omit_voyage_escala com os PODs normalizados', async () => {
    rpc.mockResolvedValue({ data: 7, error: null })
    const id = await omitVoyageEscala({
      voyageId: 1, omittedPod: ' salvador ', dischargePod: 'vitoria',
      reason: 'omissao', changedBy: 'user-1',
    })
    expect(id).toBe(7)
    expect(rpc).toHaveBeenCalledWith('omit_voyage_escala', {
      p_voyage_id: 1, p_omitted_pod: 'SALVADOR', p_discharge_pod: 'VITORIA',
      p_reason: 'omissao', p_changed_by: 'user-1',
    })
  })
  it('propaga erro da RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('x') })
    await expect(omitVoyageEscala({
      voyageId: 1, omittedPod: 'A', dischargePod: 'B', reason: null, changedBy: 'u',
    })).rejects.toThrow('x')
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run src/services/__tests__/transshipments.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o serviço**

Create `src/services/transshipments.ts`:

```ts
import { supabase } from './supabase'

const normPod = (v: string) => v.trim().toUpperCase()

export type BlDisposition = 'transshipment' | 'cod'

export interface BlTransshipment {
  id: number
  blId: string
  omissionId: number
  disposition: BlDisposition
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
}

export interface VoyageOmission {
  id: number
  voyageId: number
  omittedPod: string
  dischargePod: string
  reason: string | null
}

export async function omitVoyageEscala(input: {
  voyageId: number
  omittedPod: string
  dischargePod: string
  reason: string | null
  changedBy: string
}): Promise<number> {
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>,
  ) => Promise<{ data: number | null; error: Error | null }>)('omit_voyage_escala', {
    p_voyage_id: input.voyageId,
    p_omitted_pod: normPod(input.omittedPod),
    p_discharge_pod: normPod(input.dischargePod),
    p_reason: input.reason,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
  return data as number
}

export async function setBlTransshipment(input: {
  blId: string
  omissionId: number
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
  changedBy: string
}): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>,
  ) => Promise<{ error: Error | null }>)('set_bl_transshipment', {
    p_bl_id: input.blId,
    p_omission_id: input.omissionId,
    p_onward_vessel_name: input.onwardVesselName,
    p_onward_carrier: input.onwardCarrier,
    p_onward_voyage_number: input.onwardVoyageNumber,
    p_onward_etd: input.onwardEtd,
    p_onward_eta: input.onwardEta,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function setBlCod(input: {
  blId: string
  omissionId: number
  changedBy: string
}): Promise<void> {
  const { error } = await (supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>,
  ) => Promise<{ error: Error | null }>)('set_bl_cod', {
    p_bl_id: input.blId,
    p_omission_id: input.omissionId,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function listVoyageOmissions(voyageId: number): Promise<VoyageOmission[]> {
  const { data, error } = await (supabase.from as unknown as (t: string) => {
    select: (c: string) => { eq: (k: string, v: number) => Promise<{ data: unknown[] | null; error: Error | null }> }
  })('voyage_omissions').select('id, voyage_id, omitted_pod, discharge_pod, reason').eq('voyage_id', voyageId)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id), voyageId: Number(r.voyage_id), omittedPod: String(r.omitted_pod),
    dischargePod: String(r.discharge_pod), reason: (r.reason as string) ?? null,
  }))
}

export async function listBlTransshipments(omissionId: number): Promise<BlTransshipment[]> {
  const { data, error } = await (supabase.from as unknown as (t: string) => {
    select: (c: string) => { eq: (k: string, v: number) => Promise<{ data: unknown[] | null; error: Error | null }> }
  })('bl_transshipments').select(
    'id, bl_id, omission_id, disposition, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta',
  ).eq('omission_id', omissionId)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id), blId: String(r.bl_id), omissionId: Number(r.omission_id),
    disposition: r.disposition as BlDisposition,
    onwardVesselName: (r.onward_vessel_name as string) ?? null,
    onwardCarrier: (r.onward_carrier as string) ?? null,
    onwardVoyageNumber: (r.onward_voyage_number as string) ?? null,
    onwardEtd: (r.onward_etd as string) ?? null,
    onwardEta: (r.onward_eta as string) ?? null,
  }))
}
```

> **Nota de normalização (ponytail):** `normPod` faz `trim().toUpperCase()`, alinhado ao caso dominante de `normalizePortCode`. Se `normalizePortCode` remover mais que espaços de borda, alinhe `normPod` a ele (ceiling: PODs com caracteres especiais). Verifique `normalizePortCode` antes de fechar a task.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/services/__tests__/transshipments.test.ts && npx tsc --noEmit`
Expected: PASS + sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/services/transshipments.ts src/services/__tests__/transshipments.test.ts
git commit -m "feat(transshipments): servico de omissao, transbordo e COD"
```

---

## Phase 4 — Hooks e UI

### Task 7: Family de cache + hooks

**Files:**
- Modify: `src/services/queryKeys.ts`
- Create: `src/hooks/useTransshipments.ts`

- [ ] **Step 1: Adicionar a família de cache**

Em `src/services/queryKeys.ts`, siga o padrão existente das outras famílias e adicione:

```ts
  transshipments: {
    byVoyage: (voyageId: number) => ['transshipments', 'voyage', voyageId] as const,
  },
```

(Encaixe dentro do objeto `queryKeys` exportado, seguindo o estilo das entradas vizinhas. Rode `rg "export const queryKeys" src/services/queryKeys.ts` para achar o objeto.)

- [ ] **Step 2: Criar os hooks**

Create `src/hooks/useTransshipments.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  listVoyageOmissions, listBlTransshipments, omitVoyageEscala,
  setBlTransshipment, setBlCod, type VoyageOmission, type BlTransshipment,
} from '../services/transshipments'

export function useVoyageTransshipments(voyageId: number | null) {
  return useQuery({
    queryKey: voyageId ? queryKeys.transshipments.byVoyage(voyageId) : ['transshipments', 'none'],
    enabled: voyageId != null,
    queryFn: async (): Promise<{ omissions: VoyageOmission[]; transshipments: BlTransshipment[] }> => {
      const omissions = await listVoyageOmissions(voyageId as number)
      const transshipments = (
        await Promise.all(omissions.map((o) => listBlTransshipments(o.id)))
      ).flat()
      return { omissions, transshipments }
    },
  })
}

export function useOmitEscala(voyageId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: omitVoyageEscala,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.transshipments.byVoyage(voyageId) })
      qc.invalidateQueries({ queryKey: ['voyage-pod-schedules'] })
      qc.invalidateQueries({ queryKey: ['voyage-timeline'] })
      qc.invalidateQueries({ queryKey: ['voyages'] })
      qc.invalidateQueries({ queryKey: ['bls'] })
    },
  })
}

export function useSetBlDisposition(voyageId: number) {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.transshipments.byVoyage(voyageId) })
    qc.invalidateQueries({ queryKey: ['bls'] })
  }
  return {
    setTransshipment: useMutation({ mutationFn: setBlTransshipment, onSuccess: invalidate }),
    setCod: useMutation({ mutationFn: setBlCod, onSuccess: invalidate }),
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros. (Se `queryKeys.transshipments` acusar tipo, confirme que a Step 1 salvou.)

- [ ] **Step 4: Commit**

```bash
git add src/services/queryKeys.ts src/hooks/useTransshipments.ts
git commit -m "feat(transshipments): family de cache e hooks"
```

### Task 8: Modal de omissão de escala

**Files:**
- Create: `src/components/voyages/OmitEscalaModal.tsx`

Siga o padrão visual de `src/components/shared/VoyageScheduleModals.tsx` (form em grid, estado `saving`, botões). O componente recebe a lista de PODs ativos da viagem (para escolher o porto de descarga) e o `voyageId`.

- [ ] **Step 1: Criar o componente**

Create `src/components/voyages/OmitEscalaModal.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useOmitEscala } from '../../hooks/useTransshipments'
import { useAuth } from '../../hooks/useAuth'

interface Props {
  open: boolean
  onClose: () => void
  voyageId: number
  omittedPod: string
  /** PODs ativos da viagem, exceto o omitido, para escolher a descarga. */
  candidateDischargePods: string[]
}

export function OmitEscalaModal({ open, onClose, voyageId, omittedPod, candidateDischargePods }: Props) {
  const { user } = useAuth()
  const omit = useOmitEscala(voyageId)
  const [dischargePod, setDischargePod] = useState(candidateDischargePods[0] ?? '')
  const [reason, setReason] = useState('')

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user?.id || !dischargePod) return
    await omit.mutateAsync({
      voyageId, omittedPod, dischargePod, reason: reason.trim() || null, changedBy: user.id,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 className="mb-1 text-lg font-semibold">Omitir escala de {omittedPod}</h2>
        <p className="mb-4 text-sm text-neutral-500">
          A carga de {omittedPod} será descarregada no porto escolhido e entrará em transbordo
          (padrão) por B/L. O financeiro permanece manual.
        </p>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm">
            Porto de descarga
            <select className="rounded border px-2 py-1" value={dischargePod}
              onChange={(e) => setDischargePod(e.target.value)} required>
              {candidateDischargePods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Motivo (opcional)
            <input className="rounded border px-2 py-1" value={reason}
              onChange={(e) => setReason(e.target.value)} />
          </label>
          {omit.isError && <p className="text-sm text-red-600">Falha ao omitir a escala.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded px-3 py-1" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={omit.isPending || !dischargePod}
              className="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50">
              {omit.isPending ? 'Omitindo…' : 'Omitir escala'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
```

> Verifique o hook de auth real do projeto: `rg "export function useAuth|user\.id" src/hooks | head`. Ajuste o import/uso de `user.id` ao contrato existente (o mesmo usado em `Viagens.tsx` para `changedBy`). Reutilize primitivas de UI existentes (`Modal`, `Button`) se o projeto as tiver — `rg "components/ui" src/components/voyages`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (após alinhar `useAuth`).

- [ ] **Step 3: Commit**

```bash
git add src/components/voyages/OmitEscalaModal.tsx
git commit -m "feat(voyages): modal de omissao de escala"
```

### Task 9: Painel de transbordo/COD por B/L

**Files:**
- Create: `src/components/voyages/TransshipmentPanel.tsx`

- [ ] **Step 1: Criar o componente**

Create `src/components/voyages/TransshipmentPanel.tsx`. Lista, para cada omissão da viagem, os B/Ls afetados com sua disposição; para transbordo, campos do navio de terceiros; botão para alternar COD ↔ Transbordo:

```tsx
import { useState } from 'react'
import { useVoyageTransshipments, useSetBlDisposition } from '../../hooks/useTransshipments'
import { useAuth } from '../../hooks/useAuth'
import type { BlTransshipment } from '../../services/transshipments'

export function TransshipmentPanel({ voyageId }: { voyageId: number }) {
  const { user } = useAuth()
  const { data } = useVoyageTransshipments(voyageId)
  const { setTransshipment, setCod } = useSetBlDisposition(voyageId)
  if (!data || data.omissions.length === 0) return null

  return (
    <section className="grid gap-4">
      {data.omissions.map((o) => (
        <div key={o.id} className="rounded border p-3">
          <h3 className="text-sm font-semibold">
            Escala omitida: {o.omittedPod} → descarga em {o.dischargePod}
          </h3>
          <ul className="mt-2 grid gap-2">
            {data.transshipments.filter((t) => t.omissionId === o.id).map((t) => (
              <BlRow key={t.id} t={t} dischargePod={o.dischargePod}
                onCod={() => user?.id && setCod.mutate({ blId: t.blId, omissionId: o.id, changedBy: user.id })}
                onSave={(f) => user?.id && setTransshipment.mutate({
                  blId: t.blId, omissionId: o.id, changedBy: user.id, ...f,
                })} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function BlRow({ t, dischargePod, onCod, onSave }: {
  t: BlTransshipment
  dischargePod: string
  onCod: () => void
  onSave: (f: {
    onwardVesselName: string | null; onwardCarrier: string | null
    onwardVoyageNumber: string | null; onwardEtd: string | null; onwardEta: string | null
  }) => void
}) {
  const [vessel, setVessel] = useState(t.onwardVesselName ?? '')
  const [carrier, setCarrier] = useState(t.onwardCarrier ?? '')
  const [voyageNo, setVoyageNo] = useState(t.onwardVoyageNumber ?? '')
  const [etd, setEtd] = useState(t.onwardEtd?.slice(0, 10) ?? '')
  const [eta, setEta] = useState(t.onwardEta?.slice(0, 10) ?? '')

  return (
    <li className="grid gap-2 rounded bg-neutral-50 p-2 dark:bg-neutral-800">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{t.blId}</span>
        <span className="text-xs uppercase">
          {t.disposition === 'cod' ? `COD → ${dischargePod}` : 'Transbordo'}
        </span>
      </div>
      {t.disposition === 'transshipment' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="rounded border px-2 py-1 text-sm" placeholder="Navio (terceiro)"
            value={vessel} onChange={(e) => setVessel(e.target.value)} />
          <input className="rounded border px-2 py-1 text-sm" placeholder="Armador (terceiro)"
            value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          <input className="rounded border px-2 py-1 text-sm" placeholder="Viagem"
            value={voyageNo} onChange={(e) => setVoyageNo(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="rounded border px-2 py-1 text-sm" value={etd}
              onChange={(e) => setEtd(e.target.value)} />
            <input type="date" className="rounded border px-2 py-1 text-sm" value={eta}
              onChange={(e) => setEta(e.target.value)} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              onClick={() => onSave({
                onwardVesselName: vessel.trim() || null, onwardCarrier: carrier.trim() || null,
                onwardVoyageNumber: voyageNo.trim() || null,
                onwardEtd: etd || null, onwardEta: eta || null,
              })}>Salvar transbordo</button>
            <button className="rounded border px-3 py-1 text-sm" onClick={onCod}>
              Marcar COD ({dischargePod})
            </button>
          </div>
        </div>
      ) : (
        <button className="justify-self-start rounded border px-3 py-1 text-sm"
          onClick={() => onSave({
            onwardVesselName: null, onwardCarrier: null, onwardVoyageNumber: null,
            onwardEtd: null, onwardEta: null,
          })}>Reverter para transbordo</button>
      )}
    </li>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/voyages/TransshipmentPanel.tsx
git commit -m "feat(voyages): painel de transbordo e COD por B/L"
```

### Task 10: Ligar UI ao `VoyageCard`

**Files:**
- Modify: `src/components/voyages/VoyageCard.tsx`

- [ ] **Step 1: Montar `podRows` com `omitted`**

No `VoyageCard.tsx`, onde `podRows` é montado antes de `getProximaEscala(podRows)` (~linha 171), inclua `omitted` de cada schedule na linha (o schedule agora expõe `omitted` — Task 3). Garanta que o objeto passado tenha `{ pod, eta, ata, omitted }`.

- [ ] **Step 2: Adicionar o botão "Omitir escala" por POD (admin)**

Ao lado da ação de excluir POD (lixeira) na grade de planejamento POD, adicione um botão "Omitir escala" visível a admin, que abre `OmitEscalaModal` com o `omittedPod` do POD da linha e `candidateDischargePods` = demais PODs ativos (não omitidos/deletados) da viagem. Use o mesmo gating de admin já usado para a lixeira.

```tsx
// imports no topo
import { OmitEscalaModal } from './OmitEscalaModal'
import { TransshipmentPanel } from './TransshipmentPanel'
// estado local
const [omitTarget, setOmitTarget] = useState<string | null>(null)
// ... no JSX da linha do POD (dentro do map de PODs planejados), ao lado da lixeira:
{isAdmin && !podRow.omitted && (
  <button title="Omitir escala" onClick={() => setOmitTarget(podRow.pod)}>⚠︎</button>
)}
// ... perto do fim do card:
{omitTarget && (
  <OmitEscalaModal open onClose={() => setOmitTarget(null)} voyageId={voyage.id}
    omittedPod={omitTarget}
    candidateDischargePods={activePods.filter((p) => p !== omitTarget)} />
)}
<TransshipmentPanel voyageId={voyage.id} />
```

> `activePods` = lista de PODs da viagem com ETA e sem `deleted`/`omitted`. Se essa lista já existe no componente sob outro nome, reutilize-a (`rg "pod" src/components/voyages/VoyageCard.tsx`). `isAdmin` deve reutilizar o gating já presente no arquivo.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Verificação manual (quando houver ambiente)**

Siga a skill `run`/`verify`: abrir uma viagem com dois PODs, omitir um, confirmar (a) o POD some da "próxima escala", (b) surgem B/Ls no painel de transbordo, (c) marcar COD reescreve o POD do B/L. Registre evidência.

- [ ] **Step 5: Commit**

```bash
git add src/components/voyages/VoyageCard.tsx
git commit -m "feat(voyages): aciona omissao de escala e painel de transbordo no card"
```

---

## Phase 5 — Documentação viva (contrato obrigatório)

### Task 11: Atualizar docs, ADR e spec comportamental

**Files:**
- Modify: `CONTEXT.md`, `docs/modules/viagens.md`, `docs/modules/portal-cliente.md`, `docs/modules/chegadas-saidas.md`, `docs/RASTREABILIDADE.md`, `docs/spec/2026-07-02-behavioral-spec.csv`
- Create: `docs/adr/0022-omissao-escala-transbordo-cod-registro-operacional.md` + entrada no `docs/adr/README.md`

- [ ] **Step 1: CONTEXT.md** — adicionar termos na seção "Operação marítima": **Omissão de Escala**, **Transbordo**, **COD (Change of Destination)**, **Porto de Descarga**, com definições alinhadas ao spec (financeiro manual; navio de transbordo como referência leve).

- [ ] **Step 2: docs/modules/viagens.md** — no "Catálogo de ações", adicionar linhas: *Omitir escala*, *Definir transbordo (navio de terceiros)*, *Marcar COD*. Em "Fluxos e invariantes", adicionar: POD omitido é excluído de `getProximaEscala` (em `voyageSummaries.ts`), tratado como não pendente na conclusão da viagem, e não aparece no cronograma do Portal.

- [ ] **Step 3: docs/modules/portal-cliente.md** — registrar o novo `type='transshipment'` de `portal_notifications` e a exclusão de PODs omitidos em `portal_ship_schedule`.

- [ ] **Step 4: docs/modules/chegadas-saidas.md** — nota de que PODs omitidos somem da projeção do cronograma do Portal.

- [ ] **Step 5: docs/RASTREABILIDADE.md** — mapear rota/ação → `transshipments.ts`, `useTransshipments.ts`, `OmitEscalaModal`, `TransshipmentPanel`, tabelas `voyage_omissions`/`bl_transshipments`, migrations 174/175, e os testes desta feature.

- [ ] **Step 6: ADR 0022** — decisão: registro operacional com financeiro manual; navio de transbordo como referência leve (não Viagem); omissão distinta de exclusão de POD; conjunto derivado da escala, disposição por B/L (Transbordo padrão, COD exceção); Portal via notificação. Adicionar a entrada no índice `docs/adr/README.md`.

- [ ] **Step 7: Spec comportamental** — adicionar linhas do novo comportamento em `docs/spec/2026-07-02-behavioral-spec.csv` e regenerar o xlsx: `node scripts/build-behavioral-spec.mjs`.

- [ ] **Step 8: Rodar os checks de documentação**

Run: `npm run docs:check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add CONTEXT.md docs/
git commit -m "docs: omissao de escala, transbordo e COD (contexto, modulos, ADR 0022)"
```

---

## Fechamento

- [ ] **Suite completa e gates**

Run: `npm run lint && npm test && npm run build && npm run docs:check`
Expected: tudo verde. Corrija regressões antes de finalizar.

- [ ] **Push e PR #351**

```bash
git push origin claude/ship-omission-transshipment-flow-efaqs1
```

O PR #351 já existe; os commits desta implementação entram nele. Verifique a CI e responda a review.

---

## Self-Review do plano (feito pelo autor)

**Cobertura do spec** — cada seção do spec tem task:
- §3.1 `voyage_omissions` / §3.2 `bl_transshipments` / §3.3 marcador `omitted` → Task 1.
- §4 integração (getProximaEscala, syncVoyageStatusAfterAtdChange, portal_ship_schedule) → Tasks 2, 4, 5 (+ reconstrução na Task 3).
- §5 fluxo operacional → Tasks 6–10.
- §6 COD (reescrita de `bls.pod`, reversível) → RPC `set_bl_cod`/`set_bl_transshipment` (Task 1) + UI (Task 9).
- §7 Portal (`portal_notifications` tipo novo) → Task 1 (CHECK + inserts); §7 cronograma → Task 2.
- §8 auditoria/timeline → eventos `audit_logs` nas RPCs (Task 1).
- §9 invariantes → CHECKs (Task 1) e funções puras testadas (Tasks 4–5).
- §10 testes → tasks com testes de contrato SQL e unit.
- §11 documentação → Task 11.

**Placeholders:** nenhum passo de código sem código. Passos que dependem de nomes locais do repo (auth hook, `activePods`, objeto `queryKeys`) trazem o comando `rg` para localizar o contrato exato — verificação, não placeholder.

**Consistência de tipos:** `disposition` ∈ {`transshipment`,`cod`} em SQL, serviço (`BlDisposition`), hooks e UI. Nomes de parâmetros das RPCs (`p_*`) idênticos entre migration (Task 1) e serviço (Task 6). `omitted?: boolean` consistente entre `VoyagePodSchedule`, `PodScheduleRow` e `getProximaEscala`.
