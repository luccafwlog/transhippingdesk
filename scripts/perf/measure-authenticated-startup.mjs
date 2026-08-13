// Reproducible cold/warm startup measurement for the authenticated SPA.
// Credentials are read only from environment variables and are never written
// to the report, traces, console, or request logs.
//
// Required: PERF_BASE_URL, PERF_USER_EMAIL, PERF_USER_PASSWORD
// Optional: PERF_ROUNDS (default 5), PERF_OUTPUT (default artifacts/perf/...json),
//           PERF_BROWSER_EXECUTABLE_PATH (for a managed Chrome/Edge binary).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.PERF_BASE_URL
const email = process.env.PERF_USER_EMAIL
const password = process.env.PERF_USER_PASSWORD
const rounds = Number(process.env.PERF_ROUNDS ?? 5)
const output = resolve(process.env.PERF_OUTPUT ?? 'artifacts/perf/authenticated-startup.json')
const SLOWEST_PER_CATEGORY = 10

if (!baseUrl || !email || !password) {
  console.error('Set PERF_BASE_URL, PERF_USER_EMAIL, and PERF_USER_PASSWORD before running this harness.')
  process.exit(2)
}
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
  console.error('PERF_ROUNDS must be an integer between 1 and 20.')
  process.exit(2)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PERF_BROWSER_EXECUTABLE_PATH || undefined,
})

// Tracks every finished request for one page across cold + warm phases; used
// both for the per-round request count and for the aggregated bytes/slowest
// report below.
function trackRequests(page) {
  const requests = []
  page.on('requestfinished', async (request) => {
    const response = await request.response().catch(() => null)
    const timing = request.timing()
    const url = new URL(request.url())
    const contentLength = Number(response?.headers()['content-length'] ?? 0)
    requests.push({
      path: url.pathname,
      resourceType: request.resourceType(),
      durationMs: timing ? Math.round(timing.responseEnd - timing.startTime) : null,
      bytes: Number.isFinite(contentLength) ? contentLength : 0,
    })
  })
  return requests
}

const samples = []
try {
  for (let index = 0; index < rounds; index += 1) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const requests = trackRequests(page)

    // Cold: fresh context, fresh session, /login -> /painel.
    const coldStartedAt = Date.now()
    await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Senha').fill(password)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.getByRole('heading', { name: 'Painel' }).waitFor({ state: 'visible' })
    const coldTimings = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const paint = performance.getEntriesByName('first-contentful-paint')[0]
      return {
        domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
        responseEnd: navigation?.responseEnd ?? null,
        firstContentfulPaint: paint?.startTime ?? null,
      }
    })
    const coldTotalMs = Date.now() - coldStartedAt

    // Warm: same authenticated session, same chunk cache, internal navigation.
    const warmStartedAt = Date.now()
    await page.getByRole('link', { name: 'Chegadas e Saídas' }).click()
    await page.getByRole('heading', { name: 'Chegadas e Saídas' }).waitFor({ state: 'visible' })
    const warmTotalMs = Date.now() - warmStartedAt

    samples.push({
      round: index + 1,
      cold: { totalMs: coldTotalMs, timings: coldTimings },
      warm: { totalMs: warmTotalMs },
      requestCount: requests.length,
      requests,
    })
    await context.close()
  }
} finally {
  await browser.close()
}

function percentileOf(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

const allRequests = samples.flatMap((sample) => sample.requests)
const requestBytesTotal = allRequests.reduce((sum, request) => sum + request.bytes, 0)
const slowestByCategory = Object.fromEntries(
  [...new Set(allRequests.map((request) => request.resourceType))].sort().map((category) => [
    category,
    allRequests
      .filter((request) => request.resourceType === category && request.durationMs != null)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, SLOWEST_PER_CATEGORY)
      .map(({ path, durationMs, bytes }) => ({ path, durationMs, bytes })),
  ]),
)

const coldValues = samples.map((sample) => sample.cold.totalMs)
const warmValues = samples.map((sample) => sample.warm.totalMs)
const report = {
  generatedAt: new Date().toISOString(),
  baseOrigin: new URL(baseUrl).origin,
  rounds,
  samples: samples.map(({ requests: _requests, ...sample }) => sample),
  summary: {
    coldMedianMs: percentileOf(coldValues, 0.5),
    coldP95Ms: percentileOf(coldValues, 0.95),
    warmMedianMs: percentileOf(warmValues, 0.5),
    warmP95Ms: percentileOf(warmValues, 0.95),
    requestBytesTotal,
    slowestByCategory,
  },
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report.summary))
if (report.summary.coldP95Ms > 2_000 || report.summary.warmP95Ms > 1_000) process.exitCode = 1
