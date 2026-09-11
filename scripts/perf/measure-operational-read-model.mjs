// Mede a leitura resumida de viagens contra a projeção pesada que existia no
// rail. Cada cenário roda dentro de uma transação que termina em ROLLBACK;
// nenhum dado sintético fica persistido.
//
// Requer:
//   PERF_BENCHMARK_ALLOW_LOCAL=1
//   LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test
//
// O banco deve estar vazio de viagens antes da execução para que a RPC sem
// filtro compare exatamente o dataset sintético. O script recusa hosts não
// locais e não imprime a URL completa, que pode conter credenciais.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/transhipping_test'
const output = resolve(process.env.PERF_BENCHMARK_OUTPUT ?? 'artifacts/perf/operational-read-model.json')
const rounds = Number(process.env.PERF_BENCHMARK_ROUNDS ?? 5)
const sizes = String(process.env.PERF_BENCHMARK_SIZES ?? '100,1000,10000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0)

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (process.env.PERF_BENCHMARK_ALLOW_LOCAL !== '1') {
  fail('Defina PERF_BENCHMARK_ALLOW_LOCAL=1 para autorizar o benchmark somente local.')
}

let databaseHost
try {
  const parsedDatabaseUrl = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    fail('LOCAL_DATABASE_URL deve usar o protocolo PostgreSQL.')
  }
  databaseHost = parsedDatabaseUrl.hostname
} catch {
  fail('LOCAL_DATABASE_URL não é uma URL PostgreSQL válida.')
}
if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
  fail(`Benchmark recusado fora do host local: ${databaseHost}`)
}
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
  fail('PERF_BENCHMARK_ROUNDS deve ser um inteiro entre 1 e 20.')
}
if (sizes.length !== 3 || sizes.some((size, index) => size !== [100, 1000, 10000][index])) {
  fail('PERF_BENCHMARK_SIZES deve permanecer exatamente 100,1000,10000.')
}

function runPsql(sql) {
  try {
    return execFileSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
  } catch {
    fail('O benchmark não conseguiu executar SQL no PostgreSQL local; a URL não será exibida.')
  }
}

function parsePsqlValues(output) {
  const values = []
  let buffer = ''
  for (const line of output.split('\n').map((value) => value.trim()).filter(Boolean)) {
    buffer += line
    try {
      values.push(JSON.parse(buffer))
      buffer = ''
    } catch {
      // EXPLAIN FORMAT JSON is pretty-printed by psql; keep joining lines
      // until the complete JSON array is available.
    }
  }
  if (buffer) throw new Error('Saída JSON incompleta do psql.')
  return values
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function extractExplain(line) {
  const root = JSON.parse(line)[0]
  return {
    planningMs: root['Planning Time'] ?? null,
    executionMs: root['Execution Time'] ?? null,
    sharedHitBlocks: root.Plan?.['Shared Hit Blocks'] ?? null,
    sharedReadBlocks: root.Plan?.['Shared Read Blocks'] ?? null,
  }
}

function buildSyntheticSql({ size, token, ids }) {
  const halfContainerCount = Math.max(1, Math.floor(size / 2))
  const prefix = `PERF_S12_${token}_${size}_`
  const [carrierId, vesselOneId, vesselTwoId, vesselThreeId, voyageOneId, voyageTwoId, voyageThreeId, containerBase] = ids
  return `
INSERT INTO public.carriers (id, name, scac)
VALUES (${carrierId}, 'Perf S12 Carrier ${token}', 'P12');
INSERT INTO public.vessels (id, name, imo, carrier_id)
VALUES
  (${vesselOneId}, 'Perf S12 Vessel 1', 'IMO${token}1', ${carrierId}),
  (${vesselTwoId}, 'Perf S12 Vessel 2', 'IMO${token}2', ${carrierId}),
  (${vesselThreeId}, 'Perf S12 Vessel 3', 'IMO${token}3', ${carrierId});
INSERT INTO public.voyages (id, vessel_id, voyage_number, status, created_at)
VALUES
  (${voyageOneId}, ${vesselOneId}, 'PERF-${token}-1', 'active', '2026-01-01T00:00:01Z'),
  (${voyageTwoId}, ${vesselTwoId}, 'PERF-${token}-2', 'active', '2026-01-01T00:00:02Z'),
  (${voyageThreeId}, ${vesselThreeId}, 'PERF-${token}-3', 'active', '2026-01-01T00:00:03Z');
INSERT INTO public.bls (
  id, voyage_id, cargo_mode, pol, pod, ce_mercante, financial_status,
  review_status, charge_status, created_at
)
SELECT
  '${prefix}' || sample.id,
  CASE sample.id % 3 WHEN 0 THEN ${voyageOneId} WHEN 1 THEN ${voyageTwoId} ELSE ${voyageThreeId} END,
  CASE WHEN sample.id % 10 = 0 THEN 'carga_solta' ELSE 'container' END,
  CASE sample.id % 4 WHEN 0 THEN 'CNSHA' WHEN 1 THEN 'NLRTM' WHEN 2 THEN 'ITGOA' ELSE 'CNSHA' END,
  CASE sample.id % 4 WHEN 0 THEN 'BRVIX' WHEN 1 THEN 'BRSSZ' WHEN 2 THEN 'BRVIX' ELSE 'BRSSA' END,
  CASE WHEN sample.id % 3 = 0 THEN 'CE-' || sample.id ELSE NULL END,
  'pending',
  CASE WHEN sample.id % 7 = 0 THEN 'pending_review' ELSE 'ok' END,
  CASE WHEN sample.id % 11 = 0 THEN 'review_required' ELSE 'ready_for_billing' END,
  '2026-01-02T00:00:00Z'::timestamptz + sample.id * interval '1 second'
FROM generate_series(1, ${size}) AS sample(id);
INSERT INTO public.bl_containers (id, bl_id, container_number, type, is_imo, is_oog)
SELECT
  ${containerBase} + sample.id,
  '${prefix}' || sample.id,
  'MSCU' || lpad((((sample.id - 1) % ${halfContainerCount}) + 1)::text, 7, '0'),
  CASE WHEN sample.id % 2 = 0 THEN '40HC' ELSE '20GP' END,
  sample.id % 17 = 0,
  sample.id % 19 = 0
FROM generate_series(1, ${size}) AS sample(id)
WHERE sample.id % 10 <> 0;
`
}

function summaryMeasurement(sample) {
  return `
WITH started AS MATERIALIZED (SELECT clock_timestamp() AS at),
result AS MATERIALIZED (
  SELECT public.operational_list_voyage_summaries(1, 100) AS payload
)
SELECT jsonb_build_object(
  'kind', 'summary',
  'sample', ${sample},
  'elapsedMs', extract(epoch FROM clock_timestamp() - started.at) * 1000,
  'bytes', octet_length(result.payload::text)
)
FROM started CROSS JOIN result;
`
}

function baselinePayload() {
  return `
COALESCE((
  SELECT jsonb_agg(
    jsonb_build_object(
      'voyage', to_jsonb(voyage),
      'bls', COALESCE((
        SELECT jsonb_agg(
          jsonb_set(
            to_jsonb(bl),
            '{bl_containers}',
            COALESCE((
              SELECT jsonb_agg(to_jsonb(container) ORDER BY container.id)
              FROM public.bl_containers AS container
              WHERE container.bl_id = bl.id
            ), '[]'::jsonb),
            true
          ) ORDER BY bl.id
        )
        FROM public.bls AS bl
        WHERE bl.voyage_id = voyage.id
      ), '[]'::jsonb)
    ) ORDER BY voyage.id
  )
  FROM public.voyages AS voyage
), '[]'::jsonb)
`
}

function baselineMeasurement(sample) {
  return `
WITH started AS MATERIALIZED (SELECT clock_timestamp() AS at),
result AS MATERIALIZED (
  SELECT ${baselinePayload()} AS payload
)
SELECT jsonb_build_object(
  'kind', 'baseline',
  'sample', ${sample},
  'elapsedMs', extract(epoch FROM clock_timestamp() - started.at) * 1000,
  'bytes', octet_length(result.payload::text)
)
FROM started CROSS JOIN result;
`
}

function scenario(size, index) {
  const token = `${Date.now().toString(36)}${index.toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-10)
  const base = 1_500_000_000 + index * 1_000_000
  const ids = [
    base + 1,
    base + 2,
    base + 3,
    base + 4,
    base + 5,
    base + 6,
    base + 7,
    base + 100_000,
  ]
  let sql = `BEGIN; SET LOCAL statement_timeout = '120s';\n`
  sql += buildSyntheticSql({ size, token, ids })
  // As linhas são inseridas dentro da transação e, portanto, não passam pelo
  // autovacuum/analyze antes da leitura. Atualizar as estatísticas aqui evita
  // medir um plano baseado em cardinalidade vazia, que pode transformar a
  // comparação em um falso regressivo nos cenários maiores.
  sql += `ANALYZE public.bls;\nANALYZE public.bl_containers;\nANALYZE public.voyages;\n`
  for (let sample = 1; sample <= rounds; sample += 1) {
    sql += summaryMeasurement(sample)
    sql += baselineMeasurement(sample)
  }
  sql += `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT public.operational_list_voyage_summaries(1, 100);\n`
  sql += `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT ${baselinePayload()};\n`
  sql += 'ROLLBACK;\n'

  const values = parsePsqlValues(runPsql(sql))
  const measurements = values.filter((value) => value && !Array.isArray(value) && typeof value.kind === 'string')
  const plans = values.filter((value) => Array.isArray(value)).map((value) => extractExplain(JSON.stringify(value)))
  const summary = measurements.filter((value) => value.kind === 'summary')
  const baseline = measurements.filter((value) => value.kind === 'baseline')
  if (summary.length !== rounds || baseline.length !== rounds || plans.length !== 2) {
    throw new Error(`Saída incompleta para o cenário de ${size} B/Ls.`)
  }

  return {
    bls: size,
    voyages: 3,
    routeVariants: 4,
    sharedContainerNumbers: Math.max(1, Math.floor(size / 2)),
    transactionRolledBack: true,
    requestsPerRefresh: { summary: 1, baseline: 1 },
    summary: {
      p50Ms: percentile(summary.map((value) => Number(value.elapsedMs)), 0.5),
      p95Ms: percentile(summary.map((value) => Number(value.elapsedMs)), 0.95),
      averageBytes: average(summary.map((value) => Number(value.bytes))),
      p95Bytes: percentile(summary.map((value) => Number(value.bytes)), 0.95),
    },
    baseline: {
      p50Ms: percentile(baseline.map((value) => Number(value.elapsedMs)), 0.5),
      p95Ms: percentile(baseline.map((value) => Number(value.elapsedMs)), 0.95),
      averageBytes: average(baseline.map((value) => Number(value.bytes))),
      p95Bytes: percentile(baseline.map((value) => Number(value.bytes)), 0.95),
    },
    explain: {
      summary: plans[0],
      baseline: plans[1],
    },
  }
}

const existingVoyages = Number(runPsql('SELECT count(*) FROM public.voyages;')[0] ?? 0)
if (existingVoyages !== 0) {
  fail(`O benchmark exige um banco sem viagens; encontrou ${existingVoyages}. Rode scripts/setup-local-pg.sh --reset e tente novamente.`)
}

const scenarios = sizes.map((size, index) => scenario(size, index + 1))
const report = {
  generatedAt: new Date().toISOString(),
  databaseHost,
  rounds,
  scenarios,
  methodology: {
    summary: 'operational_list_voyage_summaries(1, 100)',
    baseline: 'jsonb agregado com todas as colunas de voyages/bls e containers aninhados',
    requestDefinition: 'uma instrução SQL local por leitura; não é contagem HTTP/PostgREST',
    byteDefinition: 'octet_length do JSON retornado pelo banco, antes de compressão HTTP',
    explain: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) executado no mesmo dataset transacional',
    rollback: 'cada cenário termina em ROLLBACK; o banco deve permanecer sem dados sintéticos',
  },
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output, scenarios: scenarios.map(({ bls, summary: compactSummary, baseline: compactBaseline }) => ({ bls, summary: compactSummary, baseline: compactBaseline })) }, null, 2))
