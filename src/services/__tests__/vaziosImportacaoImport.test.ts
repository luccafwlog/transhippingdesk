import { describe, expect, it } from 'vitest'
import { parseVaziosImportacaoBuffer } from '../vaziosImportacaoImport'
import { jsonToBuffer } from './testWorkbook'

describe('parseVaziosImportacaoBuffer', () => {
  it('mapeia cabecalhos com acentos/variacoes e normaliza tara e rotas (Origem / Destino)', async () => {
    const buffer = jsonToBuffer([
      { 'Contêiner': 'MSCU1234567', 'Tipo': '40HC', 'Tara (kg)': '3.800', 'Origem': 'CNTAC', 'Destino': 'BRVIX' },
      { 'Contêiner': 'TGHU7654321', 'Tipo': '', 'Tara (kg)': '', 'Origem': 'CNSHA', 'Destino': 'BRSSZ' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toEqual([
      { rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800, pol: 'CNTAC', pod: 'BRVIX' },
      // Ausência não é tara zero: preservamos a diferença entre empty e value 0.
      { rowNumber: 3, container_number: 'TGHU7654321', container_type: null, tare_kg: null, pol: 'CNSHA', pod: 'BRSSZ' },
    ])
  })

  it('não transforma texto inválido ou expoente em tara zero', async () => {
    const buffer = jsonToBuffer([
      { Container: 'MSCU1234567', 'Tare (kg)': '1e3' },
      { Container: 'TGHU7654321', 'Tare (kg)': '12abc' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.containers.map((container) => container.tare_kg)).toEqual([null, null])
    expect(manifest.rowErrors).toHaveLength(2)
  })

  it('mapeia cabecalhos em ingles (POL / POD)', async () => {
    const buffer = jsonToBuffer([
      { 'Container': 'MSCU1234567', 'Type': '40HC', 'Tare (kg)': '3800', 'POL': 'CNTAC', 'POD': 'BRVIX' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toEqual([
      { rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800, pol: 'CNTAC', pod: 'BRVIX' },
    ])
  })

  it('canoniza caixa do ISO e dos portos e bloqueia porto nao reconhecido', async () => {
    const buffer = jsonToBuffer([
      { Container: 'mscu1234567', Tipo: '40hc', Tara: '3800', Origem: 'Vitoria', Destino: 'porto inexistente' },
    ])

    const manifest = await parseVaziosImportacaoBuffer(buffer)

    expect(manifest.containers[0]).toMatchObject({
      container_number: 'MSCU1234567',
      container_type: '40HC',
      pol: 'BRVIX',
      pod: 'PORTO INEXISTENTE',
    })
    expect(manifest.rowErrors).toEqual([
      expect.objectContaining({ row: 2, message: expect.stringContaining('POD') }),
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
