// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCancellableFileRead } from '../useCancellableFileRead'

it('cancela uma leitura pendente e descarta a prévia que chegar depois', async () => {
  let release!: (value: string) => void
  const parser = vi.fn(() => new Promise<string>((resolve) => { release = resolve }))
  const { result } = renderHook(() => useCancellableFileRead(parser))
  const file = new File(['conteudo'], 'dados.csv')

  let pending!: Promise<string | null>
  act(() => {
    pending = result.current.readFile(file)
  })

  expect(result.current.parsing).toBe(true)
  expect(result.current.progress).toEqual({ completed: 0, total: 1, currentFile: 'dados.csv' })

  act(() => result.current.cancel())
  release('prévia tardia')
  await act(async () => { await pending })

  expect(result.current.parsing).toBe(false)
  expect(result.current.file).toBeNull()
  expect(result.current.preview).toBeNull()
  expect(result.current.progress).toEqual({ completed: 0, total: 0, currentFile: null })
})

it('publica a prévia e conclui o progresso em uma leitura válida', async () => {
  const parser = vi.fn().mockResolvedValue({ rows: 2 })
  const { result } = renderHook(() => useCancellableFileRead(parser))
  const file = new File(['A;B'], 'dados.csv')

  await act(async () => {
    await result.current.readFile(file)
  })

  expect(result.current.preview).toEqual({ rows: 2 })
  expect(result.current.parsing).toBe(false)
  expect(result.current.progress).toEqual({ completed: 1, total: 1, currentFile: 'dados.csv' })
})

it('processa vários arquivos em sequência e contabiliza erros por arquivo', async () => {
  const parser = vi.fn(async (file: File) => {
    if (file.name === 'falho.csv') throw new Error('arquivo inválido')
    return file.name
  })
  const onFileError = vi.fn()
  const { result } = renderHook(() => useCancellableFileRead(parser))
  const files = [
    new File(['A'], 'primeiro.csv'),
    new File(['B'], 'falho.csv'),
    new File(['C'], 'ultimo.csv'),
  ]

  let previews!: string[] | null
  await act(async () => {
    previews = await result.current.readFiles(files, onFileError)
  })

  expect(previews).toEqual(['primeiro.csv', 'ultimo.csv'])
  expect(onFileError).toHaveBeenCalledWith(expect.any(Error), files[1])
  expect(result.current.progress).toEqual({ completed: 3, total: 3, currentFile: 'ultimo.csv' })
})
