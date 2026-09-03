import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, vi } from 'vitest'

// ponytail: ponte transitória do squash v1.0 — redireciona leituras de arquivos
// ausentes e soma o arquivo morto às listagens, em vez de reescrever 201 testes
// legados. Teto: testes históricos auditam arquivos mortos, não o schema
// aplicado; a cobertura do artefato ativo fica com `verificar_guardas.py` e
// `consolidatedSchemaInvariants.test.ts` (que escapa deste mock via
// `vi.importActual`). Upgrade: aposentar os *Migration.test.ts pontuais e
// reescrever as invariantes de futuro contra `supabase/migrations/` (ADR 0062
// item 6), e então remover este mock. Teste novo contra o schema ativo DEVE
// usar `vi.importActual('node:fs')`; teste histórico continua caindo aqui.

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

  // Barato antes do caro: fora de supabase/migrations/ não há fallback,
  // sem custar nenhum syscall a mais.
  const normalized = pathStr.replace(/\\/g, '/')
  if (!/(^|\/)supabase\/migrations(\/|$)/.test(normalized)) return null
  if (origExists(filePath as PathLike)) return null
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
    const archiveEntries = (rawEntries as unknown as Array<string | { name: string }>).filter((entry) => {
      const name =
        typeof entry === 'object' && entry !== null && 'name' in entry
          ? String((entry as { name: unknown }).name)
          : String(entry)
      return name.endsWith('.sql')
    }) as unknown as T[]

    // União ativo + arquivo morto (ativos primeiro, sem duplicatas): as
    // invariantes de futuro que varrem o diretório precisam enxergar um
    // eventual 005_nova_migration.sql — só o arquivo morto as deixaria cegas.
    let mainEntries: T[] = []
    try {
      if (origExists(dir as string)) {
        mainEntries = origReaddir(dir, options)
      }
    } catch {
      // Diretório principal pode ainda não ter sido recriado
    }
    const withTypes =
      options && typeof options === 'object' && 'withFileTypes' in options && Boolean((options as Record<string, unknown>).withFileTypes)
    if (withTypes) {
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
    return Array.from(new Set([...mainEntries, ...archiveEntries].map((entry) => String(entry)))).sort() as unknown as T[]
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

