import { describe, expect, it, vi } from 'vitest'

// O cliente real do supabase-js le `this.rest` dentro de `rpc`. Um duble que
// tambem depende de `this` e o unico jeito de um teste flagrar a chamada
// destacada (`const rpc = supabase.rpc`), que passa despercebida quando o
// duble e uma funcao solta.
const { rpcCalls } = vi.hoisted(() => ({ rpcCalls: [] as Array<{ name: string; args: unknown }> }))

vi.mock('../supabase', () => {
  const client = {
    rest: { marker: true },
    rpc(name: string, args: Record<string, unknown>) {
      if (!this || !(this as { rest?: unknown }).rest) {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')")
      }
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
    from: vi.fn(),
  }
  return { supabase: client }
})

import {
  closeReportByReportId,
  reopenReportByReportId,
  setDepartmentSignoffByReportId,
  setSectionObservationByReportId,
  setSignoffByReportId,
} from '../agencyDepartureReport'

describe('escritas terminalizadas do ADR preservam o receptor de supabase.rpc', () => {
  it('assina a seção sem perder o cliente', async () => {
    await setSignoffByReportId({ reportId: 'r1', voyageId: 10, port: 'BRVIX', section: 'datas', state: 'confirmed' })
    expect(rpcCalls.at(-1)?.name).toBe('set_agency_report_signoff_by_report_id')
  })

  it('assina o departamento, observa, fecha e reabre sem perder o cliente', async () => {
    await setDepartmentSignoffByReportId({ reportId: 'r1', voyageId: 10, port: 'BRVIX', department: 'operacoes', signed: true })
    await setSectionObservationByReportId({ reportId: 'r1', voyageId: 10, port: 'BRVIX', section: 'datas', observation: 'ok' })
    await closeReportByReportId({ reportId: 'r1', voyageId: 10, port: 'BRVIX', snapshot: {} })
    await reopenReportByReportId({ reportId: 'r1', voyageId: 10, port: 'BRVIX', justification: 'motivo' })
    expect(rpcCalls.map((call) => call.name)).toEqual([
      'set_agency_report_signoff_by_report_id',
      'set_agency_report_department_signoff_by_report_id',
      'set_agency_report_section_observation_by_report_id',
      'close_agency_departure_report_by_report_id',
      'reopen_agency_departure_report_by_report_id',
    ])
  })
})
