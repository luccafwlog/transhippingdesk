# Pendências UX pós-auditoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver as pendências P1/P2/P3 da auditoria UX de 2026-07-20 (`docs/design-audit/README.md`) conforme as decisões do grilling registradas no `CONTEXT.md` (Saldo Pendente e Serviço Extra de Reorganização já atualizados no glossário).

**Architecture:** Correções display-only no cliente React (label maps, formatação, gates de estado) + duas migrations aditivas (219: copy dos alertas pós-ATD com backfill; 220: RPC de nomes dos atores do ADR, no padrão privado da 217) + uma página nova `/embarquevazios/taxas` seguindo o padrão `GraniteRates`. Nenhuma mudança de RLS: `vazios_reorg_rates` permanece admin-write como as demais tabelas tarifárias.

**Tech Stack:** React 18 + TypeScript + TanStack Query + Supabase (PostgREST/RPC) + Vitest/Testing Library + migrations SQL numeradas (ADR 0016).

**Decisões vinculantes (grilling 2026-07-20):**

1. Saldo Pendente da Ficha Cliente soma `issued + overdue + partially_paid` (alinha código ao glossário; era bug, não decisão nova).
2. Alertas pós-ATD: migration corrige a geração da mensagem **e** faz backfill dos alertas não fechados; a mensagem **nomeia o departamento dono**; a coluna Entidade é formatada no cliente ("Viagem 10 · BRVIX · Ocorrências").
3. Atribuição no ADR: RPC única `get_agency_report_actor_names(voyage_id, port)` (mesmo gate da 217, que é absorvida no consumo); sign-off com **texto inline** "Confirmado por {nome} em {data}"; ocorrências com **nome + departamento**.
4. Tarifas de reorganização: página própria **`/embarquevazios/taxas`** (padrão `/granito/taxas`); edição admin-only (RLS atual); "Sem tarifa" no card da operação vira link.
5. Operação da escala: card **sempre visível** em `/embarquevazios`, com `VoyageCombobox` embutido quando não há viagem selecionada.
6. `/veiculos`: ação em massa **"Definir local de desova"** na barra de seleção.
7. Ficha BL, aba Faturamento: com fatura ativa (`chargesLocked`), chip de fase vira **"Faturado"** e os CTAs "Marcar revisado"/"Pronto para faturar" somem; passada de acentos na copy.
8. Lote P3 incluído: TARA pt-BR em `/vazios-importacao`, grid do cabeçalho do ADR, supressão dos cards zerados de "Embarque de vazios", setas dos rails ocultas no mobile.

**Restrições:**

- Branch designada: `claude/ux-review-new-features-jcuduc` (PR #411 aberto). Commits pequenos por task.
- `src/types/database.ts` é protegido — nenhuma task deste plano o altera (a RPC 220 não precisa de tipos gerados: o serviço tipa o retorno localmente).
- **Não** editar migrations existentes (213/214/217/218); 219 e 220 são os próximos números livres.
- Migrations **não** são aplicadas ao Supabase remoto por este plano (o remoto segue o fluxo de deploy do repositório; o plano `2026-07-20-adr-correcoes-pos-implementacao.md` já rastreia a aplicação pendente das 211+ como BLOCKED).
- Verificação final obrigatória: `npm run docs:check && npm run lint && npm test && npm run build`.

**Mapa de arquivos:**

| Arquivo | Responsabilidade |
|---|---|
| `src/services/customerFicha.ts` | agregação do saldo pendente (Task 1) |
| `supabase/migrations/219_agency_report_alert_copy.sql` | labels SQL + detect() legível + backfill (Task 2) |
| `src/services/agencyDepartureReport.ts` | labels TS de seção/departamento; fetch de nomes dos atores (Tasks 3/5) |
| `src/services/alerts.ts` | formatador da entidade do alerta ADR (Task 3) |
| `src/pages/Alertas.tsx` | uso do formatador (Task 3) |
| `supabase/migrations/220_agency_report_actor_names_read.sql` | RPC de nomes (Task 4) |
| `src/components/voyages/VoyageAgencyReportTab.tsx` | atribuição inline, ocorrências com nome, grid do cabeçalho, cards zerados (Tasks 5/10) |
| `src/services/vaziosExportOperations.ts` | CRUD de `vazios_reorg_rates` (Task 6) |
| `src/pages/VaziosReorgRates.tsx` (novo) | página de tarifas (Task 6) |
| `src/App.tsx` | rota `/embarquevazios/taxas` (Task 6) |
| `src/pages/EmbarqueVazios.tsx` | link "Sem tarifa"; card sempre visível (Tasks 6/7) |
| `src/components/shared/BulkActionsBar.tsx` | slot `extraActions` (Task 8) |
| `src/pages/Veiculos.tsx` | desova em massa (Task 8) |
| `src/components/bl/BlCobrancasTab.tsx` | chip Faturado + acentos (Task 9) |
| `src/lib/statusLabels.ts` | `partially_paid` em `FINANCIAL_STATUS_LABELS` (Task 9) |
| `src/pages/VaziosImportacao.tsx` | TARA pt-BR (Task 10) |
| `src/components/bl/BlRailsPipeline.tsx` | setas ocultas no mobile (Task 10) |
| `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`, `docs/design-audit/README.md`, `docs/plans/README.md` | contrato de documentação (Tasks 6/11) |

---

### Task 1: Saldo Pendente da Ficha Cliente

**Files:**
- Modify: `src/services/customerFicha.ts:28-36`
- Test: `src/services/__tests__/customerFicha.test.ts:8-15`

- [ ] **Step 1: Atualizar o teste para a nova semântica (falhará)**

Substituir o bloco `describe('buildConsolidatedBalance', ...)` em `src/services/__tests__/customerFicha.test.ts` por:

```ts
describe('buildConsolidatedBalance', () => {
  it('soma local emitido não pago (emitida, vencida e parcial) + demurrage não pago', () => {
    expect(buildConsolidatedBalance(
      [
        { status: 'issued', balance_brl: 100 },
        { status: 'overdue', balance_brl: 300 },
        { status: 'partially_paid', balance_brl: 40 },
        { status: 'paid', balance_brl: 999 },
        { status: 'cancelled', balance_brl: 999 },
      ],
      [{ status: 'issued', current_total_brl: 50 }, { status: 'overdue', current_total_brl: 25 }, { status: 'paid', current_total_brl: 999 }, { status: 'cancelled', current_total_brl: 999 }],
    )).toEqual({ localBrl: 440, demurrageBrl: 75, totalBrl: 515 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/services/__tests__/customerFicha.test.ts`
Expected: FAIL (`localBrl` recebe 100, esperado 440).

- [ ] **Step 3: Implementar**

Em `src/services/customerFicha.ts`, substituir:

```ts
export type ConsolidatedBalance = { localBrl: number; demurrageBrl: number; totalBrl: number }
const UNPAID_DEMURRAGE_STATUSES = new Set(['issued', 'overdue'])

export function buildConsolidatedBalance(
  localInvoices: Array<{ status: string | null; balance_brl: number | null }>,
  demurrageInvoices: Array<{ status: string | null; current_total_brl: number | null }>,
): ConsolidatedBalance {
  // Local pending_balance historically counts only issued invoices; overdue is surfaced separately as a pendency.
  const localBrl = localInvoices.filter((row) => row.status === 'issued').reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0)
```

por:

```ts
export type ConsolidatedBalance = { localBrl: number; demurrageBrl: number; totalBrl: number }
const UNPAID_DEMURRAGE_STATUSES = new Set(['issued', 'overdue'])
// Glossário (CONTEXT.md, "Saldo Pendente do Cliente"): emitidas e ainda não
// pagas — inclui vencidas e parcialmente pagas, pelo saldo restante.
const UNPAID_LOCAL_STATUSES = new Set(['issued', 'overdue', 'partially_paid'])

export function buildConsolidatedBalance(
  localInvoices: Array<{ status: string | null; balance_brl: number | null }>,
  demurrageInvoices: Array<{ status: string | null; current_total_brl: number | null }>,
): ConsolidatedBalance {
  const localBrl = localInvoices.filter((row) => UNPAID_LOCAL_STATUSES.has(row.status ?? '')).reduce((sum, row) => sum + Number(row.balance_brl ?? 0), 0)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/services/__tests__/customerFicha.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/customerFicha.ts src/services/__tests__/customerFicha.test.ts
git commit -m "fix(clientes): saldo pendente soma vencidas e parciais conforme glossario"
```

---

### Task 2: Migration 219 — copy legível dos alertas pós-ATD + backfill

**Files:**
- Create: `supabase/migrations/219_agency_report_alert_copy.sql`
- Test: `src/services/__tests__/agencyReportAlertCopyMigration.test.ts` (novo)

- [ ] **Step 1: Escrever o teste da migration (falhará por arquivo ausente)**

Criar `src/services/__tests__/agencyReportAlertCopyMigration.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/219_agency_report_alert_copy.sql')

describe('migration 219 — copy legível dos alertas pós-ATD do ADR', () => {
  it('gera mensagem com labels pt-BR e nomeia o departamento dono', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.agency_report_section_label/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.agency_report_department_label/)
    expect(sql).toMatch(/WHEN 'vazios_embarcados' THEN 'Vazios embarcados'/)
    expect(sql).toMatch(/WHEN 'documentacao' THEN 'Documentação'/)

    const detect = sql.match(/CREATE OR REPLACE FUNCTION public\.detect_agency_report_pending[\s\S]*?\$function\$;/i)?.[0] ?? ''
    expect(detect).toContain('SECURITY DEFINER')
    expect(detect).toMatch(/agency_report_section_label\(p\.section\)/)
    expect(detect).toMatch(/agency_report_department_label\(public\.agency_report_section_owner\(p\.section\)\)/)
    expect(detect).toContain('seção "')
    expect(detect).toContain('pendente — ')
    // Preserva o contrato da 214: baseline, dedupe e entity_id compostos.
    expect(detect).toMatch(/changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00\+00'/)
    expect(detect).toMatch(/a\.status <> 'closed'/)

    // Backfill só reescreve alertas não fechados do tipo, derivando do entity_id.
    expect(sql).toMatch(/UPDATE public\.alerts[\s\S]*type = 'agency_report_section_pending'[\s\S]*status <> 'closed'/)
    expect(sql).toMatch(/split_part\(entity_id, '::', 2\)/)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/services/__tests__/agencyReportAlertCopyMigration.test.ts`
Expected: FAIL (`existsSync` → false).

- [ ] **Step 3: Criar a migration**

Criar `supabase/migrations/219_agency_report_alert_copy.sql`. A função `detect_agency_report_pending()` é a da migration 214 **na íntegra**, mudando apenas a expressão da mensagem; helpers de label são `IMMUTABLE` para reuso no backfill:

```sql
-- Agency Departure Report: mensagens legíveis nos alertas de pendência pós-ATD.
-- Intent: a mensagem direciona o departamento dono (ADR 0027); chave crua de
-- seção e papel em código minavam a leitura. Reescreve a geração e faz
-- backfill dos alertas ainda não fechados. entity_id permanece máquina
-- (voyageId::porto::secao) — é contrato de dedupe/fechamento e de deep-link.
-- Rollback: reaplicar a definição de detect_agency_report_pending() da
-- migration 214 e DROP das duas funções de label.

CREATE OR REPLACE FUNCTION public.agency_report_section_label(p_section TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'datas' THEN 'Datas'
    WHEN 'carga_descarregada' THEN 'Carga descarregada'
    WHEN 'carga_carregada' THEN 'Carga carregada'
    WHEN 'veiculos' THEN 'Veículos'
    WHEN 'vazios_embarcados' THEN 'Vazios embarcados'
    WHEN 'vazios_descarregados' THEN 'Vazios descarregados'
    WHEN 'ocorrencias' THEN 'Ocorrências'
    ELSE p_section
  END;
$$;

CREATE OR REPLACE FUNCTION public.agency_report_department_label(p_department TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_department
    WHEN 'operacoes' THEN 'Operações'
    WHEN 'documentacao' THEN 'Documentação'
    WHEN 'equipamentos' THEN 'Equipamentos'
    ELSE COALESCE(p_department, '—')
  END;
$$;

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
    SELECT DISTINCT ON (entity_id) entity_id, new_value, changed_at
    FROM public.audit_logs
    WHERE entity_type = 'voyage_pod_schedule' AND field_name = 'atd'
    ORDER BY entity_id, changed_at DESC
  ),
  departed AS (
    SELECT
      split_part(entity_id, '::', 1)::BIGINT AS voyage_id,
      upper(trim(split_part(entity_id, '::', 2))) AS port
    FROM latest_atd
    WHERE COALESCE(trim(new_value), '') <> ''
      -- Evita criar pendências retroativas na primeira detecção após o deploy.
      AND changed_at >= TIMESTAMPTZ '2026-07-19 00:00:00+00'
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
      'ADR ' || p.port || ': seção "' || public.agency_report_section_label(p.section)
        || '" pendente — '
        || public.agency_report_department_label(public.agency_report_section_owner(p.section)) || '.',
      'open'
    FROM pending p
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.alerts a
      WHERE a.type = 'agency_report_section_pending'
        AND a.entity_type = 'agency_departure_report'
        AND a.entity_id = p.voyage_id || '::' || p.port || '::' || p.section
        AND a.status <> 'closed'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.agency_report_section_label(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agency_report_department_label(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_report_section_label(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agency_report_department_label(TEXT) TO authenticated;

-- Backfill: reescreve a mensagem dos alertas ainda não fechados a partir do
-- entity_id (voyageId::porto::secao). Alertas fechados são histórico.
UPDATE public.alerts
SET message = 'ADR ' || split_part(entity_id, '::', 2) || ': seção "'
  || public.agency_report_section_label(split_part(entity_id, '::', 3))
  || '" pendente — '
  || public.agency_report_department_label(public.agency_report_section_owner(split_part(entity_id, '::', 3)))
  || '.'
WHERE type = 'agency_report_section_pending'
  AND entity_type = 'agency_departure_report'
  AND status <> 'closed';
```

- [ ] **Step 4: Rodar o teste da migration e aplicar no Postgres local**

Run: `npx vitest run src/services/__tests__/agencyReportAlertCopyMigration.test.ts`
Expected: PASS.

Aplicar localmente (o stack da auditoria usa DB `app`; iniciar com `pg_ctlcluster 16 main start` se preciso):

```bash
su postgres -c "psql -d app -v ON_ERROR_STOP=1 -f '$(pwd)/supabase/migrations/219_agency_report_alert_copy.sql'"
su postgres -c "psql -d app -tAc \"select message from alerts where type='agency_report_section_pending' limit 2\""
```

Expected: mensagens no formato `ADR BRVIX: seção "Ocorrências" pendente — Operações.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/219_agency_report_alert_copy.sql src/services/__tests__/agencyReportAlertCopyMigration.test.ts
git commit -m "feat(alertas): mensagens legiveis nas pendencias pos-ATD do ADR com backfill"
```

---

### Task 3: Entidade formatada nos alertas do ADR (cliente)

**Files:**
- Modify: `src/services/agencyDepartureReport.ts` (novo export de labels)
- Modify: `src/services/alerts.ts` (novo formatador)
- Modify: `src/pages/Alertas.tsx:154-160` (célula Entidade)
- Test: `src/services/__tests__/alertsEntityFormat.test.ts` (novo)

- [ ] **Step 1: Teste do formatador (falhará)**

Criar `src/services/__tests__/alertsEntityFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatAgencyReportAlertEntity } from '../alerts'

describe('formatAgencyReportAlertEntity', () => {
  it('formata voyageId::porto::secao para leitura humana', () => {
    expect(formatAgencyReportAlertEntity('10::BRVIX::vazios_embarcados')).toBe('Viagem 10 · BRVIX · Vazios embarcados')
    expect(formatAgencyReportAlertEntity('10::BRVIX::ocorrencias')).toBe('Viagem 10 · BRVIX · Ocorrências')
  })

  it('cai para null quando o formato não é o composto do ADR', () => {
    expect(formatAgencyReportAlertEntity('qualquer-coisa')).toBeNull()
    expect(formatAgencyReportAlertEntity('')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/services/__tests__/alertsEntityFormat.test.ts`
Expected: FAIL (export inexistente).

- [ ] **Step 3: Implementar labels TS e formatador**

Em `src/services/agencyDepartureReport.ts`, logo após o mapa `AGENCY_REPORT_SECTIONS` existente, adicionar:

```ts
// Labels pt-BR das seções e departamentos do ADR — espelham as funções SQL
// agency_report_section_label/agency_report_department_label (migration 219).
export const AGENCY_REPORT_SECTION_LABELS: Record<AgencyReportSection, string> = {
  datas: 'Datas',
  carga_descarregada: 'Carga descarregada',
  carga_carregada: 'Carga carregada',
  veiculos: 'Veículos',
  vazios_embarcados: 'Vazios embarcados',
  vazios_descarregados: 'Vazios descarregados',
  ocorrencias: 'Ocorrências',
}

export const AGENCY_REPORT_DEPARTMENT_LABELS: Record<string, string> = {
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}
```

Em `src/services/alerts.ts`, adicionar (com import no topo):

```ts
import { AGENCY_REPORT_SECTION_LABELS } from './agencyDepartureReport'

// entity_id dos alertas do ADR é composto (voyageId::porto::secao) — contrato
// de dedupe/fechamento. Este formatador é só apresentação para a página Alertas.
export function formatAgencyReportAlertEntity(entityId: string): string | null {
  const [voyageId, port, section] = entityId.split('::')
  if (!voyageId || !port || !section) return null
  const sectionLabel = (AGENCY_REPORT_SECTION_LABELS as Record<string, string>)[section] ?? section
  return `Viagem ${voyageId} · ${port} · ${sectionLabel}`
}
```

- [ ] **Step 4: Usar na página**

Em `src/pages/Alertas.tsx`, importar `formatAgencyReportAlertEntity` de `../services/alerts` e substituir o conteúdo da célula Entidade:

```tsx
<td className="px-4 py-3 text-[var(--app-muted)]">
  {alert.entity_type === 'agency_departure_report' && alert.entity_id && formatAgencyReportAlertEntity(alert.entity_id) ? (
    <span className="text-xs">{formatAgencyReportAlertEntity(alert.entity_id)}</span>
  ) : alert.entity_type ? (
    <span className="font-mono text-xs">
      {ENTITY_TYPE_LABELS[alert.entity_type] ?? alert.entity_type}
      {alert.entity_id ? ` ${alert.entity_id}` : ''}
    </span>
  ) : (
```

(manter o restante do ternário original intacto).

- [ ] **Step 5: Rodar testes e verificar tipos**

Run: `npx vitest run src/services/__tests__/alertsEntityFormat.test.ts && npx tsc -b`
Expected: PASS / sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/services/agencyDepartureReport.ts src/services/alerts.ts src/pages/Alertas.tsx src/services/__tests__/alertsEntityFormat.test.ts
git commit -m "feat(alertas): entidade do ADR formatada para leitura humana"
```

---

### Task 4: Migration 220 — RPC de nomes dos atores do ADR

**Files:**
- Create: `supabase/migrations/220_agency_report_actor_names_read.sql`
- Test: `src/services/__tests__/agencyReportActorNamesMigration.test.ts` (novo)

- [ ] **Step 1: Teste da migration (falhará)**

Criar `src/services/__tests__/agencyReportActorNamesMigration.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/220_agency_report_actor_names_read.sql')

describe('migration 220 — nomes dos atores do ADR', () => {
  it('expõe apenas os nomes dos atores de um ADR legível pelo usuário', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')
    const body = sql.match(/CREATE OR REPLACE FUNCTION public\.get_agency_report_actor_names[\s\S]*?\$function\$;/i)?.[0] ?? ''

    expect(body).toContain('SECURITY DEFINER')
    expect(body).toContain('SET search_path = public, pg_temp')
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR NOT public\.is_active_read_user\(\)/)
    expect(body).toMatch(/RETURNS TABLE \(user_id UUID, full_name TEXT\)/)
    // Atores: quem fechou, quem assinou seções e quem lançou ocorrências.
    expect(body).toMatch(/closed_by/)
    expect(body).toMatch(/agency_departure_report_signoffs/)
    expect(body).toMatch(/agency_departure_report_occurrences/)
    // Nunca abre user_profiles arbitrariamente: filtra pelo conjunto de atores.
    expect(body).not.toMatch(/FROM public\.user_profiles up\s*;/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_agency_report_actor_names\(BIGINT, TEXT\) FROM PUBLIC, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_agency_report_actor_names\(BIGINT, TEXT\) TO authenticated/)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/services/__tests__/agencyReportActorNamesMigration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Criar a migration**

Criar `supabase/migrations/220_agency_report_actor_names_read.sql`:

```sql
-- Agency Departure Report: nomes dos atores (sign-offs, ocorrências e
-- fechamento) em uma chamada única.
-- Intent: mesma justificativa da migration 217 — user_profiles permanece
-- restrita; esta RPC resolve somente os nomes dos atores de um ADR que o
-- solicitante pode ler. Generaliza a 217 (que permanece no schema por
-- compatibilidade; o cliente passa a consumir apenas esta).
-- Rollback: DROP FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT).

CREATE OR REPLACE FUNCTION public.get_agency_report_actor_names(
  p_voyage_id BIGINT,
  p_port TEXT
)
RETURNS TABLE (user_id UUID, full_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  -- Espelha a policy SELECT de agency_departure_reports: quem nao pode ler o
  -- ADR tambem nao pode resolver os perfis dos seus atores.
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port));

  IF v_report_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT up.id, up.full_name
  FROM public.user_profiles up
  WHERE up.id IN (
    SELECT r.closed_by FROM public.agency_departure_reports r
    WHERE r.id = v_report_id AND r.closed_by IS NOT NULL
    UNION
    SELECT so.signed_by FROM public.agency_departure_report_signoffs so
    WHERE so.report_id = v_report_id AND so.signed_by IS NOT NULL
    UNION
    SELECT oc.author_id FROM public.agency_departure_report_occurrences oc
    WHERE oc.report_id = v_report_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_report_actor_names(BIGINT, TEXT) TO authenticated;
```

- [ ] **Step 4: Rodar teste e aplicar localmente**

Run: `npx vitest run src/services/__tests__/agencyReportActorNamesMigration.test.ts`
Expected: PASS.

```bash
su postgres -c "psql -d app -v ON_ERROR_STOP=1 -f '$(pwd)/supabase/migrations/220_agency_report_actor_names_read.sql'"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/220_agency_report_actor_names_read.sql src/services/__tests__/agencyReportActorNamesMigration.test.ts
git commit -m "feat(adr): RPC unica de nomes dos atores do relatorio"
```

---

### Task 5: Atribuição na UI do ADR (sign-offs inline + ocorrências com nome)

**Files:**
- Modify: `src/services/agencyDepartureReport.ts:37-69` (`getAgencyReportOwnData`)
- Modify: `src/components/voyages/VoyageAgencyReportTab.tsx` (ReportSection + ocorrências)
- Test: `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`

- [ ] **Step 1: Estender o teste do componente (falhará)**

Em `src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`, no teste `'exibe o progresso, sign-off da seção do usuário e ocorrências do relatório'`, atualizar o mock de `useAgencyReportOwnMock` para:

```ts
useAgencyReportOwnMock.mockReturnValue({
  data: {
    terminal: 'TVV',
    signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed', signed_by: 'user-1', signed_at: '2026-07-19T12:00:00Z' }],
    occurrences: [{ id: 'occ-1', body: 'Atracação concluída.', department: 'operacoes', author_id: 'user-1', created_at: '2026-07-19T10:00:00Z' }],
    actor_names: { 'user-1': 'Ana Ribeiro' },
  },
```

e acrescentar ao final do mesmo teste:

```ts
expect(screen.getByText(/Confirmado por Ana Ribeiro em 19\/07\/2026/)).toBeTruthy()
expect(screen.getByText(/Ana Ribeiro \(Operações\) · 19\/07\/2026/)).toBeTruthy()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx`
Expected: FAIL nos dois novos asserts.

- [ ] **Step 3: Serviço — absorver a 217 e devolver `actor_names`**

Em `src/services/agencyDepartureReport.ts`, alterar o tipo e a função:

```ts
export type AgencyReportOwnData = AgencyDepartureReport & {
  signoffs: AgencyReportSignoff[]
  occurrences: AgencyReportOccurrence[]
  closed_by_name?: string | null
  actor_names?: Record<string, string>
}

export async function getAgencyReportOwnData(voyageId: number, port: string) {
  const { data, error } = await supabase
    .from('agency_departure_reports')
    .select('*, signoffs:agency_departure_report_signoffs(*), occurrences:agency_departure_report_occurrences(*)')
    .eq('voyage_id', voyageId)
    .eq('port', port)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const report = data as unknown as AgencyReportOwnData

  // Nomes de todos os atores (sign-offs, ocorrências, fechamento) em uma
  // chamada; absorve get_agency_report_closer_name (migration 217 → 220).
  let actorNames: Record<string, string> = {}
  const { data: actorRows, error: actorError } = await supabase.rpc('get_agency_report_actor_names', {
    p_voyage_id: voyageId,
    p_port: port,
  })
  if (actorError) {
    // A RPC pode estar ausente no remoto (migration 220 pendente); o ADR
    // continua legível, só sem os nomes resolvidos.
    console.error('[agencyDepartureReport] erro ao resolver nomes dos atores:', actorError.message)
  } else if (Array.isArray(actorRows)) {
    for (const row of actorRows as Array<{ user_id?: string; full_name?: string | null }>) {
      if (row.user_id && row.full_name) actorNames[row.user_id] = row.full_name
    }
  }

  return {
    ...report,
    actor_names: actorNames,
    closed_by_name: report.closed_by ? actorNames[report.closed_by] ?? null : null,
  }
}
```

(Remover o bloco anterior que chamava `get_agency_report_closer_name`; a função permanece no banco, apenas deixa de ser consumida.)

Nota de tipos: `supabase.rpc('get_agency_report_actor_names', ...)` não existe nos tipos gerados (arquivo protegido não será alterado). Usar o mesmo desvio já usado em `customerFicha.ts` para `get_customer_receivables`:

```ts
const { data: actorRows, error: actorError } = await (supabase.rpc as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: Array<{ user_id?: string; full_name?: string | null }> | null; error: { message?: string | null } | null }>)('get_agency_report_actor_names', {
  p_voyage_id: voyageId,
  p_port: port,
})
```

- [ ] **Step 4: UI — atribuição inline nas seções e nome nas ocorrências**

Em `src/components/voyages/VoyageAgencyReportTab.tsx`:

1. Importar os labels:

```ts
import { AGENCY_REPORT_SECTIONS, AGENCY_REPORT_DEPARTMENT_LABELS, buildContainerTypeMatrix, groupVehiclesByBrand, type AgencyReportSection } from '../../services/agencyDepartureReport'
```

2. `ReportSection` ganha a prop opcional `attribution` e a renderiza junto ao chip:

```tsx
function ReportSection({
  title,
  section,
  state,
  attribution,
  canSignoff,
  onSignoff,
  children,
}: {
  title: string
  section?: AgencyReportSection
  state?: keyof typeof signoffLabels
  attribution?: string | null
  canSignoff?: boolean
  onSignoff?: (section: AgencyReportSection, state: keyof typeof signoffLabels) => void
  children: ReactNode
}) {
  return (
    <section className="app-panel app-panel--padded grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="app-panel__title text-base">{title}</h3>
        {section && state ? <div className="flex flex-wrap items-center gap-2">
          {attribution ? <span className="text-xs text-[var(--app-muted)]">{attribution}</span> : null}
          <span className="rounded-full border border-[var(--app-border)] px-2 py-1 text-xs font-semibold">{signoffLabels[state]}</span>
          {canSignoff ? (Object.entries(signoffLabels) as Array<[keyof typeof signoffLabels, string]>).filter(([next]) => next !== state).map(([next, label]) => (
            <button key={next} type="button" className="rounded border border-[var(--app-border)] px-2 py-1 text-xs" onClick={() => onSignoff?.(section, next)}>{label}</button>
          )) : null}
        </div> : null}
      </div>
      {children}
    </section>
  )
}
```

3. No corpo de `VoyageAgencyReportTab`, após a linha `const sectionState = ...`, adicionar:

```ts
const actorNames = ownData?.actor_names ?? {}
const signoffRows = new Map((ownData?.signoffs ?? []).map((signoff) => [signoff.section, signoff]))
const sectionAttribution = (section: AgencyReportSection): string | null => {
  const signoff = signoffRows.get(section)
  if (!signoff || signoff.state === 'pending' || !signoff.signed_at) return null
  const name = (signoff.signed_by && actorNames[signoff.signed_by]) || null
  return `${signoffLabels[signoff.state]} por ${name ?? '—'} em ${formatDate(signoff.signed_at)}`
}
```

4. Em **cada** um dos 7 `<ReportSection ...>` do estado aberto, acrescentar a prop `attribution={sectionAttribution('<secao>')}` com a mesma chave já passada em `section` (ex.: `<ReportSection title="Cabeçalho" section="datas" state={sectionState('datas')} attribution={sectionAttribution('datas')} ...>`).

5. Nas ocorrências (linha do `.map` dentro da seção "Ocorrências"), trocar o rodapé:

```tsx
<span className="text-xs text-[var(--app-muted)]">{(item.author_id && actorNames[item.author_id]) ? `${actorNames[item.author_id]} (${AGENCY_REPORT_DEPARTMENT_LABELS[item.department] ?? item.department})` : (AGENCY_REPORT_DEPARTMENT_LABELS[item.department] ?? item.department)} · {formatDate(item.created_at)}</span>
```

- [ ] **Step 5: Rodar testes e tipos**

Run: `npx vitest run src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx src/services/__tests__/agencyDepartureReport.test.ts && npx tsc -b`
Expected: PASS (se `agencyDepartureReport.test.ts` mockar a RPC antiga, atualizar o mock para `get_agency_report_actor_names` devolvendo `[{ user_id, full_name }]`).

- [ ] **Step 6: Commit**

```bash
git add src/services/agencyDepartureReport.ts src/components/voyages/VoyageAgencyReportTab.tsx src/components/voyages/__tests__/VoyageAgencyReportTab.test.tsx src/services/__tests__/agencyDepartureReport.test.ts
git commit -m "feat(adr): atribuicao de sign-offs e ocorrencias com nome do autor"
```

---

### Task 6: Página `/embarquevazios/taxas` (tarifas de reorganização)

**Files:**
- Modify: `src/services/vaziosExportOperations.ts` (CRUD)
- Create: `src/pages/VaziosReorgRates.tsx`
- Modify: `src/App.tsx` (lazy import + rota)
- Modify: `src/pages/EmbarqueVazios.tsx:590` (link no "Sem tarifa")
- Modify: `docs/ARCHITECTURE.md` (tabela de rotas), `docs/RASTREABILIDADE.md` (linha da rota)
- Test: `src/pages/__tests__/VaziosReorgRates.behavior.test.tsx` (novo)

- [ ] **Step 1: CRUD no serviço**

Em `src/services/vaziosExportOperations.ts`, após `listActiveReorgRates`, adicionar:

```ts
export async function listVaziosReorgRates(): Promise<VaziosReorgRate[]> {
  const { data, error } = await supabase
    .from('vazios_reorg_rates')
    .select('*')
    .order('service', { ascending: true })
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as VaziosReorgRate[]
}

export async function upsertVaziosReorgRate(input: {
  id?: string
  service: VaziosReorgServiceType
  rate_brl: number
  active: boolean
  valid_from: string
  valid_to: string | null
}): Promise<void> {
  if (!(input.rate_brl >= 0)) throw new Error('Tarifa deve ser um valor não negativo.')
  if (input.valid_to && input.valid_to < input.valid_from) throw new Error('Vigência final anterior à inicial.')
  const payload = {
    service: input.service,
    rate_brl: input.rate_brl,
    active: input.active,
    valid_from: input.valid_from,
    valid_to: input.valid_to,
  }
  const query = input.id
    ? supabase.from('vazios_reorg_rates').update(payload).eq('id', input.id)
    : supabase.from('vazios_reorg_rates').insert(payload)
  const { error } = await query
  if (error) throw error
}

export async function deleteVaziosReorgRate(id: string): Promise<void> {
  const { error } = await supabase.from('vazios_reorg_rates').delete().eq('id', id)
  if (error) throw error
}
```

(`VaziosReorgServiceType` já é importado no arquivo.)

- [ ] **Step 2: Teste de comportamento da página (falhará)**

Criar `src/pages/__tests__/VaziosReorgRates.behavior.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const { listRatesMock, useAuthMock } = vi.hoisted(() => ({
  listRatesMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../services/vaziosExportOperations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listVaziosReorgRates: listRatesMock,
  upsertVaziosReorgRate: vi.fn(),
  deleteVaziosReorgRate: vi.fn(),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: useAuthMock }))

const { VaziosReorgRates } = await import('../VaziosReorgRates')

afterEach(cleanup)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VaziosReorgRates />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('lista as tarifas com labels pt-BR e valor em BRL', async () => {
  useAuthMock.mockReturnValue({ isAdmin: true })
  listRatesMock.mockResolvedValue([
    { id: 'r1', service: 'bundle', rate_brl: 150, active: true, valid_from: '2026-07-01', valid_to: null, created_at: '2026-07-01T00:00:00Z' },
    { id: 'r2', service: 'visual_check', rate_brl: 80.5, active: false, valid_from: '2026-06-01', valid_to: '2026-06-30', created_at: '2026-06-01T00:00:00Z' },
  ])

  renderPage()

  expect(await screen.findByText('Bundle')).toBeTruthy()
  expect(screen.getByText('Visual check')).toBeTruthy()
  expect(screen.getByText('R$ 150,00')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Nova tarifa/ })).toBeTruthy()
})

it('sem admin, a página é somente leitura', async () => {
  useAuthMock.mockReturnValue({ isAdmin: false })
  listRatesMock.mockResolvedValue([])

  renderPage()

  expect(await screen.findByText(/Nenhuma tarifa cadastrada/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Nova tarifa/ })).toBeNull()
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/pages/__tests__/VaziosReorgRates.behavior.test.tsx`
Expected: FAIL (módulo `../VaziosReorgRates` inexistente).

- [ ] **Step 4: Criar a página**

Criar `src/pages/VaziosReorgRates.tsx` (modelada em `GraniteRates.tsx`; labels de serviço vêm do array `REORG_SERVICES` já definido em `EmbarqueVazios.tsx` — duplicar o array local aqui é aceitável para não criar acoplamento entre páginas; manter os mesmos labels):

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, InlineError, PageHeader } from '../components/ui/Card'
import { Field, Input, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../hooks/useAuth'
import { deleteVaziosReorgRate, listVaziosReorgRates, upsertVaziosReorgRate } from '../services/vaziosExportOperations'
import { formatBRL, formatDate } from '../lib/utils'
import type { VaziosReorgRate, VaziosReorgServiceType } from '../types/database'

const SERVICE_LABELS: Record<VaziosReorgServiceType, string> = {
  bundle: 'Bundle',
  desova: 'Desova',
  visual_check: 'Visual check',
}

type Form = {
  id?: string
  service: VaziosReorgServiceType
  rate_brl: number
  active: boolean
  valid_from: string
  valid_to: string
}

const EMPTY_FORM: Form = { service: 'bundle', rate_brl: 0, active: true, valid_from: new Date().toISOString().slice(0, 10), valid_to: '' }

export function VaziosReorgRates() {
  const queryClient = useQueryClient()
  const { isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: rates, isLoading, error } = useQuery({ queryKey: ['vazios-reorg-rates'], queryFn: listVaziosReorgRates })

  function openNew() {
    setForm({ ...EMPTY_FORM })
    setModalOpen(true)
  }

  function openEdit(rate: VaziosReorgRate) {
    setForm({ id: rate.id, service: rate.service as VaziosReorgServiceType, rate_brl: Number(rate.rate_brl), active: rate.active, valid_from: rate.valid_from, valid_to: rate.valid_to ?? '' })
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await upsertVaziosReorgRate({ id: form.id, service: form.service, rate_brl: Number(form.rate_brl), active: form.active, valid_from: form.valid_from, valid_to: form.valid_to || null })
      await queryClient.invalidateQueries({ queryKey: ['vazios-reorg-rates'] })
      showToast('Tarifa salva.', 'success')
      setModalOpen(false)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar tarifa.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Excluir esta tarifa?', tone: 'danger', confirmLabel: 'Excluir' }))) return
    setDeletingId(id)
    try {
      await deleteVaziosReorgRate(id)
      await queryClient.invalidateQueries({ queryKey: ['vazios-reorg-rates'] })
      showToast('Tarifa excluída.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao excluir tarifa.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Tarifas de Reorganização — Vazios"
        description="Tarifa vigente por serviço (bundle, desova, visual check) usada na operação da escala de Vazios — Exportação. Valor aplicado como quantidade × tarifa."
        action={isAdmin ? (
          <Button onClick={openNew}>
            <Plus size={16} />
            Nova tarifa
          </Button>
        ) : null}
      />

      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar tarifas." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Serviço</th>
                <th scope="col" className="px-4 py-3">Tarifa (BRL)</th>
                <th scope="col" className="px-4 py-3">Vigência</th>
                <th scope="col" className="px-4 py-3">Ativa</th>
                {isAdmin ? <th scope="col" className="px-4 py-3">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-4 text-[var(--app-muted)]">Carregando…</td></tr>
              ) : (rates ?? []).length === 0 ? (
                <tr><td colSpan={isAdmin ? 5 : 4} className="px-4 py-4 text-[var(--app-muted)]">Nenhuma tarifa cadastrada. Sem tarifa ativa, os serviços de reorganização aparecem como "Sem tarifa" na operação da escala.</td></tr>
              ) : (rates ?? []).map((rate) => (
                <tr key={rate.id}>
                  <td className="px-4 py-3 font-medium">{SERVICE_LABELS[rate.service as VaziosReorgServiceType] ?? rate.service}</td>
                  <td className="px-4 py-3">{formatBRL(Number(rate.rate_brl))}</td>
                  <td className="px-4 py-3">{formatDate(rate.valid_from)}{rate.valid_to ? ` — ${formatDate(rate.valid_to)}` : ' — sem término'}</td>
                  <td className="px-4 py-3">{rate.active ? 'Sim' : 'Não'}</td>
                  {isAdmin ? (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => openEdit(rate)}>Editar</Button>
                        <Button variant="danger" onClick={() => void handleDelete(rate.id)} loading={deletingId === rate.id} aria-label={`Excluir tarifa de ${SERVICE_LABELS[rate.service as VaziosReorgServiceType] ?? rate.service}`}>
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} title={form.id ? 'Editar tarifa' : 'Nova tarifa'} onClose={() => setModalOpen(false)}>
        <div className="grid gap-3">
          <Field label="Serviço">
            <Select value={form.service} onChange={(event) => setForm((f) => ({ ...f, service: event.target.value as VaziosReorgServiceType }))}>
              {(Object.entries(SERVICE_LABELS) as Array<[VaziosReorgServiceType, string]>).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tarifa (BRL)">
            <Input type="number" min={0} step="0.01" value={form.rate_brl} onChange={(event) => setForm((f) => ({ ...f, rate_brl: Number(event.target.value) }))} />
          </Field>
          <Field label="Vigência inicial">
            <Input type="date" value={form.valid_from} onChange={(event) => setForm((f) => ({ ...f, valid_from: event.target.value }))} />
          </Field>
          <Field label="Vigência final (opcional)">
            <Input type="date" value={form.valid_to} onChange={(event) => setForm((f) => ({ ...f, valid_to: event.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm((f) => ({ ...f, active: event.target.checked }))} />
            Ativa
          </label>
          <Button onClick={() => void handleSave()} loading={saving}>Salvar</Button>
        </div>
      </Modal>
    </>
  )
}
```

- [ ] **Step 5: Rota + link**

Em `src/App.tsx`, junto aos demais `lazyPage` (perto de `GraniteRates`):

```ts
const VaziosReorgRates = lazyPage(() => import('./pages/VaziosReorgRates'), 'VaziosReorgRates')
```

e a rota, logo após `/embarquevazios`:

```tsx
<Route path="/embarquevazios/taxas" element={withSuspense(<VaziosReorgRates />)} />
```

Em `src/pages/EmbarqueVazios.tsx` linha ~590, trocar a célula:

```tsx
<td className="px-3 py-2">{rate == null ? <Link className="app-table__action" to="/embarquevazios/taxas">Sem tarifa</Link> : formatBRL(rate)}</td>
```

(adicionar `import { Link } from 'react-router-dom'` — o arquivo hoje importa só `useSearchParams` de `react-router-dom`; unificar no mesmo import.)

- [ ] **Step 6: Documentação de rota (contrato)**

Em `docs/ARCHITECTURE.md`, na tabela de rotas, adicionar após a linha de `/embarquevazios`:

```md
| `/embarquevazios/taxas` | Tarifas de reorganização de vazios |
```

Em `docs/RASTREABILIDADE.md`, adicionar após a linha 81 (`/embarquevazios`):

```md
| `/embarquevazios/taxas` | Cadastrar tarifas de serviços de reorganização de vazios (admin) | `src/pages/VaziosReorgRates.tsx` | `vaziosExportOperations.ts` | `vazios_reorg_rates` (RLS escrita admin, migration `211`) | Tarifa única por serviço com vigência; valor da operação = quantidade × tarifa ativa | **Código**, **Teste** | [Manifestos e EDI](modules/manifesto-edi.md#catálogo-de-ações) |
```

- [ ] **Step 7: Rodar testes, docs e tipos**

Run: `npx vitest run src/pages/__tests__/VaziosReorgRates.behavior.test.tsx && npx tsc -b && npm run docs:check`
Expected: PASS / sem erros / docs OK (rota nova coberta).

- [ ] **Step 8: Commit**

```bash
git add src/pages/VaziosReorgRates.tsx src/pages/__tests__/VaziosReorgRates.behavior.test.tsx src/services/vaziosExportOperations.ts src/App.tsx src/pages/EmbarqueVazios.tsx docs/ARCHITECTURE.md docs/RASTREABILIDADE.md
git commit -m "feat(vazios): pagina de tarifas de reorganizacao em /embarquevazios/taxas"
```

---

### Task 7: Operação da escala sempre visível

**Files:**
- Modify: `src/pages/EmbarqueVazios.tsx:418-436`

- [ ] **Step 1: Trocar o gate do card**

O card hoje está sob `{filters.voyageId ? (<Card>…</Card>) : null}`. Remover o condicional externo: o `<Card className="mb-5">` renderiza **sempre**. Dentro dele, logo após o cabeçalho (`<h2>Operação da escala</h2>` + subtítulo + hint de salvamento), envolver todo o conteúdo existente (grid de Porto/OS/Bookings + seções) em `{filters.voyageId ? (…conteúdo atual…) : (…seletor…)}` com o ramo vazio:

```tsx
{!filters.voyageId ? (
  <div className="mt-5 grid max-w-md gap-2">
    <VoyageCombobox
      label="Viagem"
      selectedVoyageId={null}
      onSelect={(id) => updateFilter('voyageId', id == null ? '' : String(id))}
    />
    <p className="text-sm text-[var(--app-muted)]">
      Selecione a viagem para lançar OS, overtime por depot e serviços extras da escala.
    </p>
  </div>
) : (
  <>…todo o conteúdo atual do card (grid Porto de embarque/OS/Bookings no porto + seções Overtime/Serviços)…</>
)}
```

O hint `Salvando…/Salva automaticamente ao sair do campo` do cabeçalho só faz sentido com viagem selecionada — mantê-lo sob `{filters.voyageId && canEditVazios ? … : null}` (não-edição continua com o badge "Somente leitura" quando `filters.voyageId` presente).

`VoyageCombobox` já é importado no arquivo (usado no FilterBar); `updateFilter` também. Selecionar viagem pelo card alimenta o mesmo estado do filtro — a tabela filtra junto, comportamento desejado.

- [ ] **Step 2: Verificação de tipos + smoke manual**

Run: `npx tsc -b && npm run lint`
Expected: sem erros.

Com o stack local rodando (shim + `VITE_SUPABASE_URL=http://127.0.0.1:5173/sb-proxy VITE_SUPABASE_ANON_KEY=local-anon-key npm run dev -- --port 5173 --host 127.0.0.1`), abrir `/embarquevazios` sem filtro: o card aparece com o seletor; escolher a viagem → card completo.

- [ ] **Step 3: Commit**

```bash
git add src/pages/EmbarqueVazios.tsx
git commit -m "feat(vazios): operacao da escala sempre visivel com seletor embutido"
```

---

### Task 8: Desova em massa em `/veiculos`

**Files:**
- Modify: `src/components/shared/BulkActionsBar.tsx`
- Modify: `src/components/shared/__tests__/BulkActionsBar.test.tsx`
- Modify: `src/pages/Veiculos.tsx`

- [ ] **Step 1: Teste do slot novo (falhará)**

Em `src/components/shared/__tests__/BulkActionsBar.test.tsx`, adicionar:

```tsx
it('renderiza acoes extras quando fornecidas', () => {
  render(
    <BulkActionsBar count={2} onClear={vi.fn()} onDelete={vi.fn()} noun={['veiculo', 'veiculos']} extraActions={<button type="button">Definir local de desova</button>} />,
  )
  expect(screen.getByRole('button', { name: 'Definir local de desova' })).toBeTruthy()
})
```

Run: `npx vitest run src/components/shared/__tests__/BulkActionsBar.test.tsx`
Expected: FAIL (prop inexistente).

- [ ] **Step 2: Slot `extraActions`**

Em `src/components/shared/BulkActionsBar.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Trash2, X } from 'lucide-react'
import { Button } from '../ui/Button'

type BulkActionsBarProps = {
  count: number
  onClear: () => void
  onDelete: () => void
  deleting?: boolean
  /** Singular/plural do rotulo da entidade, ex: ['veiculo', 'veiculos']. */
  noun: [string, string]
  /** Acoes adicionais renderizadas antes do botao de exclusao. */
  extraActions?: ReactNode
}

export function BulkActionsBar({ count, onClear, onDelete, deleting, noun, extraActions }: BulkActionsBarProps) {
  if (count === 0) return null

  const label = `${count} ${count === 1 ? noun[0] : noun[1]} selecionado${count === 1 ? '' : 's'}`

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-4 py-3">
      <span className="text-sm text-[var(--app-text)]">{label}</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onClear} disabled={deleting}>
          <X size={15} />
          Limpar
        </Button>
        {extraActions}
        <Button variant="danger" onClick={onDelete} loading={deleting}>
          <Trash2 size={15} />
          Excluir selecionados
        </Button>
      </div>
    </div>
  )
}
```

Run: `npx vitest run src/components/shared/__tests__/BulkActionsBar.test.tsx` → PASS.

- [ ] **Step 3: Ação em massa na página**

Em `src/pages/Veiculos.tsx`:

1. Estado novo junto aos demais `useState`:

```ts
const [bulkDesovaOpen, setBulkDesovaOpen] = useState(false)
const [bulkDesovaValue, setBulkDesovaValue] = useState('')
const [bulkDesovaSaving, setBulkDesovaSaving] = useState(false)
```

2. Handler (perto de `handleUnpackingLocationSave`):

```ts
async function handleBulkUnpackingLocation() {
  const value = bulkDesovaValue.trim() || null
  const containerIds = [...new Set(
    (data?.rows ?? [])
      .filter((row) => selection.isSelected(row.id) && row.container)
      .map((row) => row.container!.id),
  )]
  if (!containerIds.length) {
    showToast('Nenhum container nas linhas selecionadas.', 'info')
    return
  }
  setBulkDesovaSaving(true)
  try {
    await Promise.all(containerIds.map((containerId) => setContainerUnpackingLocation(containerId, value)))
    setUnpackingLocations((current) => {
      const next = { ...current }
      for (const containerId of containerIds) next[containerId] = value ?? ''
      return next
    })
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    showToast(`Local de desova aplicado a ${containerIds.length} container(s).`, 'success')
    setBulkDesovaOpen(false)
    setBulkDesovaValue('')
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Falha ao aplicar local de desova.', 'error')
  } finally {
    setBulkDesovaSaving(false)
  }
}
```

3. Barra: o render atual `{canDeleteVehicles ? <BulkActionsBar …/> : null}` passa a fornecer a ação extra quando `canEditVehicles`:

```tsx
{canDeleteVehicles ? (
  <BulkActionsBar
    count={selection.count}
    onClear={selection.clear}
    onDelete={handleDeleteSelected}
    deleting={deleting}
    noun={['veiculo', 'veiculos']}
    extraActions={canEditVehicles ? (
      <Button variant="secondary" onClick={() => setBulkDesovaOpen(true)} disabled={deleting}>
        Definir local de desova
      </Button>
    ) : null}
  />
) : null}
```

(ponytail: a seleção continua atrás de `canDeleteVehicles` — hoje todos os papéis com edição de veículos também excluem, exceto configurações futuras; estender a seleção a `canEditVehicles` puro exigiria revisar `columnCount` e os checkboxes, fora do escopo.)

4. Modal (junto aos demais `<Modal>` no fim do JSX):

```tsx
<Modal open={bulkDesovaOpen} title="Definir local de desova" onClose={() => setBulkDesovaOpen(false)}>
  <div className="grid gap-3">
    <p className="text-sm text-[var(--app-muted)]">
      Aplica aos containers das linhas selecionadas. Deixe vazio para limpar o local.
    </p>
    <Field label="Local de desova">
      <Input value={bulkDesovaValue} onChange={(event) => setBulkDesovaValue(event.target.value)} placeholder="Ex.: Pátio 3" />
    </Field>
    <Button onClick={() => void handleBulkUnpackingLocation()} loading={bulkDesovaSaving}>Aplicar</Button>
  </div>
</Modal>
```

(`Field`/`Input`/`Modal` já são importados na página? Conferir imports; adicionar o que faltar de `../components/ui/Input` e `../components/ui/Modal`.)

- [ ] **Step 4: Tipos + smoke manual**

Run: `npx tsc -b && npm run lint`
Expected: sem erros. No app local: selecionar 2 veículos → "Definir local de desova" → aplicar → inputs das linhas atualizam e `bl_containers.unpacking_location` persiste (verificar via `su postgres -c "psql -d app -tAc \"select container_number, unpacking_location from bl_containers where unpacking_location is not null\""`).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/BulkActionsBar.tsx src/components/shared/__tests__/BulkActionsBar.test.tsx src/pages/Veiculos.tsx
git commit -m "feat(veiculos): definir local de desova em massa na barra de selecao"
```

---

### Task 9: Chip "Faturado" + acentos na aba Faturamento da Ficha BL

**Files:**
- Modify: `src/lib/statusLabels.ts:13-18`
- Modify: `src/components/bl/BlCobrancasTab.tsx`

- [ ] **Step 1: `partially_paid` no label map central**

Em `src/lib/statusLabels.ts`:

```ts
export const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  invoiced: 'Faturado',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  cancelled: 'Cancelado',
}
```

- [ ] **Step 2: Chip único de estado + esconder CTAs quando bloqueado**

Em `src/components/bl/BlCobrancasTab.tsx` (o booleano `chargesLocked` já existe na linha 77):

1. Import: `import { FINANCIAL_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'`.
2. O bloco dos dois botões (linhas ~212-230) passa a renderizar somente quando não bloqueado:

```tsx
{!chargesLocked ? (
  <div className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" onClick={handleMarkChargesReviewed} loading={markReviewedMutation.isPending} disabled={markReviewedMutation.isPending || markReadyForBillingMutation.isPending} type="button">
      Marcar revisado
    </Button>
    <Button onClick={handleMarkReadyForBilling} loading={markReadyForBillingMutation.isPending} disabled={markReadyForBillingMutation.isPending || markReviewedMutation.isPending} type="button">
      Pronto para faturar
    </Button>
  </div>
) : null}
```

3. Na linha dos badges (~247-253), o chip de fase reflete o faturamento quando bloqueado:

```tsx
<div className="mb-4 flex flex-wrap gap-2">
  {chargesLocked
    ? <Badge tone="green">{statusLabel(FINANCIAL_STATUS_LABELS, bl.financial_status ?? 'invoiced')}</Badge>
    : <Badge tone={resolveChargeStatusTone(bl.charge_status)}>{resolveChargeStatusLabel(bl.charge_status)}</Badge>}
  <Badge tone="green">Subtotal BRL: {formatBRL(localChargeSummary.totalBrl)}</Badge>
  <Badge tone="blue">Subtotal USD: {formatUSD(localChargeSummary.totalUsd)}</Badge>
  {localChargeSummary.hasReviewRequired ? <Badge tone="yellow">Com pendências de revisão</Badge> : null}
  {bl.charge_exemption_reason ? <Badge tone="slate">{bl.charge_exemption_reason}</Badge> : null}
</div>
```

4. Acentos na copy do mesmo arquivo (substituições literais):
   - `Motor Etapa A: calculo automatico por B/L com base em POD, modo de carga e perfil IMO/OOG.` → `Motor Etapa A: cálculo automático por B/L com base em POD, modo de carga e perfil IMO/OOG.`
   - `As taxas deste B/L ainda nao foram calculadas.` → `As taxas deste B/L ainda não foram calculadas.`
   - `Este B/L ja foi faturado. As taxas estao bloqueadas para edicao — para alterar,` → `Este B/L já foi faturado. As taxas estão bloqueadas para edição — para alterar,`
   - Toast `Ainda existem linhas com pendencia de revisao.` → `Ainda existem linhas com pendência de revisão.` (a condição `msg.includes('pendencia de revisao')` compara com a mensagem do **banco** — não alterar a condição, só o texto do toast.)

- [ ] **Step 3: Testes relacionados + tipos**

Run: `npx vitest run src/components/bl src/pages/__tests__/blDetalheHelpers.test.ts && npx tsc -b`
Expected: PASS (se algum teste asserta a copy antiga sem acento, atualizar o literal no teste).

- [ ] **Step 4: Commit**

```bash
git add src/lib/statusLabels.ts src/components/bl/BlCobrancasTab.tsx
git commit -m "fix(bl): estado unico Faturado na aba de taxas e copy com acentos"
```

---

### Task 10: Lote P3 (formatação, grid do ADR, cards zerados, setas mobile)

**Files:**
- Modify: `src/pages/VaziosImportacao.tsx:281,380`
- Modify: `src/components/voyages/VoyageAgencyReportTab.tsx`
- Modify: `src/components/bl/BlRailsPipeline.tsx:26`

- [ ] **Step 1: TARA em pt-BR**

Em `src/pages/VaziosImportacao.tsx`, nas duas células (linhas ~281 e ~380):

```tsx
<td className="px-4 py-3">{row.tare_kg != null ? Number(row.tare_kg).toLocaleString('pt-BR') : '-'}</td>
```

(na segunda ocorrência a variável é `c.tare_kg` — aplicar o mesmo padrão.)

- [ ] **Step 2: Grid do cabeçalho do ADR**

Em `VoyageAgencyReportTab.tsx`, seção "Cabeçalho", trocar:

```tsx
<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
```

por:

```tsx
<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
```

(3 colunas em telas largas comuns evita o esmagamento de "Navio / viagem" em 3 linhas observado na auditoria em 1440px.)

- [ ] **Step 3: Cards zerados de "Embarque de vazios"**

Na mesma `VoyageAgencyReportTab.tsx`, seção "Embarque de vazios", envolver o segundo grid (Serviço extra / Storage / Overtime) para não contradizer o empty state:

```tsx
{bookings.length || data?.operation ? (
  <div className="grid gap-4 xl:grid-cols-3">
    …(conteúdo atual dos três MetricPanel)…
  </div>
) : null}
```

- [ ] **Step 4: Setas dos rails no mobile**

Em `src/components/bl/BlRailsPipeline.tsx` linha 26:

```tsx
{index > 0 ? <span className="hidden sm:inline text-[var(--app-muted)]">→</span> : null}
```

- [ ] **Step 5: Testes + tipos**

Run: `npx vitest run src/components/voyages src/components/bl && npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/VaziosImportacao.tsx src/components/voyages/VoyageAgencyReportTab.tsx src/components/bl/BlRailsPipeline.tsx
git commit -m "polish(ux): tara pt-BR, grid do cabecalho ADR, cards zerados e setas mobile"
```

---

### Task 11: Documentação final, verificação completa e push

**Files:**
- Modify: `docs/design-audit/README.md` (status das pendências)
- Modify: `docs/plans/README.md` (linha deste plano)
- Move: `docs/plans/2026-07-20-ux-pendencias-pos-auditoria.md` → `docs/archive/plans/`

- [ ] **Step 1: Atualizar o relatório da auditoria**

Em `docs/design-audit/README.md`, seção "Pendências priorizadas": marcar como **resolvido** (com ~~riscado~~ e referência ao commit/PR) os itens implementados por este plano — saldo pendente (P1), mensagem dos alertas pós-ATD (P1), atribuição de sign-offs/ocorrências (P2), tarifas de reorganização (P2), descoberta da operação da escala (P2), desova em massa (P2), chip da aba Faturamento + acentos (P2) e os quatro P3 do lote. Registrar também que "documento ADR ilegível" e "Fechado em … por …" foram resolvidos no main (PR #409) antes deste plano.

- [ ] **Step 2: Ciclo de vida do plano**

Conforme `docs/CONVENCOES.md`: mover este arquivo para `docs/archive/plans/2026-07-20-ux-pendencias-pos-auditoria.md` **no mesmo change** e remover sua linha de `docs/plans/README.md` (a linha é adicionada quando o plano nasce; se ainda não existir, não criar).

- [ ] **Step 3: Verificação completa**

Run: `npm run docs:check && npm run lint && npm test && npm run build`
Expected: tudo verde. Rodar também o smoke visual no stack local nas telas alteradas (Ficha Cliente saldo, Alertas, aba ADR, /embarquevazios, /embarquevazios/taxas, /veiculos, Ficha BL aba Faturamento).

- [ ] **Step 4: Commit final e push**

```bash
git add docs/
git commit -m "docs: fecha pendencias da auditoria UX e arquiva o plano"
git push -u origin claude/ux-review-new-features-jcuduc
```

O push atualiza o PR #411 (já aberto). Monitorar o CI até ficar verde para o commit, conforme CLAUDE.md.

---

## Self-review

- Cobertura: as 8 decisões do grilling têm task correspondente (1→T1, 2→T2+T3, 3→T4+T5, 4→T6, 5→T7, 6→T8, 7→T9, 8→T10); contrato de documentação e ciclo de vida do plano em T6/T11.
- Sem placeholders: todo step de código traz o código; comandos com resultado esperado.
- Consistência de nomes: `get_agency_report_actor_names(BIGINT, TEXT)` (T4) = consumo no serviço (T5); `AGENCY_REPORT_SECTION_LABELS`/`AGENCY_REPORT_DEPARTMENT_LABELS` (T3) = imports (T3/T5); `listVaziosReorgRates`/`upsertVaziosReorgRate`/`deleteVaziosReorgRate` (T6) = mocks do teste (T6); `extraActions` (T8) consistente entre componente e página.
