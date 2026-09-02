import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, vi } from 'vitest'

// Ponte transitória do squash v1.0 (ADR 0062, item 3): `supabase/migrations/`
// agora contém só o schema consolidado (001–004), mas os 201 testes
// `*Migration.test.ts` ainda auditam contratos históricos arquivo a arquivo.
// Este mock redireciona leituras de arquivos ausentes e listagens do diretório
// ativo para `supabase/migrations_archive/`. Custo aceito: esses testes auditam
// arquivos mortos, não o schema aplicado — a cobertura do artefato ativo fica
// com `verificar_guardas.py` e `consolidatedSchemaInvariants.test.ts` (que
// escapa deste mock via `vi.importActual`). Teste novo contra o schema ativo
// DEVE usar `vi.importActual('node:fs')`; teste histórico continua caindo aqui.

type PathLike = string | Buffer | URL
type ReaddirItem = string | Buffer | { name: string }

function getArchiveFallbackPath(
  filePath: unknown,
  origExists: (p: PathLike) => boolean,
): PathLike | null {
  if (!filePath) return null
  let pathStr: string
  const isUrl = filePath instanceof URL || (typeof filePath === 'object' && filePath !== null && 'href' in filePath)
  if (isUrl) {
    try {
      pathStr = fileURLToPath(filePath as URL)
    } catch {
      return null
    }
  } else if (typeof filePath === 'string') {
    pathStr = filePath
  } else if (Buffer.isBuffer(filePath)) {
    pathStr = filePath.toString('utf8')
  } else {
    return null
  }

  if (origExists(filePath as PathLike)) return null
  const normalized = pathStr.replace(/\\/g, '/')
  if (!normalized.includes('supabase/migrations/')) return null
  const archivePathNormalized = normalized.replace('supabase/migrations/', 'supabase/migrations_archive/')
  const archivePath = pathStr.includes('\\')
    ? archivePathNormalized.replace(/\//g, '\\')
    : archivePathNormalized
  if (origExists(archivePath)) {
    return isUrl ? pathToFileURL(archivePath) : archivePath
  }
  return null
}

function mergeReaddir<T extends ReaddirItem>(
  dir: unknown,
  options: unknown,
  origReaddir: (d: unknown, opt?: unknown) => T[],
  origExists: (p: PathLike) => boolean,
): T[] {
  const normalizedDir = typeof dir === 'string' ? dir.replace(/\\/g, '/') : ''
  const isMigrationsDir =
    normalizedDir.endsWith('supabase/migrations') ||
    normalizedDir.endsWith('supabase/migrations/')

  if (!isMigrationsDir) {
    return origReaddir(dir, options)
  }

  const archiveDir = (dir as string).replace(
    /(^|[/\\])supabase([/\\])migrations([/\\]|$)/,
    (_match, p1, sep, p3) => `${p1}supabase${sep}migrations_archive${p3}`,
  )

  if (origExists(archiveDir)) {
    const rawEntries = origReaddir(archiveDir, options)
    return (rawEntries as unknown as Array<string | { name: string }>).filter((entry) => {
      const name =
        typeof entry === 'object' && entry !== null && 'name' in entry
          ? String((entry as { name: unknown }).name)
          : String(entry)
      return name.endsWith('.sql')
    }) as unknown as T[]
  }

  return origReaddir(dir, options)
}

vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>()
  const origExists = mod.existsSync
  const origRead = mod.readFileSync
  const origStat = mod.statSync
  const origReaddir = mod.readdirSync

  const existsSync = (...args: Parameters<typeof mod.existsSync>) => {
    if (origExists(args[0])) return true
    return getArchiveFallbackPath(args[0], origExists) !== null
  }
  const readFileSync = (...args: Parameters<typeof mod.readFileSync>) => {
    const fallback = getArchiveFallbackPath(args[0], origExists)
    const target = (fallback ?? args[0]) as PathLike | number
    return Reflect.apply(origRead, mod, [target, args[1]])
  }
  const statSync = (...args: Parameters<typeof mod.statSync>) => {
    const fallback = getArchiveFallbackPath(args[0], origExists)
    const target = (fallback ?? args[0]) as PathLike
    return Reflect.apply(origStat, mod, [target, args[1]])
  }
  const readdirSync = (...args: Parameters<typeof mod.readdirSync>) => {
    return mergeReaddir(
      args[0],
      args[1],
      origReaddir as unknown as (d: unknown, opt?: unknown) => ReaddirItem[],
      origExists,
    )
  }

  const mocked = {
    ...mod,
    existsSync,
    readFileSync,
    statSync,
    readdirSync,
  }

  const defaultExport = ((mod as Record<string, unknown>).default as object | undefined) ?? mod

  return {
    ...mocked,
    default: {
      ...defaultExport,
      existsSync,
      readFileSync,
      statSync,
      readdirSync,
    },
  }
})

vi.mock('fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('fs')>()
  const origExists = mod.existsSync
  const origRead = mod.readFileSync
  const origStat = mod.statSync
  const origReaddir = mod.readdirSync

  const existsSync = (...args: Parameters<typeof mod.existsSync>) => {
    if (origExists(args[0])) return true
    return getArchiveFallbackPath(args[0], origExists) !== null
  }
  const readFileSync = (...args: Parameters<typeof mod.readFileSync>) => {
    const fallback = getArchiveFallbackPath(args[0], origExists)
    const target = (fallback ?? args[0]) as PathLike | number
    return Reflect.apply(origRead, mod, [target, args[1]])
  }
  const statSync = (...args: Parameters<typeof mod.statSync>) => {
    const fallback = getArchiveFallbackPath(args[0], origExists)
    const target = (fallback ?? args[0]) as PathLike
    return Reflect.apply(origStat, mod, [target, args[1]])
  }
  const readdirSync = (...args: Parameters<typeof mod.readdirSync>) => {
    return mergeReaddir(
      args[0],
      args[1],
      origReaddir as unknown as (d: unknown, opt?: unknown) => ReaddirItem[],
      origExists,
    )
  }

  const mocked = {
    ...mod,
    existsSync,
    readFileSync,
    statSync,
    readdirSync,
  }

  const defaultExport = ((mod as Record<string, unknown>).default as object | undefined) ?? mod

  return {
    ...mocked,
    default: {
      ...defaultExport,
      existsSync,
      readFileSync,
      statSync,
      readdirSync,
    },
  }
})

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}

