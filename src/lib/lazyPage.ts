import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type LazyPageStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type LazyPageOptions = {
  pathname?: string
  reload?: () => void
  storage?: LazyPageStorage
}

function getPathname(pathname?: string) {
  return pathname ?? globalThis.location?.pathname ?? '/'
}

function getStorage(storage?: LazyPageStorage) {
  try {
    return storage ?? globalThis.sessionStorage
  } catch {
    return null
  }
}

function markerKey(pathname?: string) {
  return `chunk-reload:${getPathname(pathname)}`
}

function isDynamicImportLoadError(error: unknown) {
  if (!(error instanceof TypeError)) return false

  const message = error.message.toLowerCase()
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('importing a module script failed')
  )
}

export function createLazyPageLoader<T extends Record<string, unknown>, K extends keyof T & string>(
  loader: () => Promise<T>,
  exportName: K,
  options: LazyPageOptions = {},
) {
  return async () => {
    const storage = getStorage(options.storage)
    const key = markerKey(options.pathname)

    try {
      const module = await loader()
      storage?.removeItem(key)
      return { default: module[exportName] as ComponentType }
    } catch (error) {
      if (isDynamicImportLoadError(error) && storage && storage.getItem(key) !== '1') {
        storage.setItem(key, '1')
        ;(options.reload ?? globalThis.location?.reload.bind(globalThis.location))?.()
        return new Promise<never>(() => {})
      }

      throw error
    }
  }
}

export function lazyPage<T extends Record<string, unknown>, K extends keyof T & string>(
  loader: () => Promise<T>,
  exportName: K,
) {
  let promise: ReturnType<typeof createLazyPageLoader<T, K>> | undefined
  const load = () => {
    promise ??= createLazyPageLoader(loader, exportName)()
    return promise.catch((error) => {
      promise = undefined
      throw error
    })
  }
  const component = lazy(load) as LazyExoticComponent<ComponentType> & { preload: () => Promise<unknown> }
  component.preload = load
  return component
}
