import { useCallback, useEffect, useRef, useState } from 'react'

export type FileReadProgress = {
  completed: number
  total: number
  currentFile: string | null
}

type FileReadState<T> = {
  file: File | null
  preview: T | null
  parsing: boolean
  progress: FileReadProgress
}

const EMPTY_PROGRESS: FileReadProgress = { completed: 0, total: 0, currentFile: null }

/**
 * Coordena uma leitura de arquivo que não aceita AbortSignal no parser legado.
 * O token de operação impede que uma resposta tardia publique estado ou seja
 * confundida com a próxima seleção.
 */
export function useCancellableFileRead<T>(parser: (file: File) => Promise<T>) {
  const [state, setState] = useState<FileReadState<T>>({
    file: null,
    preview: null,
    parsing: false,
    progress: EMPTY_PROGRESS,
  })
  const operationRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const nextOperationIdRef = useRef(0)

  useEffect(() => () => {
    operationRef.current?.controller.abort()
    nextOperationIdRef.current += 1
  }, [])

  const cancel = useCallback(() => {
    operationRef.current?.controller.abort()
    operationRef.current = null
    nextOperationIdRef.current += 1
    setState({ file: null, preview: null, parsing: false, progress: EMPTY_PROGRESS })
  }, [])

  const readFile = useCallback(async (file: File | null): Promise<T | null> => {
    cancel()
    if (!file) return null

    const controller = new AbortController()
    const id = nextOperationIdRef.current + 1
    nextOperationIdRef.current = id
    operationRef.current = { id, controller }
    setState({
      file,
      preview: null,
      parsing: true,
      progress: { completed: 0, total: 1, currentFile: file.name },
    })

    const isActive = () => operationRef.current?.id === id && !controller.signal.aborted
    try {
      const preview = await parser(file)
      if (!isActive()) return null
      setState({
        file,
        preview,
        parsing: false,
        progress: { completed: 1, total: 1, currentFile: file.name },
      })
      return preview
    } catch (error) {
      if (isActive()) throw error
      return null
    } finally {
      if (operationRef.current?.id === id) {
        operationRef.current = null
        setState((current) => current.parsing ? { ...current, parsing: false } : current)
      }
    }
  }, [cancel, parser])

  const readFiles = useCallback(async (
    files: readonly File[],
    onFileError?: (error: unknown, file: File) => void,
  ): Promise<T[] | null> => {
    cancel()
    if (!files.length) return []

    const controller = new AbortController()
    const id = nextOperationIdRef.current + 1
    nextOperationIdRef.current = id
    operationRef.current = { id, controller }
    setState({
      file: files[0],
      preview: null,
      parsing: true,
      progress: { completed: 0, total: files.length, currentFile: files[0].name },
    })

    const isActive = () => operationRef.current?.id === id && !controller.signal.aborted
    const previews: T[] = []
    try {
      for (const [index, file] of files.entries()) {
        if (!isActive()) return null
        try {
          previews.push(await parser(file))
        } catch (error) {
          if (!isActive()) return null
          onFileError?.(error, file)
        }
        if (!isActive()) return null
        setState((current) => ({
          ...current,
          progress: {
            completed: index + 1,
            total: files.length,
            currentFile: files[index + 1]?.name ?? file.name,
          },
        }))
      }
      if (!isActive()) return null
      setState((current) => ({
        ...current,
        file: files[files.length - 1] ?? null,
        parsing: false,
        progress: { completed: files.length, total: files.length, currentFile: files[files.length - 1]?.name ?? null },
      }))
      return previews
    } finally {
      if (operationRef.current?.id === id) {
        operationRef.current = null
        setState((current) => current.parsing ? { ...current, parsing: false } : current)
      }
    }
  }, [cancel, parser])

  const updatePreview = useCallback((update: (preview: T) => T) => {
    setState((current) => current.preview === null ? current : { ...current, preview: update(current.preview) })
  }, [])

  return { ...state, readFile, readFiles, cancel, updatePreview }
}
