import { useCallback, useMemo, useState } from 'react'

type RowKey = string | number

/**
 * Selecao de linhas baseada em Set, sem logica de dominio. Compartilhada pelas
 * listagens que oferecem acoes em massa (exclusao de BLs, containers, veiculos,
 * clientes). Mantem apenas as chaves selecionadas; a pagina decide o que sao.
 */
export function useRowSelection<K extends RowKey = RowKey>() {
  const [selected, setSelected] = useState<Set<K>>(() => new Set<K>())

  const isSelected = useCallback((key: K) => selected.has(key), [selected])

  const toggle = useCallback((key: K) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Marca todas as chaves informadas; se todas ja estiverem marcadas, desmarca-as.
  const toggleMany = useCallback((keys: K[]) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = keys.length > 0 && keys.every((key) => next.has(key))
      for (const key of keys) {
        if (allSelected) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set<K>()), [])

  const count = selected.size

  return useMemo(
    () => ({ selected, isSelected, toggle, toggleMany, clear, count }),
    [selected, isSelected, toggle, toggleMany, clear, count],
  )
}
