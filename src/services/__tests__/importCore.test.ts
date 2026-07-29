import { describe, expect, it } from 'vitest'
import { createHeaderMapper, createRowErrorCollector, matchHeaders, readFirstSheetRows, readSheet, type HeaderSpec } from '../importCore'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

describe('createHeaderMapper', () => {
  it('normaliza cabeçalhos (trim + lowercase) e mapeia para a chave canônica', () => {
    const sampleRow = { '  Booking ': 'X', 'CONTAINER': 'Y', 'Coluna Desconhecida': 'Z' }
    const mapRow = createHeaderMapper(sampleRow, {
      'booking': 'booking_number',
      'container': 'container_number',
    })

    expect(mapRow({ '  Booking ': 'BK1', 'CONTAINER': 'MSCU1234567', 'Coluna Desconhecida': 'ignorar' })).toEqual({
      booking_number: 'BK1',
      container_number: 'MSCU1234567',
    })
  })

  it('ignora cabeçalhos sem correspondência no mapa', () => {
    const mapRow = createHeaderMapper({ 'Outra': 1 }, { 'booking': 'booking_number' })
    expect(mapRow({ 'Outra': 1 })).toEqual({})
  })
})

describe('createRowErrorCollector', () => {
  it('acumula erros no formato { row, message, raw }', () => {
    const collector = createRowErrorCollector()
    expect(collector.errors).toEqual([])

    const raw = { bl: '' }
    collector.add(2, 'BL ausente — linha ignorada.', raw)
    collector.add(5, 'BL ABC123 duplicado na planilha.', raw)

    expect(collector.errors).toEqual([
      { row: 2, message: 'BL ausente — linha ignorada.', raw },
      { row: 5, message: 'BL ABC123 duplicado na planilha.', raw },
    ])
  })
})

describe('readFirstSheetRows', () => {
  it('lê a primeira aba como linhas-objeto com defval vazio', async () => {
    const buffer = jsonToBuffer([
      { Booking: 'BK1', Container: 'MSCU1234567' },
      { Booking: 'BK2', Container: '' },
    ])

    const rows = await readFirstSheetRows(buffer)
    expect(rows).toEqual([
      { Booking: 'BK1', Container: 'MSCU1234567' },
      { Booking: 'BK2', Container: '' },
    ])
  })

  it('lança "Planilha vazia." quando só há cabeçalho', async () => {
    const buffer = aoaToBuffer([['Booking', 'Container']])
    await expect(readFirstSheetRows(buffer)).rejects.toThrow('Planilha vazia.')
  })
})

async function buildWorkbook(rows: Record<string, unknown>[]): Promise<ArrayBuffer> {
  const XLSX = await import('@e965/xlsx')
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Plan1')
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('readSheet', () => {
  it('devolve cabecalhos e linhas-objeto da primeira aba', async () => {
    const buffer = await buildWorkbook([{ Container: 'ABCD1234567', Tipo: '40HC' }])
    const { headers, rows } = await readSheet(buffer)
    expect(headers).toEqual(['Container', 'Tipo'])
    expect(rows).toEqual([{ Container: 'ABCD1234567', Tipo: '40HC' }])
  })

  it('devolve datas como texto por padrao', async () => {
    const buffer = await buildWorkbook([{ Data: new Date(Date.UTC(2026, 6, 27)) }])
    const { rows } = await readSheet(buffer)
    expect(rows[0].Data).toBeTypeOf('string')
  })

  it('devolve datas como Date quando solicitado', async () => {
    const buffer = await buildWorkbook([{ Data: new Date(Date.UTC(2026, 6, 27)) }])
    const { rows } = await readSheet(buffer, { dates: 'date' })
    expect(rows[0].Data).toBeInstanceOf(Date)
  })

  it('preenche celula ausente com string vazia', async () => {
    const buffer = await buildWorkbook([{ A: 'x', B: 'y' }, { A: 'z' }])
    const { rows } = await readSheet(buffer)
    expect(rows[1].B).toBe('')
  })

  it('lanca a mensagem historica quando a planilha nao tem linhas', async () => {
    await expect(readSheet(aoaToBuffer([['A']]))).rejects.toThrow('Planilha vazia.')
  })
})

const spec: HeaderSpec<'container' | 'tipo' | 'observacao'> = {
  aliases: {
    container: ['container', 'conteiner', 'n container'],
    tipo: ['tipo', 'type', 'tipo container'],
    observacao: ['observacao', 'obs'],
  },
  required: ['container', 'tipo'],
}

describe('matchHeaders', () => {
  it('casa cabecalhos ignorando caixa, acento e espaco extra', () => {
    const result = matchHeaders(['  CONTÊINER ', 'Tipo Container', 'OBS'], spec)
    expect(result.columnByField).toEqual({ container: '  CONTÊINER ', tipo: 'Tipo Container', observacao: 'OBS' })
    expect(result.missing).toEqual([])
  })

  it('relata apenas colunas obrigatorias ausentes', () => {
    const result = matchHeaders(['Tipo'], spec)
    expect(result.missing).toEqual(['container'])
    expect(result.columnByField.tipo).toBe('Tipo')
  })

  it('nao reclama de coluna opcional ausente', () => {
    const result = matchHeaders(['Container', 'Tipo'], spec)
    expect(result.missing).toEqual([])
    expect(result.columnByField.observacao).toBeUndefined()
  })

  it('usa o primeiro cabecalho que casa em caso de repeticao', () => {
    const result = matchHeaders(['Container', 'Conteiner'], spec)
    expect(result.columnByField.container).toBe('Container')
  })
})
