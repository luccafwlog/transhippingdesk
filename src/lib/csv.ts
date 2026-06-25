// Neutraliza injecao de formula (CSV/Excel injection): um valor iniciado por
// = + - @ ou tab/CR e interpretado como formula ao abrir no Excel/Sheets.
// Prefixar com aspa simples forca o tratamento como texto literal. Espelha o
// mesmo guard do export XLSX em src/services/exports.ts (dados de celulas vem
// de arquivos de armador importados, nao confiaveis).
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/

export function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const bom = '\uFEFF'
  const escape = (v: string) => {
    let s = String(v ?? '')
    if (FORMULA_INJECTION_PREFIX.test(s)) {
      s = `'${s}`
    }
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  const csv = bom + [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
