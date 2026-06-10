import { describe, expect, it } from 'vitest'
import { createHeaderMapper, createRowErrorCollector, readFirstSheetRows } from '../importCore'
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
