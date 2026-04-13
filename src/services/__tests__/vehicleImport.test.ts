import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importVehicleRows, parseVehicleImportBuffer, type VehicleImportRow } from '../vehicleImport'
import { jsonToBuffer } from './testWorkbook'

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
})
