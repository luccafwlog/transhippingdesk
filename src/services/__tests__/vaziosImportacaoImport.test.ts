import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importVaziosImportacaoManifest, parseVaziosImportacaoBuffer } from '../vaziosImportacaoImport'
import { aoaToBuffer, jsonToBuffer } from './testWorkbook'

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))

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

  it('S03: rejeita arquivo sem o marcador estrutural Container', async () => {
    await expect(parseVaziosImportacaoBuffer(jsonToBuffer([{ Tipo: '40HC', Tara: 3800 }]))).rejects.toThrow(/Container/)
  })

  it('S03: localiza o cabeçalho de Vazios IMP após o preâmbulo e preserva a linha de origem', async () => {
    const manifest = await parseVaziosImportacaoBuffer(aoaToBuffer([
      ['VAZIOS IMP — COSCO'],
      ['Atualizado em 09/09/2026'],
      ['Container', 'Tipo', 'Tara'],
      ['MSCU1234567', '40HC', 3800],
    ]))

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers[0]).toMatchObject({ rowNumber: 4, container_number: 'MSCU1234567' })
  })

  it('S03: valida a fixture QA anonimizada em CSV do fluxo de Vazios IMP', async () => {
    const file = readFileSync(resolve(process.cwd(), 'test-fixtures/qa-vazios-importacao.csv'))
    const manifest = await parseVaziosImportacaoBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))

    expect(manifest.rowErrors).toEqual([])
    expect(manifest.containers).toHaveLength(2)
    expect(manifest.containers.map((container) => container.container_number)).toEqual(['TEMU1234567', 'TGHU7654325'])
  })

  it('S03: o importador não chama a RPC quando o preview traz divergências', async () => {
    rpcMock.mockReset()

    await expect(importVaziosImportacaoManifest({
      manifest: {
        containers: [{ rowNumber: 2, container_number: 'MSCU1234567', container_type: '40HC', tare_kg: 3800 }],
        rowErrors: [{ row: 2, message: 'Container inválido.', raw: { Container: 'MSCU1234567' } }],
      },
      uploadedBy: 'user-1',
      voyageId: 7,
    })).rejects.toThrow('Linha 2')

    expect(rpcMock).not.toHaveBeenCalled()
  })
})
