import { describe, expect, it } from 'vitest'
import { parseContainerDatesFile } from '../containerDatesImport'
import { jsonToBuffer } from './testWorkbook'

describe('containerDatesImport', () => {
  it('aceita linha com devolucao opcional em branco', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '2026-01-10', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toEqual([{
      bl_id: 'BL001',
      container_number: 'TCLU1234567',
      discharge_date: '2026-01-10',
      return_date: null,
    }])
  })

  it('rejeita devolucao anterior a descarga', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'BL001',
        Container: 'TCLU1234567',
        Descarga: '2026-01-10',
        Devolucao: '2026-01-09',
      },
    ])
    const file = new File([buffer], 'datas-container.xlsx')

    const parsed = await parseContainerDatesFile(file)

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('Data de devolucao anterior a descarga')
  })

  it('rejeita linha sem descarga', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('Data de descarga invalida ou ausente')
  })
})
