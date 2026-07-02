#!/usr/bin/env node
// Builds the XLSX view of the canonical behavioral specification.
//
// Source of truth: docs/spec/<date>-behavioral-spec.csv  (edited directly)
// View layer:      docs/spec/<date>-behavioral-spec.xlsx (generated here)
//
// Usage:
//   node scripts/build-behavioral-spec.mjs [path/to/spec.csv]
// Without an argument, the newest *-behavioral-spec.csv in docs/spec/ is used.
//
// Status flow: Spec'd -> Tested-Pass / Tested-Fail -> Fixed -> Verified
// Evidence classes (strongest available):
//   Vitest        - behavior/unit assertion executed by `npm test`
//   SQL-contract  - *Migration.test.ts asserts versioned SQL (drift, not runtime)
//   Integration   - src/integration/supabase.integration.test.ts (NOT executed here)
//   Static        - confirmed by reading executable code only (no runtime)

import * as fs from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from '@e965/xlsx'

XLSX.set_fs(fs)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = join(root, 'docs', 'spec')

const COLUMNS = [
  'ID',
  'Area',
  'User Story',
  'Expected Behavior (as implemented)',
  'Status',
  'Defects',
  'Defect Type',
  'Evidence',
  'Source References',
  'Open Questions / Notes',
]

function latestSpecCsv() {
  const candidates = readdirSync(specDir)
    .filter((f) => f.endsWith('-behavioral-spec.csv'))
    .sort()
  if (candidates.length === 0) {
    throw new Error(`No *-behavioral-spec.csv found in ${specDir}`)
  }
  return join(specDir, candidates[candidates.length - 1])
}

// RFC 4180 parser (quoted fields, escaped quotes, newlines inside quotes).
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

const csvPath = process.argv[2] ? resolve(process.argv[2]) : latestSpecCsv()
const raw = parseCsv(readFileSync(csvPath, 'utf8'))
const header = raw[0]
if (JSON.stringify(header) !== JSON.stringify(COLUMNS)) {
  throw new Error(
    `Unexpected CSV header in ${csvPath}.\nExpected: ${COLUMNS.join(',')}\nGot:      ${header.join(',')}`,
  )
}
const rows = raw.slice(1).map((cells) => {
  const rec = {}
  COLUMNS.forEach((c, i) => {
    rec[c] = cells[i] ?? ''
  })
  return rec
})

const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })
ws['!cols'] = [
  { wch: 14 }, { wch: 20 }, { wch: 46 }, { wch: 70 }, { wch: 12 },
  { wch: 40 }, { wch: 26 }, { wch: 30 }, { wch: 42 }, { wch: 60 },
]
ws['!autofilter'] = {
  ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: COLUMNS.length - 1, r: rows.length } }),
}
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Behavioral Spec')

const byStatus = {}
const byType = {}
for (const rec of rows) {
  byStatus[rec.Status] = (byStatus[rec.Status] || 0) + 1
  if (rec['Defect Type'] && rec['Defect Type'] !== '-') {
    byType[rec['Defect Type']] = (byType[rec['Defect Type']] || 0) + 1
  }
}
const summary = [
  { Metric: 'Source CSV', Value: csvPath.replace(`${root}/`, '') },
  { Metric: 'Generated', Value: new Date().toISOString().slice(0, 10) },
  { Metric: 'Total stories', Value: rows.length },
  ...Object.entries(byStatus).map(([k, v]) => ({ Metric: `Status: ${k}`, Value: v })),
  ...Object.entries(byType).map(([k, v]) => ({ Metric: `Defect type: ${k}`, Value: v })),
]
const sws = XLSX.utils.json_to_sheet(summary, { header: ['Metric', 'Value'] })
sws['!cols'] = [{ wch: 36 }, { wch: 60 }]
XLSX.utils.book_append_sheet(wb, sws, 'Summary')

const xlsxPath = csvPath.replace(/\.csv$/, '.xlsx')
XLSX.writeFile(wb, xlsxPath)

console.log(`Read ${rows.length} stories from ${csvPath}`)
console.log(`Wrote ${xlsxPath}`)
console.log('Status counts:', JSON.stringify(byStatus))
