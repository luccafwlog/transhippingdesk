import { describe, expect, it, vi } from 'vitest'

const { mockGetDocument, mockDestroy } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockDestroy: vi.fn(),
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
  GlobalWorkerOptions: { workerSrc: '' },
}))

import { extractPdfPages } from '../blDocumentPdf'

describe('extractPdfPages', () => {
  it('libera a tarefa do pdf.js quando o carregamento falha', async () => {
    mockDestroy.mockResolvedValue(undefined)
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('PDF inválido')),
      destroy: mockDestroy,
    })

    await expect(extractPdfPages(new ArrayBuffer(0))).rejects.toThrow('PDF inválido')
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })
})
