import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLS_OF_CUSTOMER, BLS_OF_CUSTOMER_INNER, CUSTOMER_OF_BL } from '../supabaseEmbeds'

// `bls` aponta duas vezes para `customers` (`customer_id` e
// `suggested_customer_id`, migration 285). Onde uma das duas é PAI da outra no
// select, o PostgREST não escolhe sozinho e responde `300 Multiple Choices`
// (`PGRST201`) -- a request inteira falha, não só o embed. O par só é ambíguo
// nessa relação direta: `bl:bls(...)` pendurado em `invoice_bls`, ou `bls(...)`
// pendurado em `voyages`, tem caminho único e não precisa de dica.
//
// A varredura existe porque o erro não aparece em type-check nem em teste de
// unidade: nasce no PostgREST, em runtime, na tela do usuário.

const AMBIGUOUS_CHILD: Record<string, string> = { customers: 'bls', bls: 'customers' }

/**
 * Percorre um select do PostgREST e devolve os pares pai→filho ambíguos que não
 * trazem dica de foreign key. `rootTable` é a tabela do `.from(...)`, que não
 * aparece dentro do select mas é o pai dos embeds de primeiro nível.
 */
function findAmbiguousEmbeds(select: string, rootTable?: string): string[] {
  const found: string[] = []
  // Pilha dos embeds abertos; o topo é o pai do próximo `nome(`.
  const stack: Array<{ table: string; hinted: boolean }> = rootTable ? [{ table: rootTable, hinted: true }] : []
  const token = /([A-Za-z_]\w*)(![\w!]+)?\s*\(|\)/g

  for (let match = token.exec(select); match; match = token.exec(select)) {
    if (match[0] === ')') {
      stack.pop()
      continue
    }
    const [, table, hint] = match
    const parent = stack[stack.length - 1]
    if (parent && AMBIGUOUS_CHILD[parent.table] === table && !hint) found.push(`${parent.table} -> ${table}`)
    stack.push({ table, hinted: Boolean(hint) })
  }
  return found
}

/**
 * Literais de string e template do CÓDIGO, ignorando comentários -- um exemplo
 * ambíguo escrito entre crases numa explicação não é um select, e casá-lo faria
 * a varredura acusar a própria documentação que ensina a forma certa.
 */
export function selectLiterals(source: string): string[] {
  const literals: string[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      index = source.indexOf('\n', index)
      if (index < 0) break
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    if (char === '`' || char === "'" || char === '"') {
      let cursor = index + 1
      while (cursor < source.length && source[cursor] !== char) {
        if (source[cursor] === '\\') cursor += 1
        cursor += 1
      }
      literals.push(source.slice(index, cursor + 1))
      index = cursor + 1
      continue
    }
    index += 1
  }

  return literals.filter((literal) => literal.includes('(') && /\b(bls|customers)\b/.test(literal))
}

/**
 * Selects escritos como `.from('customers').select('... bls(...)')`, em que a
 * tabela raiz mora fora do literal.
 *
 * ponytail: casa o `.from` com o PRIMEIRO `.select(` dos 600 caracteres
 * seguintes. O teto: um select guardado em constante e usado longe do `.from`,
 * ou um segundo `.select` encadeado, passa em branco -- e a tabela interpolada
 * (`${BLS_OF_CUSTOMER}(...)`) é invisível ao reconhecedor, o que aqui só ajuda,
 * porque a constante já é a forma segura. Upgrade: percorrer a AST em vez de
 * varrer texto, se a forma encadeada deixar de dar conta.
 */
function rootedSelects(source: string): Array<{ root: string; select: string }> {
  const found: Array<{ root: string; select: string }> = []
  const from = /\.from\(\s*['"](customers|bls)['"]\s*\)/g

  for (let match = from.exec(source); match; match = from.exec(source)) {
    const trecho = source.slice(match.index, match.index + 600)
    const select = /\.select\(\s*(`[^`]*`|'[^'\n]*'|"[^"\n]*")/.exec(trecho)
    if (select) found.push({ root: match[1], select: select[1] })
  }
  return found
}

const sources = globSync('src/**/*.{ts,tsx}').filter((file) => !file.includes('__tests__'))

describe('embeds ambíguos entre `customers` e `bls`', () => {
  it('varre o código-fonte e não encontra embed sem dica de foreign key', () => {
    expect(sources.length).toBeGreaterThan(100)

    const offenders: string[] = []
    for (const file of sources) {
      const source = readFileSync(file, 'utf8')
      for (const literal of selectLiterals(source)) {
        for (const pair of findAmbiguousEmbeds(literal)) offenders.push(`${file}: ${pair}`)
      }
      for (const { root, select } of rootedSelects(source)) {
        for (const pair of findAmbiguousEmbeds(select, root)) offenders.push(`${file}: from(${root}) ${pair}`)
      }
    }

    expect(offenders).toEqual([])
  })

  // Sem isto a varredura passaria por vacuidade se o reconhecedor quebrasse.
  it('reconhece o embed ambíguo, aninhado ou a partir da tabela raiz', () => {
    expect(findAmbiguousEmbeds('customers(id, bls(id, pod))')).toEqual(['customers -> bls'])
    expect(findAmbiguousEmbeds('bls(id, customers(id, name))')).toEqual(['bls -> customers'])
    expect(findAmbiguousEmbeds('id, bls(id, pod)', 'customers')).toEqual(['customers -> bls'])
    expect(findAmbiguousEmbeds('id, customer:customers(id, name)', 'bls')).toEqual(['bls -> customers'])
  })

  it('aceita o embed que traz a dica e o par que tem caminho único', () => {
    expect(findAmbiguousEmbeds(`customers(id, ${BLS_OF_CUSTOMER}(id))`)).toEqual([])
    expect(findAmbiguousEmbeds(`id, ${BLS_OF_CUSTOMER_INNER}(id)`, 'customers')).toEqual([])
    expect(findAmbiguousEmbeds(`id, ${CUSTOMER_OF_BL}(id)`, 'bls')).toEqual([])
    // O par não é pai e filho um do outro: caminho único, dica desnecessária.
    expect(findAmbiguousEmbeds('invoice_bls(id, bl:bls(pod))')).toEqual([])
    expect(findAmbiguousEmbeds('id, bls(id, bl_containers(id))', 'voyages')).toEqual([])
  })

  // A documentação da forma certa precisa poder citar a forma errada.
  it('ignora exemplos escritos em comentários', () => {
    expect(selectLiterals('// veja `customers(id, bls(id))`\n')).toEqual([])
    expect(selectLiterals('/* exemplo: `customers(id, bls(id))` */')).toEqual([])
    expect(selectLiterals(`const select = 'id, customers(id, bls(id))'`)).toEqual([`'id, customers(id, bls(id))'`])
  })

  it('extrai a tabela raiz do `.from` encadeado', () => {
    expect(rootedSelects(`supabase.from('customers').select('id, name')`)).toEqual([{ root: 'customers', select: `'id, name'` }])
    expect(rootedSelects(`supabase.from('voyages').select('id')`)).toEqual([])
  })
})
