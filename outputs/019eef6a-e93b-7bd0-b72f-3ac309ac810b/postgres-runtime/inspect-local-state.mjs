import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const database = new EmbeddedPostgres({
  databaseDir: path.join(import.meta.dirname, 'data'),
  user: 'postgres',
  password: 'postgres',
  port: 55432,
  persistent: true,
  onLog: () => {},
  onError: () => {},
})

await database.start()
const client = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  database: 'app',
  user: 'postgres',
  password: 'postgres',
})
await client.connect()

try {
  const bl = await client.query(
    `SELECT id, financial_status, charge_status, review_status,
            customer_reconciliation_status, customer_id, updated_at
     FROM public.bls WHERE id = 'QAIT001'`,
  )
  const calculations = await client.query(
    `SELECT id, status, calculation_key, total_value_brl
     FROM public.charge_calculations WHERE bl_id = 'QAIT001' ORDER BY id`,
  )
  const invoices = await client.query(
    `SELECT i.id, i.status, i.total_brl
     FROM public.invoices i
     LEFT JOIN public.invoice_bls ib ON ib.invoice_id = i.id
     WHERE ib.bl_id = 'QAIT001'
     ORDER BY i.id`,
  )
  console.log(JSON.stringify({
    bl: bl.rows,
    calculations: calculations.rows,
    invoices: invoices.rows,
  }, null, 2))
} finally {
  await client.end()
  await database.stop()
}
