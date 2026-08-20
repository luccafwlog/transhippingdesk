import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const migration274 = fs.readFileSync(
  path.join(migrationsDir, '274_charge_table_validity_is_informational.sql'),
  'utf8',
)
const migration311Path = path.join(migrationsDir, '311_extract_local_charge_resolution.sql')
const migration311 = fs.existsSync(migration311Path) ? fs.readFileSync(migration311Path, 'utf8') : ''

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

function functionBody(source: string, functionName: string) {
  const match = source.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$;`, 'i'),
  )
  expect(match, `função ${functionName} não encontrada`).toBeTruthy()
  return match?.[1] ?? ''
}

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

describe('contrato da resolução pura de Taxa Local', () => {
  it('preserva os quatro ramos de resolução da migration 274', () => {
    expect(migration274).toMatch(/application_basis = 'weight_ton'/i)
    expect(migration274).toMatch(/review:weight_missing:/i)
    expect(migration274).toMatch(/review:thd_any_profile:/i)
    expect(migration274).toMatch(/review:unsupported_basis:/i)
    expect(migration274).toMatch(/calculation_key := CONCAT\('auto:item:'/i)

    const helper = functionBody(migration311, 'resolve_bl_local_charge_items')
    expect(migration311).toMatch(/resolve_bl_local_charge_items\(\s*p_bl_id TEXT,\s*p_pod TEXT\s*\)/i)
    expect(migration311).toMatch(/resolve_bl_local_charge_items\([\s\S]*?\)\s*RETURNS TABLE/i)
    const executableHelper = helper.replace(/--.*$/gm, '')
    expect(executableHelper).not.toMatch(/\b(?:DELETE|INSERT|UPDATE)\b/i)
    expect(executableHelper).not.toMatch(/financial_status|billed|invoic(?:ed|e)/i)
    expect(executableHelper).not.toMatch(/\bb\.pod\b/i)
    expect(helper).toMatch(/resolve_local_charge_table_id|charge_tables/i)
    expect(helper).toMatch(/customer_rate_overrides/i)
    expect(helper).toMatch(/p_pod/i)
  })

  it('faz o motor consumir o helper com o POD capturado do B/L', () => {
    const calculator = functionBody(migration311, 'calculate_bl_local_charges')
    expect(calculator).toMatch(/FROM public\.resolve_bl_local_charge_items\(p_bl_id,\s*v_bl\.pod\)/i)
    expect(calculator).not.toMatch(/FROM public\.charge_table_items\s+AS\s+cti/i)
    expect(calculator).toMatch(/item\.status = 'review_required'/i)
    expect(calculator).toMatch(/item\.calculation_key/i)
    expect(calculator).toMatch(/item\.total_value_brl/i)
  })

  it('fecha execução direta do helper, inclusive para authenticated', () => {
    expect(migration311).toMatch(
      /REVOKE ALL ON FUNCTION public\.resolve_bl_local_charge_items\(TEXT, TEXT\) FROM PUBLIC, anon, authenticated/i,
    )
    expect(migration311).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.resolve_bl_local_charge_items\(TEXT, TEXT\) TO authenticated/i,
    )
  })
})

// Opt-in: o replay oficial é descartável, mas a instalação local atual para na
// migration 297 porque o guard dela procura funções pertencentes ao role
// `postgres`, enquanto o replay Homebrew as cria pelo superusuário do sistema.
// Mantemos o contrato executável quando o replay for concluído sem mascarar
// esse bloqueio ambiental no CI padrão.
describeLocal('contrato da resolução pura em replay local do Postgres', () => {
  const blId = 'BL-311-RESOLUTION'
  const carrierId = 990311
  const vesselId = 990311
  const voyageId = 990311
  const tableOriginalId = 990311
  const tableNewId = 990312
  const itemOriginalId = 990311
  const itemNewId = 990312

  const cleanupSql = `
    DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
    DELETE FROM public.bls WHERE id = '${blId}';
    DELETE FROM public.charge_table_items WHERE id IN (${itemOriginalId}, ${itemNewId});
    DELETE FROM public.charge_tables WHERE id IN (${tableOriginalId}, ${tableNewId});
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
  `

  beforeAll(() => {
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseUrl, '-f', migration311Path], {
      encoding: 'utf8',
    })
    psql(cleanupSql)
    psql(`
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Armador Task 311');
      INSERT INTO public.vessels (id, name, carrier_id)
      VALUES (${vesselId}, 'Navio Task 311', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, pod_schedule_snapshot)
      VALUES (${voyageId}, ${vesselId}, 'TASK-311', '{"ZZ311A":{"eta":"2026-08-20"},"ZZ311B":{"eta":"2026-08-21"}}');
      INSERT INTO public.bls (id, voyage_id, pod, cargo_mode)
      VALUES ('${blId}', ${voyageId}, 'ZZ311A', 'carga_solta');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES
        (${tableOriginalId}, 'Task 311 origem', 'ZZ311A', '2020-01-01', true, 'carga_solta'),
        (${tableNewId}, 'Task 311 novo POD', 'ZZ311B', '2020-01-01', true, 'carga_solta');
      INSERT INTO public.charge_table_items
        (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, application_basis, category, cargo_profile, currency)
      VALUES
        (${itemOriginalId}, ${tableOriginalId}, 'Taxa origem', 'bl', 111, 111, 'bl', 'base', 'any', 'BRL'),
        (${itemNewId}, ${tableNewId}, 'Taxa novo POD', 'bl', 222, 222, 'bl', 'base', 'any', 'BRL');
    `)
  })

  afterAll(() => {
    psql(cleanupSql)
  })

  it('publica a assinatura e mantém o helper fechado para authenticated', () => {
    expect(psql("SELECT to_regprocedure('public.resolve_bl_local_charge_items(text,text)') IS NOT NULL;")).toBe('t')
    expect(
      psql(
        "SELECT NOT has_function_privilege('public', 'public.resolve_bl_local_charge_items(text,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.resolve_bl_local_charge_items(text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.resolve_bl_local_charge_items(text,text)', 'EXECUTE');",
      ),
    ).toBe('t')
  })

  it('não escreve e resolve o POD explícito, mesmo quando diverge de bls.pod', () => {
    const before = psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}';`)
    const resolved = psql(`
      SELECT charge_table_id || '|' || charge_item_id || '|' || unit_value_brl
      FROM public.resolve_bl_local_charge_items('${blId}', 'ZZ311B');
    `)
    const after = psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${blId}';`)

    expect(resolved).toBe(`${tableNewId}|${itemNewId}|222.00`)
    expect(before).toBe(after)
  })
})
