// Regras puras da migração Demurrage Manager → Transhipping Desk.
//
// Este arquivo NÃO acessa rede nem disco: só transforma dados. Toda decisão
// tomada nos tickets #430–#444 vira uma função ou uma constante aqui, para que
// o dry-run (`dry-run.mjs`) seja apenas a casca de entrada e saída.
//
// Verificação executável: `node scripts/migracao-demurrage/regras.check.mjs`.

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Maiúsculas, sem acento, sem espaço nas pontas. Usado como chave de comparação. */
export function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '')
}

// ---------------------------------------------------------------------------
// Razão social do consignatário (#437)
// ---------------------------------------------------------------------------

// Mesma expressão de `src/lib/consigneeName.ts`. Mantida em cópia porque este
// script roda em Node puro, sem passar pelo bundler do app.
const NATUREZA_JURIDICA = /(?:\b(?:LTDA|S\.A|S\/A|SA(?=\s*$)|EIRELI|EI|MEI|SLU|EPP|ME)\b\.?)/g

// Os 5 blocos em que a razão social está colada ao endereço sem espaço nem
// quebra de linha — `LTDACNPJ` não tem fronteira de palavra, então a regex não
// casa e o extrator devolveria a linha inteira. Nomes confirmados pelo dono.
export const RAZAO_SOCIAL_OVERRIDES = {
  '13661609000153': 'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
  '55265602000162': 'FINDREAMS BATTERY DO BRASIL LTDA',
  '12116971001071': 'TIMBRO TRADING S.A',
  '07952940000120': 'STARHOUSE LOG. & TRANSP. MULT. LTDA',
  '14706880000120': 'TFA CARGO LOGISTICS LTDA',
}

/**
 * Razão social a partir do bloco do consignatário, conforme CONTEXT.md:
 * primeira linha não vazia, cortada na natureza jurídica.
 *
 * `_x000D_` é carriage return codificado pelo Excel na exportação XLSX; sem
 * tratar, ao menos um cliente entraria com o artefato grudado no nome.
 */
export function extrairRazaoSocial(bloco) {
  const texto = String(bloco ?? '').split('_x000D_').join('\n')
  const primeiraLinha = texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .find((linha) => linha.length > 0) ?? ''

  let fim = -1
  NATUREZA_JURIDICA.lastIndex = 0
  for (let m = NATUREZA_JURIDICA.exec(primeiraLinha); m; m = NATUREZA_JURIDICA.exec(primeiraLinha)) {
    if (m.index === 0) continue
    if (fim === -1 || primeiraLinha.slice(fim, m.index).trim() === '') {
      fim = m.index + m[0].length
      continue
    }
    break
  }
  return fim === -1 ? primeiraLinha : primeiraLinha.slice(0, fim).trim()
}

/** Razão social final: override quando existe, extração caso contrário. */
export function razaoSocialDoCliente(cnpj, blocoConsignatario) {
  const documento = somenteDigitos(cnpj)
  return RAZAO_SOCIAL_OVERRIDES[documento] ?? extrairRazaoSocial(blocoConsignatario)
}

// ---------------------------------------------------------------------------
// Contatos (#440)
// ---------------------------------------------------------------------------

/**
 * O campo `email` da origem acumula vários destinatários num texto só,
 * separados por `;` ou `,` (439 dos 974 B/Ls). Vira uma linha por endereço.
 */
export function separarEmails(campo) {
  return String(campo ?? '')
    .split(/[;,]/)
    .map((parte) => parte.trim().toLowerCase())
    .filter((parte) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parte))
}

// Classificação autorizada pelo dono como exceção pontual à restrição de não
// mudar a estrutura: exige adicionar 'demurrage' ao CHECK de
// `customer_contacts.purpose`. Ver #440.
export const PURPOSE_CONTATO = 'demurrage'

// ---------------------------------------------------------------------------
// Viagens (#432)
// ---------------------------------------------------------------------------

// A origem não tem chave `voyage`: o número está grudado no `vessel`. O `V` é
// abreviação de *viagem*, não parte do número (decisão do dono). Aparece como
// `V27` e como `V.20`.
const PADRAO_VIAGEM = /^(.*?)\s+V\.?\s*(\d+)$/

// Apelidos conhecidos do domínio (CONTEXT.md). Duas grafias do mesmo armador
// convivem na base do destino, então a comparação precisa enxergar as duas.
const APELIDOS_NAVIO = [
  [/^CS\b/, 'COSCO SHIPPING'],
  [/^C\.S\.\s*/, 'COSCO SHIPPING'],
  [/^ZYHY\b/, 'ZHONG YUAN HAI YUN'],
]

/** `"GREEN RIO GRANDE V13"` → `{ navio: 'GREEN RIO GRANDE', viagem: '13' }`. */
export function interpretarViagem(textoVessel) {
  const bruto = String(textoVessel ?? '').trim()
  const m = bruto.match(PADRAO_VIAGEM)
  if (!m) return { navio: bruto, viagem: null, reconhecido: false }
  return { navio: m[1].trim(), viagem: String(Number(m[2])), reconhecido: true }
}

/**
 * Chave de comparação de navio: sem acento e com o apelido expandido.
 * `GREEN ITAJAÍ` e `GREEN ITAJAI` são o mesmo navio; `CS XING WANG` é o mesmo
 * que `COSCO SHIPPING XING WANG`.
 */
export function chaveNavio(nome) {
  const base = normalizarTexto(nome)
  for (const [padrao, expansao] of APELIDOS_NAVIO) {
    if (padrao.test(base)) return base.replace(padrao, expansao).replace(/\s+/g, ' ').trim()
  }
  return base
}

// ---------------------------------------------------------------------------
// Portos (#441)
// ---------------------------------------------------------------------------

// Os 7 portos da origem. Mesmos pares de `src/services/portCode.ts`, repetidos
// aqui pelo mesmo motivo da regex de natureza jurídica: Node puro.
const PORTO_PARA_LOCODE = {
  SALVADOR: 'BRSSA',
  VITORIA: 'BRVIX',
  PECEM: 'BRPEC',
  QINGDAO: 'CNTAO',
  SHANGHAI: 'CNSHA',
  TAICANG: 'CNTAC',
  NINGBO: 'CNNGB',
  NANSHA: 'CNNSA',
  ZHANGJIAGANG: 'CNZJG',
}

/** Nome do porto → UN/LOCODE. Devolve `null` quando não reconhece. */
export function normalizarPorto(valor) {
  const chave = normalizarTexto(valor)
  if (!chave) return null
  if (PORTO_PARA_LOCODE[chave]) return PORTO_PARA_LOCODE[chave]
  if (/^[A-Z]{5}$/.test(chave)) return chave
  return null
}

// ---------------------------------------------------------------------------
// Tarifas (#436)
// ---------------------------------------------------------------------------

// As colunas de dia do destino contam DIAS DESDE A DESCARGA, não dias
// excedentes: free 21 + cobrança nos 9 primeiros dias excedentes vira
// [22,30] e P2 a partir de 31. Errar essa unidade erra a tabela inteira.
const FAIXA_PADRAO = { free_days: 21, p1_day_from: 22, p1_day_to: 30, p2_day_from: 31 }

function faixa(container_type, p1_usd, p2_usd) {
  return { container_type, ...FAIXA_PADRAO, p1_usd, p2_usd, active: true }
}

// 20 linhas deriváveis das tabelas oficiais do dono. Reefers (20RF/RQ e
// 40RF/RQ) e 7 códigos ambíguos ficam DE FORA de propósito: falta de tarifa
// falha com erro explícito ao operador; tarifa inventada gera PIX errado em
// silêncio. Ver #436.
export const TARIFAS = [
  ...['22G1', '22G0', '20G1', '25G0', '25G1'].map((t) => faixa(t, 30, 50)),
  ...['42G1', '42G0', '45G1'].map((t) => faixa(t, 60, 80)),
  faixa('22U1', 50, 80),
  ...['42U1', '40FR_42P3', '42P0', '42P1', '42P2', '42P3', '40FH_45P3', '45P0', '45P1', '45P2', '45P3'].map(
    (t) => faixa(t, 100, 140),
  ),
]

// ---------------------------------------------------------------------------
// Faturas (#438, #434)
// ---------------------------------------------------------------------------

/**
 * Desempate dos `doc_number` colididos na origem (#438).
 *
 * Dentro de cada grupo, um B/L mantém o número original: pago tem prioridade,
 * depois menor `billedAt`, depois número de B/L crescente. Os demais recebem
 * sufixo `-2`, `-3`… se pagos, ou `REGERAR` se em aberto.
 *
 * @param {{ bl: string, docnum: string, pago: boolean, billedAt: string|null }[]} faturas
 */
export function resolverDocnums(faturas) {
  const grupos = new Map()
  for (const f of faturas) {
    const chave = String(f.docnum ?? '').trim()
    if (!grupos.has(chave)) grupos.set(chave, [])
    grupos.get(chave).push(f)
  }

  const resultado = new Map()
  for (const [docnum, itens] of grupos) {
    if (itens.length === 1) {
      resultado.set(itens[0].bl, { doc_number: docnum, acao: 'mantido' })
      continue
    }
    const ordenados = [...itens].sort((a, b) => {
      if (a.pago !== b.pago) return a.pago ? -1 : 1
      const da = a.billedAt ?? '9999-12-31'
      const db = b.billedAt ?? '9999-12-31'
      if (da !== db) return da < db ? -1 : 1
      return a.bl < b.bl ? -1 : 1
    })
    resultado.set(ordenados[0].bl, { doc_number: docnum, acao: 'mantido' })
    ordenados.slice(1).forEach((item, i) => {
      resultado.set(
        item.bl,
        item.pago
          ? { doc_number: `${docnum}-${i + 2}`, acao: 'sufixado' }
          : { doc_number: null, acao: 'regerar' },
      )
    })
  }
  return resultado
}

// Os 5 B/Ls que o dono decidiu examinar perto do cutover (#434). O script
// PARA ao encontrar um deles sem decisão registrada, em vez de aplicar regra
// silenciosa sobre dinheiro.
export const BLS_PENDENTES_DE_DECISAO = {
  CSC45320805K00: 'datas alteradas apos o pagamento: 9 dias excedentes pagos, 12 no dado atual',
  CSC45340607V00: 'reconciliacao perdeu um container e registrou dias incoerentes',
  CSC45260B00L00: 'VEGALOG: paga na origem, ausente da conciliacao financeira',
  CSC45270B02F00: 'VEGALOG: paga na origem, ausente da conciliacao financeira',
  CSC45250D01S00: 'VEGALOG: paga na origem, ausente da conciliacao financeira',
}

/**
 * BRL efetivamente recebido de uma fatura paga (#434).
 *
 * Ordem: `frozenTotal` da origem quando existe; soma de `TOTAL PAID` da
 * planilha de reconciliação quando não. NUNCA a coluna `VALOR PAGO (BRL)` do
 * relatório, que é recalculada com a PTAX do dia da emissão.
 *
 * @param {number|null|undefined} frozenTotal
 * @param {number[]} pagamentosReconciliacao valores por container
 */
export function resolverBrlRecebido(frozenTotal, pagamentosReconciliacao) {
  if (frozenTotal !== null && frozenTotal !== undefined && Number.isFinite(Number(frozenTotal))) {
    return { valor: Number(frozenTotal), fonte: 'frozenTotal' }
  }
  if (Array.isArray(pagamentosReconciliacao) && pagamentosReconciliacao.length > 0) {
    const soma = pagamentosReconciliacao.reduce((total, v) => total + Number(v || 0), 0)
    return { valor: soma, fonte: 'reconciliacao' }
  }
  return { valor: null, fonte: 'ausente' }
}

// ---------------------------------------------------------------------------
// Estado das faturas na origem
// ---------------------------------------------------------------------------

/**
 * Traduz o par `billed`/`paid` do JSONB para o estado da migração.
 *
 * `billed:true` + `paid:false` é fatura em aberto normal, não anomalia. As 6
 * sem a chave `billed` e as 3 com `billed:false` + `paid:true` são as anomalias
 * classificadas em #442.
 */
export function estadoDaFatura({ billed, paid }) {
  const pago = paid === true || paid === 'true'
  const faturado = billed === true || billed === 'true'
  if (pago) return faturado ? 'paga' : 'paga_sem_marca_de_faturamento'
  return faturado ? 'em_aberto' : 'nao_faturada'
}
