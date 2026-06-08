import { describe, expect, it } from 'vitest'
import { parseCeMercanteEdiText } from '../ceMercanteEdiParser'

// Linhas reais (recortadas) do arquivo EDI do Mercante: 1 registro M de
// cabecalho, registros C (1 por BL) e registros I (itens, ignorados).
const SAMPLE = [
  'M50001226501030729                       CNTAGBRVIXCN001321      1051111   7         20260619',
  'C50001226501030729  122605179628557                              CSC45360805C00',
  'I5100010001226501030729  122605179628557                         CSC45360805C00    0001',
  'C50001226501030729  122605179628638                              CSC45360805D00',
  'I5100010001226501030729  122605179628638                         CSC45360805D00    0001',
  'I5100020001226501030729  122605179628638                         CSC45360805D00    0002',
].join('\n')

describe('parseCeMercanteEdiText', () => {
  it('extrai um par CE<->BL por registro C e ignora M e I', () => {
    const parsed = parseCeMercanteEdiText(SAMPLE)

    expect(parsed.manifestRef).toBe('CNTAGBRVIXCN001321')
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.rows).toEqual([
      { lineNumber: 2, bl_id: 'CSC45360805C00', ce_mercante: '122605179628557' },
      { lineNumber: 4, bl_id: 'CSC45360805D00', ce_mercante: '122605179628638' },
    ])
  })

  it('rejeita BL repetido (mais de um CE por BL)', () => {
    const text = [
      'C50001226501030729  122605179628557                              CSC45360805C00',
      'C50001226501030729  122605179628999                              CSC45360805C00',
    ].join('\n')

    const parsed = parseCeMercanteEdiText(text)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0].message).toContain('repetido')
  })

  it('rejeita CE duplicado entre BLs diferentes', () => {
    const text = [
      'C50001226501030729  122605179628557                              CSC45360805C00',
      'C50001226501030729  122605179628557                              CSC45360805D00',
    ].join('\n')

    const parsed = parseCeMercanteEdiText(text)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0].message).toContain('duplicado')
  })

  it('rejeita CE com menos de 15 digitos', () => {
    const text = 'C50001226501030729  12345                              CSC45360805C00'

    const parsed = parseCeMercanteEdiText(text)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0].message).toContain('15 digitos')
  })

  it('normaliza CRLF e BOM', () => {
    const text = '﻿C50001226501030729  122605179628557                              CSC45360805C00\r\n'

    const parsed = parseCeMercanteEdiText(text)
    expect(parsed.rows).toEqual([
      { lineNumber: 1, bl_id: 'CSC45360805C00', ce_mercante: '122605179628557' },
    ])
  })
})
