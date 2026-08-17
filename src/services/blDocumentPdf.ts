// Extração de texto posicionado de um B/L em PDF. Módulo de leitura pura:
// devolve trechos com coordenadas (origem no topo da página), sem regra de
// negócio — a identificação dos campos vive em blDocumentParser.ts.
import type { BlPdfPage, BlTextRun } from './blDocumentSource'

// Distância horizontal, em pontos, abaixo da qual dois trechos na mesma linha
// de base pertencem à mesma palavra/frase. O formulário separa rótulo e valor
// por uma folga bem maior (ex.: "4.Vessel:" termina em 64pt e o nome do navio
// começa em 70pt), então o limite mantém "1" + "." + "Shipper" juntos sem
// colar o valor no rótulo.
const SAME_RUN_GAP = 4
const SAME_LINE_TOLERANCE = 1.5

/**
 * Lê todas as páginas do PDF e devolve os trechos de texto com posição.
 *
 * ponytail: usa o build `legacy` do pdf.js nos dois ambientes (navegador e
 * Node do vitest) para que o teste exercite exatamente o caminho de produção;
 * o build moderno não roda em Node sem polyfill de DOMMatrix. Teto = alguns KB
 * a mais no chunk (que é carregado sob demanda, só na importação). Upgrade
 * path = passar ao build moderno quando o ambiente de teste tiver as APIs de
 * DOM que ele exige.
 */
export async function extractPdfPages(buffer: ArrayBuffer): Promise<BlPdfPage[]> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Só interessa o texto: sem desenhar página, converter fonte ou baixar as
    // fontes padrão não muda o que `getTextContent` devolve, e evita ruído de
    // aviso no console do operador.
    disableFontFace: true,
    verbosity: 0,
  })

  const document = await task.promise
  try {
    const pages: BlPdfPage[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs = content.items
        .flatMap((item) => ('str' in item ? [item] : []))
        .filter((item) => item.str.trim().length > 0)
        .map((item) => ({
          page: number,
          x: item.transform[4] as number,
          // pdf.js entrega a linha de base com origem no rodapé; a leitura do
          // formulário fica muito mais simples de cima para baixo.
          y: viewport.height - (item.transform[5] as number),
          width: item.width,
          height: item.height,
          text: item.str.replace(/\s+/g, ' ').trim(),
        }))

      pages.push({ number, width: viewport.width, height: viewport.height, runs: mergeAdjacentRuns(runs) })
    }
    return pages
  } finally {
    await task.destroy()
  }
}

/**
 * Junta trechos vizinhos da mesma linha. O gerador do PDF quebra um rótulo em
 * vários comandos de texto ("6" + ".Port of Discharge:"), e sem essa junção
 * nenhum rótulo do formulário seria reconhecido.
 */
export function mergeAdjacentRuns(runs: BlTextRun[]): BlTextRun[] {
  const ordered = [...runs].sort((left, right) => left.y - right.y || left.x - right.x)
  const merged: BlTextRun[] = []

  for (const run of ordered) {
    const previous = merged[merged.length - 1]
    const sameLine =
      previous && previous.page === run.page && Math.abs(previous.y - run.y) <= SAME_LINE_TOLERANCE
    const gap = previous ? run.x - (previous.x + previous.width) : Number.POSITIVE_INFINITY

    if (previous && sameLine && gap <= SAME_RUN_GAP && gap > -previous.width) {
      previous.text = gap > 1 ? `${previous.text} ${run.text}` : `${previous.text}${run.text}`
      previous.width = run.x + run.width - previous.x
      previous.height = Math.max(previous.height, run.height)
      continue
    }

    merged.push({ ...run })
  }

  return merged
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfjsModule> | null = null

function loadPdfjs() {
  pdfjsPromise ??= importPdfjs()
  return pdfjsPromise
}

async function importPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  return pdfjs
}
