import { describe, expect, it, vi } from 'vitest'
import { parseCustomerBaseFile } from '../customerBase'
import { parsePixExtractFile } from '../demurrage/demurrageKpis'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

function oversizedFile(name: string) {
  const file = new File(['tiny'], name)
  const arrayBuffer = vi.fn()
  Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 })
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
  return { file, arrayBuffer }
}

describe('upload limits', () => {
  it('rejeita base de clientes acima do limite antes de ler o arquivo', async () => {
    const { file, arrayBuffer } = oversizedFile('clientes.xlsx')

    await expect(parseCustomerBaseFile(file)).rejects.toThrow('Arquivo muito grande')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('rejeita extrato PIX acima do limite antes de ler o arquivo', async () => {
    const { file, arrayBuffer } = oversizedFile('pix.xlsx')

    await expect(parsePixExtractFile(file)).rejects.toThrow('Arquivo muito grande')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
})
