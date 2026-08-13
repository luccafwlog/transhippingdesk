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

const samples = []
try {
  for (let index = 0; index < rounds; index += 1) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const requests = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      requests.push({
        origin: url.origin,
        path: url.pathname,
        resourceType: request.resourceType(),
        startedAt: Date.now(),
      })
    })
    const startedAt = Date.now()
    await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Senha').fill(password)
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.getByRole('heading', { name: 'Painel' }).waitFor({ state: 'visible' })
    const timings = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0]
      const paint = performance.getEntriesByName('first-contentful-paint')[0]
      return {
        domContentLoaded: navigation?.domContentLoadedEventEnd ?? null,
        responseEnd: navigation?.responseEnd ?? null,
        firstContentfulPaint: paint?.startTime ?? null,
      }
    })
    samples.push({
      round: index + 1,
      totalMs: Date.now() - startedAt,
      timings,
      requestCount: requests.length,
      requestOrigins: [...new Set(requests.map((request) => request.origin))].sort(),
    })
    await context.close()
  }
} finally {
  await browser.close()
}

const values = samples.map((sample) => sample.totalMs).sort((a, b) => a - b)
const percentile = (value) => values[Math.min(values.length - 1, Math.ceil(values.length * value) - 1)]
const report = {
  generatedAt: new Date().toISOString(),
  baseOrigin: new URL(baseUrl).origin,
  rounds,
  samples,
  summary: {
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
  },
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report.summary))
if (report.summary.p95Ms > 2_000) process.exitCode = 1
