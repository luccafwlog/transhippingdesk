import { describe, expect, it } from 'vitest'
import { parseVaziosImportacaoBuffer } from '../vaziosImportacaoImport'
import { jsonToBuffer } from './testWorkbook'

describe('parseVaziosImportacaoBuffer', () => {
  it('mapeia cabecalhos com acentos/variacoes e normaliza tara', async () => {
    const buffer = jsonToBuffer([
      { 'Contêiner': 'MSCU1234567', 'Tipo': '40HC', 'Tara (kg)': '3.800' },
      { 'Contêiner': 'TGHU7654321', 'Tipo': '', 'Tara (kg)': '' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toEqual([
      { rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800 },
      // toNumber('') retorna 0 — comportamento corrente congelado aqui.
      { rowNumber: 3, container_number: 'TGHU7654321', container_type: null, tare_kg: 0 },
    ])
  })

  it('ignora linha sem container e sinaliza formato ISO invalido sem descartar a linha', async () => {
    const buffer = jsonToBuffer([
      { 'Container': '', 'Tipo': '20DV' },
      { 'Container': 'ABC123', 'Tipo': '20DV' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.containers).toHaveLength(1)
    expect(manifest.containers[0].container_number).toBe('ABC123')
    expect(manifest.rowErrors).toEqual([
      { row: 2, message: 'Container ausente — linha ignorada.', raw: expect.anything() },
      { row: 3, message: 'Container ABC123: formato ISO esperado (XXXX0000000).', raw: expect.anything() },
    ])
  })

  it('rejeita planilha vazia com a mensagem original', async () => {
    await expect(parseVaziosImportacaoBuffer(jsonToBuffer([]))).rejects.toThrow('Planilha vazia.')
  })
})
