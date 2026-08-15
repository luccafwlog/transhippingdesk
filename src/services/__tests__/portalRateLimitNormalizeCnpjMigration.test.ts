import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/298_portal_rate_limit_normalize_cnpj.sql', 'utf8')
// O cabeçalho da migration cita o regexp antigo para explicar o defeito; as
// asserções de "não sobrou regexp" olham só o corpo executável.
const body = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
const canonicalizationSql = readFileSync('supabase/migrations/293_cnpj_alfanumerico.sql', 'utf8')

const RATE_LIMIT_FUNCTIONS = [
  'portal_login_check_rate_limit',
  'portal_login_register_failure',
  'portal_login_register_success',
  'portal_recovery_check_rate_limit',
  'portal_recovery_register_failure',
]

// A regra de normalização não é copiada para o teste: é extraída do corpo de
// `normalize_cnpj` na migration 293, que é a fonte única. Se alguém mudar a
// classe de caracteres lá, este teste passa a exercitar a regra nova.
function sharedNormalizer(): (value: string) => string {
  const match = canonicalizationSql.match(/RETURN NULLIF\(upper\(regexp_replace\(p_value, '(\[[^']+\])', '', 'g'\)\), ''\);/)
  if (!match) throw new Error('normalize_cnpj mudou de forma; revise este teste junto com a migration 293.')
  return (value: string) => value.replace(new RegExp(match[1], 'g'), '').toUpperCase()
}

describe('Rate limit do Portal volta ao normalizador compartilhado (298)', () => {
  it('faz as cinco funções chamarem public.normalize_cnpj', () => {
    for (const name of RATE_LIMIT_FUNCTIONS) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${name}(p_login TEXT)`)
    }
    expect(sql.match(/public\.normalize_cnpj\(coalesce\(p_login,''\)\)/g)).toHaveLength(RATE_LIMIT_FUNCTIONS.length)
  })

  // O ponto do plano: não escrever um quarto regexp, e sim remover os três que
  // existiam. Um `\D` sobrevivente aqui reintroduziria o defeito.
  it('não deixa nenhum regexp inline de CNPJ para trás', () => {
    expect(body).not.toContain("regexp_replace(coalesce(p_login,''),'\\D'")
    expect(body).not.toMatch(/regexp_replace/)
  })

  it('preserva SECURITY DEFINER, search_path e as revogações existentes', () => {
    for (const name of RATE_LIMIT_FUNCTIONS) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}(TEXT) FROM PUBLIC,anon,authenticated;`)
    }
    expect(sql.match(/SECURITY DEFINER SET search_path TO 'public','pg_temp'/g)).toHaveLength(RATE_LIMIT_FUNCTIONS.length)
  })

  // normalize_cnpj é STRICT e devolve NULL para entrada vazia; sem o COALESCE
  // externo, `cnpj_hash` (NOT NULL) receberia nulo no INSERT de tentativa.
  it('protege a chave contra login ausente', () => {
    expect(sql.match(/coalesce\(public\.normalize_cnpj\(coalesce\(p_login,''\)\),''\)/g)).toHaveLength(RATE_LIMIT_FUNCTIONS.length)
  })

  it('mantém os dois baldes separados por origem', () => {
    expect(sql).toContain("source='login'")
    expect(sql).toContain("source='recovery'")
  })
})

describe('regra de normalização exercitada pela chave do rate limit', () => {
  const normalize = sharedNormalizer()

  // Achado A: `\D` apagava as letras, então estes dois CNPJs alfanuméricos
  // caíam na mesma chave (123450135) e dividiam o balde de tentativas.
  it('distingue dois CNPJs alfanuméricos que só diferem nas letras', () => {
    expect(normalize('12ABC34501DE35')).not.toBe(normalize('12XYZ34501FG35'))
    expect(normalize('12ABC34501DE35')).toBe('12ABC34501DE35')
  })

  it('produz a mesma chave para o CNPJ com e sem máscara', () => {
    expect(normalize('12.345.678/0001-95')).toBe(normalize('12345678000195'))
    expect(normalize('12.abc.345/01de-35')).toBe(normalize('12ABC34501DE35'))
  })
})
