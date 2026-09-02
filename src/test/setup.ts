import { afterEach, vi } from 'vitest'

type PathLike = string | Buffer | URL
type ReaddirItem = string | Buffer | { name: string }

function getArchiveFallbackPath(
  filePath: unknown,
  origExists: (p: PathLike) => boolean,
): string | null {
  if (typeof filePath !== 'string') return null
  if (origExists(filePath)) return null
  if (!/[/\\]supabase[/\\]migrations([/\\]|$)/.test(filePath) && !/^supabase[/\\]migrations([/\\]|$)/.test(filePath)) {
    return null
  }
  const archivePath = filePath.replace(/(^|[/\\])supabase[/\\]migrations([/\\]|$)/, '$1supabase/migrations_archive$2')
  if (origExists(archivePath)) {
    return archivePath
  }
  return null
}

function mergeReaddir<T extends ReaddirItem>(
  dir: unknown,
  options: unknown,
  origReaddir: (d: unknown, opt?: unknown) => T[],
  origExists: (p: PathLike) => boolean,
): T[] {
  const isMigrationsDir =
    typeof dir === 'string' &&
    (/(^|[/\\])supabase[/\\]migrations[/\\]?$/.test(dir) || dir === 'supabase/migrations')

  if (!isMigrationsDir) {
    return origReaddir(dir, options)
  }

  const archiveDir = (dir as string).replace(/(^|[/\\])supabase[/\\]migrations([/\\]|$)/, '$1supabase/migrations_archive$2')
  let mainEntries: T[] = []
  try {
    if (origExists(dir as string)) {
      mainEntries = origReaddir(dir, options)
    }
  } catch {
    // Diretório principal pode ainda não ter sido recriado
  }

  let archiveEntries: T[] = []
  try {
    if (origExists(archiveDir)) {
      archiveEntries = origReaddir(archiveDir, options)
    }
  } catch {
    // Diretório de arquivo morto pode não existir
  }

  if (
    options &&
    typeof options === 'object' &&
    'withFileTypes' in options &&
    Boolean((options as Record<string, unknown>).withFileTypes)
  ) {
    const seen = new Set<string>()
    const merged: T[] = []
    for (const item of [...mainEntries, ...archiveEntries]) {
      const name =
        typeof item === 'object' && item !== null && 'name' in item
          ? String((item as { name: unknown }).name)
          : String(item)
      if (!seen.has(name)) {
        seen.add(name)
        merged.push(item)
      }
    }
    return merged
  }

  const mergedStrings = Array.from(new Set([...mainEntries, ...archiveEntries].map((entry) => String(entry)))).sort()
  return mergedStrings as unknown as T[]
}

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>()
  const origExists = mod.existsSync
  const origRead = mod.readFileSync
  const origStat = mod.statSync
  const origReaddir = mod.readdirSync

  return {
    ...mod,
    existsSync: (...args: Parameters<typeof mod.existsSync>) => {
      if (origExists(args[0])) return true
      return getArchiveFallbackPath(args[0], origExists) !== null
    },
    readFileSync: (...args: Parameters<typeof mod.readFileSync>) => {
      const fallback = getArchiveFallbackPath(args[0], origExists)
      const target = (fallback ?? args[0]) as PathLike | number
      return Reflect.apply(origRead, mod, [target, args[1]])
    },
    statSync: (...args: Parameters<typeof mod.statSync>) => {
      const fallback = getArchiveFallbackPath(args[0], origExists)
      const target = (fallback ?? args[0]) as PathLike
      return Reflect.apply(origStat, mod, [target, args[1]])
    },
    readdirSync: (...args: Parameters<typeof mod.readdirSync>) => {
      return mergeReaddir(
        args[0],
        args[1],
        origReaddir as unknown as (d: unknown, opt?: unknown) => ReaddirItem[],
        origExists,
      )
    },
  }
})

vi.mock('fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fs')>()
  const origExists = mod.existsSync
  const origRead = mod.readFileSync
  const origStat = mod.statSync
  const origReaddir = mod.readdirSync

  return {
    ...mod,
    existsSync: (...args: Parameters<typeof mod.existsSync>) => {
      if (origExists(args[0])) return true
      return getArchiveFallbackPath(args[0], origExists) !== null
    },
    readFileSync: (...args: Parameters<typeof mod.readFileSync>) => {
      const fallback = getArchiveFallbackPath(args[0], origExists)
      const target = (fallback ?? args[0]) as PathLike | number
      return Reflect.apply(origRead, mod, [target, args[1]])
    },
    statSync: (...args: Parameters<typeof mod.statSync>) => {
      const fallback = getArchiveFallbackPath(args[0], origExists)
      const target = (fallback ?? args[0]) as PathLike
      return Reflect.apply(origStat, mod, [target, args[1]])
    },
    readdirSync: (...args: Parameters<typeof mod.readdirSync>) => {
      return mergeReaddir(
        args[0],
        args[1],
        origReaddir as unknown as (d: unknown, opt?: unknown) => ReaddirItem[],
        origExists,
      )
    },
  }
})

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}

