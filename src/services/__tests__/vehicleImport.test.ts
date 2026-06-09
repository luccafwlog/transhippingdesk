import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importVehicleRows, parseVehicleImportBuffer, type VehicleImportRow } from '../vehicleImport'
import { jsonToBuffer, sheetsToBuffer } from './testWorkbook'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

describe('vehicleImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('parseia a planilha de veiculos com o novo campo modelo', async () => {
    const buffer = jsonToBuffer([
      {
        CHASSI: '9BWZZZ377VT004251',
        MARCA: 'BYD',
        MODELO: 'DOLPHIN',
        PESO: '1.650,50',
        CUBAGEM: '12,3',
        CONTAINER: 'CAXU1234567',
        TIPO_CONTAINER: '40FM',
        LACRE: 'SEL123',
        BL: 'BL001',
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.model).toBe('DOLPHIN')
    expect(parsed.rows[0]?.weight_kg).toBeCloseTo(1650.5)
    expect(parsed.rows[0]?.container_number).toBe('CAXU1234567')
  })

  it('mapeia o modelo do armador (COSCO Daily Report) escolhendo a aba de veiculos', async () => {
    // 1a aba: resumo (pivot) sem colunas de veiculo. 2a aba: dados reais.
    const buffer = sheetsToBuffer([
      {
        name: 'Planilha1',
        rows: [{ Brand: 'BYD', 'QTY VIN': 2136 }],
      },
      {
        name: 'Sheet1',
        rows: [
          {
            'Item NO#': 1,
            Vessel: 'COSCO SHIPPING XING WANG',
            Voyage: 31,
            Brand: 'BYD',
            Model: 'SONG PLUS DM-i',
            'VIN NO.': 'LGXC74C44V0007087',
            'GW(kg)': 1970,
            Volume: 15.047,
            'BL NUMBER': 'CSC07870X00V00',
            'Cntr Type': '48FR',
            'Cntr No.': 'CAXU5746573',
            Seal: '035744',
          },
        ],
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      chassis: 'LGXC74C44V0007087',
      brand: 'BYD',
      model: 'SONG PLUS DM-i',
      weight_kg: 1970,
      cbm: 15.047,
      container_number: 'CAXU5746573',
      container_type: '48FR',
      seal_number: '035744',
      bl_id: 'CSC07870X00V00',
    })
  })

  it('mapeia a lista de VINs dos terminais chineses da COSCO (cabecalhos em chines)', async () => {
    const buffer = jsonToBuffer([
      {
        序号: 1,
        船名: 'GREEN ITAPOA',
        航次: '6',
        品牌: '比亚迪',
        型号: 'DOLPHIN',
        VIN: 'LC0CE4CC4V0018347',
        毛重: '1405 ',
        体积: '11.694 ',
        提单号: 'CSC45350600100',
        箱型: '40HC',
        箱号: 'BEAU6464201',
        封号: '156000',
      },
    ])

    const parsed = await parseVehicleImportBuffer(buffer)

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      chassis: 'LC0CE4CC4V0018347',
      brand: '比亚迪',
      model: 'DOLPHIN',
      weight_kg: 1405,
      cbm: 11.694,
      container_number: 'BEAU6464201',
      container_type: '40HC',
      seal_number: '156000',
      bl_id: 'CSC45350600100',
    })
  })

  it('valida duplicidade de chassi e consistencia BL-container antes de inserir', async () => {
    const insertedRows: Array<Record<string, unknown>> = []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [],
                error: null,
              }),
            }),
          }),
          insert: async (rows: Array<Record<string, unknown>>) => {
            insertedRows.push(...rows)
            return { error: null }
          },
        }
      }

      if (table === 'bls') {
        return {
          select: () => ({
            eq: () => ({
              in: async (_column: string, values: string[]) => ({
                data: values
                  .filter((value) => value === 'BL001' || value === 'BL002')
                  .map((value) => ({ id: value, voyage_id: 7 })),
                error: null,
              }),
            }),
          }),
          update: () => ({
            in: async () => ({ error: null }),
          }),
        }
      }

      if (table === 'bl_containers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: [
                      {
                        id: 11,
                        bl_id: 'BL001',
                        container_number: 'CAXU1234567',
                        type: '40FM',
                        seal_number: 'SEL123',
                        bl: { voyage_id: 7 },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows: VehicleImportRow[] = [
      {
        rowNumber: 2,
        chassis: 'CHASSI-001',
        brand: 'BYD',
        model: 'DOLPHIN',
        weight_kg: 1600,
        cbm: 12,
        container_number: 'CAXU1234567',
        container_type: '40FM',
        seal_number: 'SEL123',
        bl_id: 'BL001',
      },
      {
        rowNumber: 3,
        chassis: 'CHASSI-001',
        brand: 'BYD',
        model: 'DOLPHIN',
        weight_kg: 1600,
        cbm: 12,
        container_number: 'CAXU1234567',
        container_type: '40FM',
        seal_number: 'SEL123',
        bl_id: 'BL001',
      },
      {
        rowNumber: 4,
        chassis: 'CHASSI-002',
        brand: 'BYD',
        model: 'SEAL',
        weight_kg: 1700,
        cbm: 11,
        container_number: 'CAXU1234567',
        container_type: '40FM',
        seal_number: 'SEL123',
        bl_id: 'BL002',
      },
      {
        rowNumber: 5,
        chassis: 'CHASSI-003',
        brand: 'BYD',
        model: 'SEAL',
        weight_kg: 1700,
        cbm: 11,
        container_number: 'MSCU0000000',
        container_type: '40FM',
        seal_number: 'SEL000',
        bl_id: 'BL404',
      },
    ]

    const result = await importVehicleRows({ voyageId: 7, rows })

    expect(result.processed).toBe(4)
    expect(result.successCount).toBe(1)
    expect(result.errorCount).toBe(3)
    expect(result.errors.map((error) => error.message)).toEqual([
      'Chassi duplicado no arquivo para a viagem selecionada.',
      'BL nao pertence ao container informado.',
      'BL nao encontrado na viagem selecionada.',
    ])
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]?.bl_id).toBe('BL001')
    expect(insertedRows[0]?.container_id).toBe(11)
  })

  it('rejeita linha quando mais de um container atende ao mesmo tipo e lacre', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [],
                error: null,
              }),
            }),
          }),
          insert: async () => ({ error: null }),
        }
      }

      if (table === 'bls') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: [{ id: 'BL001', voyage_id: 7 }],
                error: null,
              }),
            }),
          }),
          update: () => ({
            in: async () => ({ error: null }),
          }),
        }
      }

      if (table === 'bl_containers') {
        return {
          select: () => ({
            in: () => ({
              eq: () => ({
                order: () => ({
                  range: async () => ({
                    data: [
                      {
                        id: 11,
                        bl_id: 'BL001',
                        container_number: 'CAXU1234567',
                        type: '40FM',
                        seal_number: 'SEL123',
                        bl: { voyage_id: 7 },
                      },
                      {
                        id: 12,
                        bl_id: 'BL001',
                        container_number: 'CAXU1234567',
                        type: '40FM',
                        seal_number: 'SEL123',
                        bl: { voyage_id: 7 },
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const result = await importVehicleRows({
      voyageId: 7,
      rows: [
        {
          rowNumber: 2,
          chassis: 'CHASSI-AMB',
          brand: 'BYD',
          model: 'SEAL',
          weight_kg: 1700,
          cbm: 11,
          container_number: 'CAXU1234567',
          container_type: '40FM',
          seal_number: 'SEL123',
          bl_id: 'BL001',
        },
      ],
    })

    expect(result.successCount).toBe(0)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]?.message).toContain('Mais de um container desta BL')
  })
})
