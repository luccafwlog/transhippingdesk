import type { PortalDb, PortalDbRow, PortalQuery } from '../../../supabase/functions/_shared/portalDb.ts'

export type FakeCall = { table: string; ops: Array<{ op: string; args: unknown[] }> }
export type FakeRpcCall = { name: string; params?: PortalDbRow }

// Duplo do cliente Supabase para os helpers das Edge Functions do Portal. Cada
// chamada fica registrada com a tabela e a cadeia de operações, então o teste
// pode afirmar não só o resultado como o que NÃO foi feito — que é o ponto de
// "requisição bloqueada não chega a verificar senha" e de "confirmação sem
// pedido pendente não consome o convite".
export function createFakePortalDb(options: {
  resolve?: (call: FakeCall) => PortalDbRow | null
  rpc?: (name: string, params?: PortalDbRow) => { data?: unknown; error?: unknown }
} = {}) {
  const calls: FakeCall[] = []
  const rpcCalls: FakeRpcCall[] = []

  const db: PortalDb = {
    async rpc(name, params) {
      rpcCalls.push({ name, params })
      const result = options.rpc?.(name, params) ?? {}
      return { data: result.data ?? null, error: result.error }
    },
    from(table) {
      const call: FakeCall = { table, ops: [] }
      calls.push(call)
      const record = (op: string, ...args: unknown[]) => { call.ops.push({ op, args }); return query }
      const query: PortalQuery = {
        select: (columns) => record('select', columns),
        insert: (values) => record('insert', values),
        update: (values) => record('update', values),
        eq: (column, value) => record('eq', column, value),
        neq: (column, value) => record('neq', column, value),
        gt: (column, value) => record('gt', column, value),
        order: (column, opts) => record('order', column, opts),
        limit: (count) => record('limit', count),
        maybeSingle: async () => ({ data: options.resolve?.(call) ?? null }),
      }
      return query
    },
  }

  return { db, calls, rpcCalls }
}

export function hasOp(call: FakeCall, op: string): boolean {
  return call.ops.some((entry) => entry.op === op)
}

export function opArgs(call: FakeCall, op: string): unknown[] | undefined {
  return call.ops.find((entry) => entry.op === op)?.args
}
