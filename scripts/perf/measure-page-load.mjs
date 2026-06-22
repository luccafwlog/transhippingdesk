// Repeatable page-load budget measurement for the SPA route chunks.
//
// Metric (decided with the maintainer): "page load" == the JavaScript a browser
// must download + parse/compile to render a given route on a cold visit. We
// exclude live network/data (Supabase is mocked out of the equation) because a
// real network round-trip can never fit a <50ms budget; the parse/compile cost
// of the route's JS is the part the codebase actually controls.
//
// For each route we collect:
//   baseline entry graph (main.tsx + vendor chunks, always loaded)
//   + the lazy page chunk and its static import graph.
// We then measure V8 parse/compile time of that JS via vm.SourceTextModule
// (parses + compiles WITHOUT evaluating, so browser-only code never runs), and
// report gzip transfer size alongside it.
//
// Budget: every route must parse/compile in < 50 ms (median of N runs).
//
// Run: node --experimental-vm-modules scripts/perf/measure-page-load.mjs
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = join(ROOT, 'dist')
const MANIFEST = join(DIST, '.vite', 'manifest.json')
const BUDGET_MS = 50
const RUNS = 7

if (!existsSync(MANIFEST)) {
  console.error('No build manifest found. Run `npx vite build` first.')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

// Recursively gather all static-import JS chunk files reachable from a manifest key.
function collectChunks(key, acc = new Set(), seen = new Set()) {
  if (seen.has(key)) return acc
  seen.add(key)
  const entry = manifest[key]
  if (!entry) return acc
  if (entry.file && entry.file.endsWith('.js')) acc.add(entry.file)
  for (const imp of entry.imports ?? []) collectChunks(imp, acc, seen)
  return acc
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry)
if (!entryKey) {
  console.error('No entry found in manifest.')
  process.exit(2)
}
const baseline = collectChunks(entryKey)

// Route -> page source module (matches the lazyPage() imports in src/App.tsx).
const pageKeys = Object.keys(manifest).filter(
  (k) => k.startsWith('src/pages/') && k.endsWith('.tsx') && !k.includes('__tests__'),
)

// Cache file bytes + a measured parse/compile time per chunk so shared chunks
// are only compiled once per run regardless of how many routes use them.
const fileCache = new Map()
function loadFile(file) {
  if (!fileCache.has(file)) {
    const code = readFileSync(join(DIST, file))
    fileCache.set(file, { code, text: code.toString('utf8'), gzip: gzipSync(code).length })
  }
  return fileCache.get(file)
}

function compileOnce(file) {
  const { text } = loadFile(file)
  const start = performance.now()
  // Constructing a SourceTextModule parses + compiles top-level code without
  // evaluating it (no browser globals touched). identifier keeps modules unique.
  void new vm.SourceTextModule(text, { identifier: file + ':' + Math.random() })
  return performance.now() - start
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const rows = []
for (const key of pageKeys) {
  const files = new Set([...baseline, ...collectChunks(key)])
  let raw = 0
  let gzip = 0
  for (const f of files) {
    const { code, gzip: g } = loadFile(f)
    raw += code.length
    gzip += g
  }
  const samples = []
  for (let i = 0; i < RUNS; i++) {
    let t = 0
    for (const f of files) t += compileOnce(f)
    samples.push(t)
  }
  rows.push({
    page: key.replace('src/pages/', '').replace('.tsx', ''),
    chunks: files.size,
    rawKB: raw / 1024,
    gzipKB: gzip / 1024,
    ms: median(samples),
  })
}

rows.sort((a, b) => b.ms - a.ms)

const pad = (s, n) => String(s).padEnd(n)
const padN = (s, n) => String(s).padStart(n)
console.log(
  `\nPage-load budget — parse/compile of route JS (median of ${RUNS} runs), budget < ${BUDGET_MS}ms\n`,
)
console.log(pad('PAGE', 22), padN('CHUNKS', 7), padN('RAW kB', 9), padN('GZIP kB', 9), padN('ms', 8), ' ')
console.log('-'.repeat(62))
let fails = 0
for (const r of rows) {
  const ok = r.ms < BUDGET_MS
  if (!ok) fails++
  console.log(
    pad(r.page, 22),
    padN(r.chunks, 7),
    padN(r.rawKB.toFixed(1), 9),
    padN(r.gzipKB.toFixed(1), 9),
    padN(r.ms.toFixed(2), 8),
    ok ? 'ok' : 'OVER',
  )
}
console.log('-'.repeat(62))
console.log(`${rows.length} routes, ${fails} over budget. Worst: ${rows[0].ms.toFixed(2)}ms (${rows[0].page})`)
process.exit(fails > 0 ? 1 : 0)
