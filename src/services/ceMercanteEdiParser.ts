import { assertUploadFile } from '../lib/fileGuard'
import { onlyDigits } from '../lib/utils'

// Parser do arquivo EDI de CE Mercante (layout posicional do Mercante/Siscomex
// Carga). Cada linha e um registro identificado pela primeira letra:
//   M = cabecalho do manifesto (1 por arquivo)
//   C = conhecimento (1 por BL) -> contem o CE Mercante e o numero do BL
//   I = item de carga dentro do BL (N por BL) -> ignorado, redundante
// Os campos de cada registro sao separados por blocos de 2+ espacos.

export type CeMercanteEdiRow = {
  lineNumber: number
  bl_id: string
  ce_mercante: string
}

export type ParsedCeMercanteEdi = {
  manifestRef: string | null
  rows: CeMercanteEdiRow[]
  rowErrors: Array<{ line: number; message: string; raw: string }>
}

const CE_MERCANTE_LENGTH = 15

export async function parseCeMercanteEdiFile(file: File): Promise<ParsedCeMercanteEdi> {
  assertUploadFile(file, ['edi', 'txt'])
  const text = await file.text()
  return parseCeMercanteEdiText(text)
}

export function parseCeMercanteEdiText(text: string): ParsedCeMercanteEdi {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  const rows: CeMercanteEdiRow[] = []
  const rowErrors: ParsedCeMercanteEdi['rowErrors'] = []
  const seenBls = new Set<string>()
  const seenCes = new Set<string>()
  let manifestRef: string | null = null

  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/\s+$/g, '')
    if (!line.trim()) return

    const type = line[0]
    const lineNumber = index + 1

    if (type === 'M') {
      const tokens = line.trim().split(/\s{2,}/)
      manifestRef = tokens[1] ?? null
      return
    }

    // Apenas registros C carregam o vinculo CE <-> BL. I e demais sao ignorados.
    if (type !== 'C') return

    const tokens = line.trim().split(/\s{2,}/)
    if (tokens.length < 3) {
      rowErrors.push({ line: lineNumber, message: 'Registro C sem CE/BL identificaveis.', raw: rawLine })
      return
    }

    const ce_mercante = onlyDigits(tokens[1] ?? '')
    const bl_id = (tokens[tokens.length - 1] ?? '').toUpperCase()

    if (!bl_id || !ce_mercante) {
      rowErrors.push({ line: lineNumber, message: 'CE Mercante ou BL ausente no registro C.', raw: rawLine })
      return
    }

    if (ce_mercante.length !== CE_MERCANTE_LENGTH) {
      rowErrors.push({
        line: lineNumber,
        message: `CE Mercante invalido para o BL ${bl_id}: esperado ${CE_MERCANTE_LENGTH} digitos, recebido ${ce_mercante.length}.`,
        raw: rawLine,
      })
      return
    }

    if (seenBls.has(bl_id)) {
      rowErrors.push({
        line: lineNumber,
        message: `BL ${bl_id} repetido no arquivo (mais de um CE).`,
        raw: rawLine,
      })
      return
    }

    if (seenCes.has(ce_mercante)) {
      rowErrors.push({
        line: lineNumber,
        message: `CE Mercante ${ce_mercante} duplicado no arquivo.`,
        raw: rawLine,
      })
      return
    }

    seenBls.add(bl_id)
    seenCes.add(ce_mercante)
    rows.push({ lineNumber, bl_id, ce_mercante })
  })

  return { manifestRef, rows, rowErrors }
}
