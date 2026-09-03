import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// Por que este arquivo existe.
//
// Depois do squash (ADR 0062) `src/test/setup.ts` redireciona toda leitura de
// `supabase/migrations/` para `supabase/migrations_archive/`, para que os 201
// testes de contrato das migrations históricas continuem passando sem serem
// reescritos. O efeito colateral é que NENHUM desses testes enxerga mais o
// schema que de fato é aplicado: eles auditam arquivos mortos.
//
// Este arquivo é a contrapartida. Ele usa `vi.importActual` para escapar do
// mock e ler o diretório real, e trava no schema ATIVO as invariantes que a
// suíte histórica costumava garantir sobre a cadeia inteira.
async function realFs() {
  return vi.importActual<typeof import('node:fs')>('node:fs')
}

const MIGRATIONS = path.resolve(process.cwd(), 'supabase/migrations')

async function lerMigrationsAtivas(): Promise<Map<string, string>> {
  const fs = await realFs()
  const nomes = fs
    .readdirSync(MIGRATIONS)
    .filter((nome) => nome.endsWith('.sql'))
    .sort()
  return new Map(nomes.map((nome) => [nome, fs.readFileSync(path.join(MIGRATIONS, nome), 'utf8')]))
}

describe('schema consolidado v1.0 (arquivos realmente aplicados)', () => {
  it('o harness de arquivo morto não escondeu o diretório ativo', async () => {
    const ativas = await lerMigrationsAtivas()
    const nomes = [...ativas.keys()]

    // Se este teste começar a ver 383 arquivos, o `vi.importActual` parou de
    // escapar do mock e todas as asserções abaixo viraram teatro.
    expect(nomes.length).toBeLessThan(50)
    expect(nomes).toContain('001_initial_schema.sql')
    expect(nomes).toContain('002_business_logic_and_security.sql')
    for (const nome of nomes) {
      expect(nome).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/)
    }
    // ADR 0016 no diretório ativo: ordem lexicográfica = ordem de aplicação
    // exige prefixos únicos — um futuro 004 duplicado falha aqui, não no push.
    const prefixos = nomes.map((nome) => nome.split('_')[0])
    expect(new Set(prefixos).size).toBe(prefixos.length)
  })

  it('fecha os defaults de EXECUTE de public antes de criar qualquer objeto (ADR 0047)', async () => {
    const ativas = await lerMigrationsAtivas()
    const estrutura = ativas.get('001_initial_schema.sql')
    expect(estrutura).toBeDefined()

    // O Supabase concede EXECUTE a anon/authenticated em toda função nova de
    // `public` por ALTER DEFAULT PRIVILEGES próprio. Esse default vive em
    // pg_default_acl, fora do schema, e não sai em pg_dump: sem inverter isso
    // aqui, um banco novo nasce mais aberto do que produção.
    const fechamento = estrutura!.match(
      /ALTER\s+DEFAULT\s+PRIVILEGES[^;]*?REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+[^;]*PUBLIC[^;]*\banon\b[^;]*;/is,
    )
    expect(fechamento).not.toBeNull()

    const primeiroCreate = estrutura!.search(/^CREATE\s+(TABLE|SEQUENCE)\s/im)
    expect(primeiroCreate).toBeGreaterThan(-1)
    // Default privilege só vale na criação: depois do primeiro CREATE não adianta.
    expect(fechamento!.index).toBeLessThan(primeiroCreate)
  })

  it('anon só recebe EXECUTE na vitrine pública de programação de navios', async () => {
    const ativas = await lerMigrationsAtivas()
    const concessoesAnon: string[] = []
    const concessoesPublic: string[] = []
    for (const sql of ativas.values()) {
      for (const match of sql.matchAll(
        /GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+([^;]+?)\s+TO\s+([^;]+);/gi,
      )) {
        if (/\banon\b/i.test(match[2])) concessoesAnon.push(match[1].trim())
        // `anon` herda de PUBLIC: um GRANT TO PUBLIC abre anon sem citar o nome.
        if (/(?:^|,)\s*PUBLIC\s*(?:,|;|$)/i.test(match[2])) concessoesPublic.push(match[1].trim())
      }
    }
    // ADR 0013 / achado A-02: portal_ship_schedule é a única exceção viva.
    expect(concessoesAnon).toEqual(['public.portal_ship_schedule()'])
    expect(concessoesPublic).toEqual([])
  })

  it('nenhuma tabela ou sequência é concedida a anon ou a PUBLIC', async () => {
    const ativas = await lerMigrationsAtivas()
    const vazamentos: string[] = []
    for (const sql of ativas.values()) {
      for (const match of sql.matchAll(
        /GRANT\s+[A-Z, ]+\s+ON\s+(?:TABLE|SEQUENCE)\s+[^;]+?\s+TO\s+([^;]+);/gi,
      )) {
        if (/\b(?:anon|PUBLIC)\b/i.test(match[1])) vazamentos.push(match[0])
      }
    }
    expect(vazamentos).toEqual([])
  })

  it('toda tabela criada tem RLS habilitada', async () => {
    const ativas = await lerMigrationsAtivas()
    const tudo = [...ativas.values()].join('\n')
    const tabelas = new Set(
      [...tudo.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z0-9_]+)/gi)].map((m) => m[1]),
    )
    const comRls = new Set(
      [...tudo.matchAll(/ALTER TABLE (?:ONLY )?public\.([a-z0-9_]+) ENABLE ROW LEVEL SECURITY/gi)].map(
        (m) => m[1],
      ),
    )
    expect(tabelas.size).toBeGreaterThan(100)
    expect([...tabelas].filter((t) => !comRls.has(t))).toEqual([])
  })

  it('toda função SECURITY DEFINER fixa o search_path', async () => {
    const ativas = await lerMigrationsAtivas()
    const semSearchPath: string[] = []
    for (const sql of ativas.values()) {
      for (const match of sql.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION (public\.[a-z0-9_]+)\([\s\S]*?RETURNS[\s\S]*?AS \$/gi,
      )) {
        const cabecalho = match[0]
        if (/SECURITY\s+DEFINER/i.test(cabecalho) && !/SET\s+search_path/i.test(cabecalho)) {
          semSearchPath.push(match[1])
        }
      }
    }
    expect(semSearchPath).toEqual([])
  })

  it('RPC delete_baplie_manifest_for_voyage possui grant explícito para authenticated e service_role', async () => {
    const ativas = await lerMigrationsAtivas()
    const tudo = [...ativas.values()].join('\n')
    const match = tudo.match(
      /GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+public\.delete_baplie_manifest_for_voyage\b[^;]*?\bTO\s+([^;]+);/i,
    )
    expect(match).not.toBeNull()
    expect(match![1]).toMatch(/\bauthenticated\b/)
    expect(match![1]).toMatch(/\bservice_role\b/)
  })
})
