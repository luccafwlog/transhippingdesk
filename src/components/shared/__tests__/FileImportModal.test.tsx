// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ToastProvider } from '../../ui/Toast'
import { FileImportModal } from '../FileImportModal'

it('mostra o formato e o encoding detectados junto da prévia do arquivo', async () => {
  const inspectFile = vi.fn().mockResolvedValue({
    format: 'csv',
    encoding: 'utf-8-sig',
    hadBom: true,
    preview: 'BL;Cidade\n1;Vitória',
    byteLength: 21,
  })

  const { container } = render(
    <ToastProvider>
      <FileImportModal
        title="Importar arquivo"
        accept=".csv"
        parser={async () => ({ rows: 1 })}
        inspectFile={inspectFile}
        canImport={() => true}
        renderPreview={(preview) => <div>Linhas: {preview.rows}</div>}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  )

  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['BL;Cidade\n1;Vitória'], 'dados.csv')] },
  })

  await waitFor(() => expect(inspectFile).toHaveBeenCalled())
  const inspection = screen.getByRole('status')
  expect(inspection.textContent).toContain('Formato detectado: CSV')
  expect(inspection.textContent).toContain('Encoding: UTF-8 com BOM')
  expect(inspection.textContent).toContain('BOM: presente')
  expect(inspection.textContent).toContain('BL;Cidade')
  expect(screen.getByText('Linhas: 1')).toBeTruthy()
})
