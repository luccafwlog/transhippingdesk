import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function getFunctionDefinition(signature: string) {
  return psql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`)
}

function compact(definition: string) {
  return definition
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .toLowerCase()
}

describeLocal('contrato SQL das definições finais das RPCs de omissão', () => {
  let omitVoyageEscala: string
  let setBlCod: string
  let setBlTransshipment: string
  let updateVoyageOmission: string

  beforeAll(() => {
    // A definição final é a evidência do P0-3. Um scanner textual das migrations
    // é apenas rede secundária: fica cego a reescritas por DO/pg_get_functiondef
    // e não enxerga grants efetivos.
    omitVoyageEscala = getFunctionDefinition('public.omit_voyage_escala(bigint,text,text,text,uuid,text,text,text,timestamptz,timestamptz)')
    setBlCod = getFunctionDefinition('public.set_bl_cod(text,bigint,uuid)')
    setBlTransshipment = getFunctionDefinition('public.set_bl_transshipment(text,bigint,text,text,text,timestamptz,timestamptz,uuid)')
    updateVoyageOmission = getFunctionDefinition('public.update_voyage_omission(bigint,text,text,text,timestamptz,timestamptz,text,uuid)')
  })

  it('consulta a assinatura final e preserva o contrato global da omissão', () => {
    const definition = compact(omitVoyageEscala)

    expect(definition).toContain('create or replace function public.omit_voyage_escala(')
    expect(definition).toContain('p_onward_vessel_name text default null')
    expect(definition).toContain('p_onward_carrier text default null')
    expect(definition).toContain('p_onward_voyage_number text default null')
    expect(definition).toContain('p_onward_etd timestamp with time zone default null')
    expect(definition).toContain('p_onward_eta timestamp with time zone default null')
    expect(definition).toContain('insert into public.voyage_omissions(voyage_id, omitted_pod, discharge_pod, reason, omitted_by, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta)')
    expect(definition).toContain("onward_vessel_name = nullif(btrim(coalesce(p_onward_vessel_name, '')), '')")
    expect(definition).toContain("onward_carrier = nullif(btrim(coalesce(p_onward_carrier, '')), '')")
    expect(definition).toContain("onward_voyage_number = nullif(btrim(coalesce(p_onward_voyage_number, '')), '')")
    expect(definition).toContain('onward_etd = p_onward_etd')
    expect(definition).toContain('onward_eta = p_onward_eta')
    expect(definition).toContain('onward_vessel_name = excluded.onward_vessel_name')
    expect(definition).toContain('onward_carrier = excluded.onward_carrier')
    expect(definition).toContain('onward_voyage_number = excluded.onward_voyage_number')
    expect(definition).toContain('onward_etd = excluded.onward_etd')
    expect(definition).toContain('onward_eta = excluded.onward_eta')
    expect(definition).not.toContain('v_omitted = v_discharge')
    expect(definition).toContain('insert into public.portal_notifications(customer_id, bl_id, type, title, message, link)')
  })

  it('consulta as definições finais de COD e transbordo sem o helper removido', () => {
    const cod = compact(setBlCod)
    const transshipment = compact(setBlTransshipment)

    expect(cod).toContain('if auth.uid() is null or not public.is_active_user() or p_changed_by is distinct from auth.uid() then')
    expect(cod).not.toContain('can_edit_voyages()')
    expect(cod).toContain("disposition = 'cod'")
    expect(cod).toContain('onward_vessel_name = null')
    expect(cod).toContain('onward_carrier = null')
    expect(cod).toContain('onward_voyage_number = null')
    expect(cod).toContain('onward_etd = null')
    expect(cod).toContain('onward_eta = null')
    expect(cod).toContain('update public.bls set pod = v_discharge')
    expect(cod).toContain('insert into public.portal_notifications(customer_id, bl_id, type, title, message, link)')

    expect(transshipment).toContain('if auth.uid() is null or not public.is_active_user() or p_changed_by is distinct from auth.uid() then')
    expect(transshipment).not.toContain('can_edit_voyages()')
    expect(transshipment).toContain("disposition = 'transshipment'")
    expect(transshipment).toContain('update public.bls set pod = v_original_pod')
    expect(transshipment).toContain("'reversao de cod para transbordo'")
  })

  it('consulta a definição final da complementação global sem notificar o Portal', () => {
    const definition = compact(updateVoyageOmission)

    expect(definition).toContain('if auth.uid() is null or not public.is_active_user() or p_changed_by is distinct from auth.uid() then')
    expect(definition).not.toContain('can_edit_voyages()')
    expect(definition).toContain('onward_vessel_name = nullif(btrim(coalesce(p_onward_vessel_name, \'\')), \'\')')
    expect(definition).toContain('onward_carrier = nullif(btrim(coalesce(p_onward_carrier, \'\')), \'\')')
    expect(definition).toContain('onward_voyage_number = nullif(btrim(coalesce(p_onward_voyage_number, \'\')), \'\')')
    expect(definition).toContain('onward_etd = p_onward_etd')
    expect(definition).toContain('onward_eta = p_onward_eta')
    expect(definition).toContain("values ('voyage', v_voyage_id::text, 'transshipment_info'")
    expect(definition).toContain("select 'bls', bt.bl_id, 'transshipment_info'")
    expect(definition).not.toContain('portal_notifications')
  })

  it('mantém os grants finais das quatro RPCs no banco', () => {
    const signatures = [
      'public.omit_voyage_escala(bigint,text,text,text,uuid,text,text,text,timestamptz,timestamptz)',
      'public.set_bl_cod(text,bigint,uuid)',
      'public.set_bl_transshipment(text,bigint,text,text,text,timestamptz,timestamptz,uuid)',
      'public.update_voyage_omission(bigint,text,text,text,timestamptz,timestamptz,text,uuid)',
    ]

    for (const signature of signatures) {
      expect(psql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`)).toBe('t')
      expect(psql(`SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`)).toBe('f')
    }
  })
})
