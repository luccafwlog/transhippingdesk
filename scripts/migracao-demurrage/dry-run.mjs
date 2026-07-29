// Ensaio da migração Demurrage Manager → Transhipping Desk.
//
// LÊ a origem e as duas planilhas, aplica as regras de `regras.mjs` e imprime
// um relatório de divergências. NÃO ESCREVE NADA em lugar nenhum — nem na
// origem, nem no destino, nem em disco.
//
// Sai com código 1 quando encontra bloqueio, para poder ser usado como portão.
//
//   DEMURRAGE_LEGADO_URL=... DEMURRAGE_LEGADO_KEY=... \
//   node scripts/migracao-demurrage/dry-run.mjs \
//     --relatorio caminho/Relatorio_Demurrage.xlsx \
//     --reconciliacao caminho/reconciliacao.xlsx
//
// Opcional: SUPABASE_URL e SUPABASE_ANON_KEY apontando para o destino, para
// conferir quais navios já existem lá.

import fs from 'node:fs'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from '@e965/xlsx'

// Em ESM o SheetJS não enxerga o `fs` sozinho; sem isto, `readFile` responde
// "Cannot access file" mesmo com o arquivo presente e legível.
XLSX.set_fs(fs)
import {
  BLS_PENDENTES_DE_DECISAO,
  chaveNavio,
  estadoDaFatura,
  interpretarViagem,
  normalizarPorto,
  normalizarTexto,
  razaoSocialDoCliente,
  resolverBrlRecebido,
  resolverDocnums,
  separarEmails,
  somenteDigitos,
  TARIFAS,
} from './regras.mjs'

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function lerArgumentos(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) continue
    args[argv[i].slice(2)] = argv[i + 1]
  }
  return args
}

function abrirPlanilha(caminho, aba) {
  const wb = XLSX.readFile(caminho)
  const nome = aba ?? wb.SheetNames[0]
  const planilha = wb.Sheets[nome]
  if (!planilha) throw new Error(`aba "${nome}" nao encontrada em ${caminho}`)
  return { wb, planilha }
}

/**
 * O relatório tem 2 linhas de título antes do cabeçalho real, e uma linha de
 * `TOTAL GERAL` no fim que não é um B/L. Sem descartá-la, ela entra na
 * contagem e no mapa de consignatários.
 */
function lerRelatorio(caminho) {
  const { wb, planilha } = abrirPlanilha(caminho, 'Demurrage')
  const linhas = XLSX.utils
    .sheet_to_json(planilha, { range: 2, defval: null })
    .filter((r) => String(r.BL ?? '').trim() !== '')
  const ce = wb.Sheets['CE Mercante']
    ? XLSX.utils.sheet_to_json(wb.Sheets['CE Mercante'], { defval: null })
    : []
  return { linhas, ce }
}

/**
 * Origem a partir do JSON exportado pelo próprio Demurrage Manager.
 *
 * Aceita tanto `[{ id, data: {...} }]` (formato da tabela) quanto
 * `[{ bl, docnum, ... }]` (o B/L já achatado), normalizando para o primeiro.
 */
function lerOrigemDeArquivo(caminho) {
  const bruto = JSON.parse(fs.readFileSync(caminho, 'utf8'))
  const lista = Array.isArray(bruto) ? bruto : (bruto.bls ?? [])
  return lista.map((item) => (item && item.data ? item : { id: item?.id ?? null, data: item }))
}

/** Origem lida direto do Supabase do Demurrage Manager. */
async function lerOrigemDoBanco() {
  const url = process.env.DEMURRAGE_LEGADO_URL
  const chave = process.env.DEMURRAGE_LEGADO_KEY
  if (!url || !chave) {
    throw new Error(
      'sem --origem-json, DEMURRAGE_LEGADO_URL e DEMURRAGE_LEGADO_KEY sao obrigatorias.',
    )
  }
  const origem = createClient(url, chave, { auth: { persistSession: false } })

  // A RLS da origem exige `auth.role() = 'authenticated'`: com chave anônima a
  // leitura volta VAZIA em vez de dar erro — falha silenciosa, a pior espécie.
  if (process.env.DEMURRAGE_LEGADO_EMAIL && process.env.DEMURRAGE_LEGADO_SENHA) {
    const { error } = await origem.auth.signInWithPassword({
      email: process.env.DEMURRAGE_LEGADO_EMAIL,
      password: process.env.DEMURRAGE_LEGADO_SENHA,
    })
    if (error) throw new Error(`login na origem falhou: ${error.message}`)
  }
  const bls = await lerTodos(origem, 'bls')
  if (bls.length === 0) {
    throw new Error(
      'a origem devolveu 0 B/Ls. A RLS exige sessao autenticada — defina ' +
        'DEMURRAGE_LEGADO_EMAIL e DEMURRAGE_LEGADO_SENHA, use uma chave de servico, ' +
        'ou passe --origem-json com o export do proprio sistema.',
    )
  }
  return bls
}

async function lerTodos(cliente, tabela) {
  const pagina = 1000
  const todos = []
  for (let de = 0; ; de += pagina) {
    const { data, error } = await cliente.from(tabela).select('*').range(de, de + pagina - 1)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    todos.push(...data)
    if (data.length < pagina) return todos
  }
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

const bloqueios = []
const avisos = []

function bloqueio(texto) {
  bloqueios.push(texto)
}
function aviso(texto) {
  avisos.push(texto)
}

function secao(titulo) {
  console.log(`\n${'='.repeat(72)}\n${titulo}\n${'='.repeat(72)}`)
}

function linha(rotulo, valor) {
  console.log(`  ${String(rotulo).padEnd(46, '.')} ${valor}`)
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main() {
  const args = lerArgumentos(process.argv)
  if (!args.relatorio || !args.reconciliacao) {
    console.error('Use --relatorio <arquivo.xlsx> --reconciliacao <arquivo.xlsx>.')
    process.exit(2)
  }

  const bls = args['origem-json']
    ? lerOrigemDeArquivo(args['origem-json'])
    : await lerOrigemDoBanco()

  if (bls.length === 0) {
    throw new Error('a origem devolveu 0 B/Ls — um ensaio sobre leitura vazia nao prova nada.')
  }
  const { linhas: relatorio, ce: abaCe } = lerRelatorio(args.relatorio)
  const { planilha: planilhaReconc } = abrirPlanilha(args.reconciliacao)
  const reconciliacao = XLSX.utils.sheet_to_json(planilhaReconc, { defval: null })

  console.log(`\nEnsaio da migracao — leitura de ${new Date().toISOString()}`)
  linha('B/Ls na origem', bls.length)
  linha('linhas no relatorio (uma por container)', relatorio.length)
  linha('linhas na reconciliacao', reconciliacao.length)

  // --- Consignatários e contatos (#437, #440) ------------------------------
  const consignatarioPorCnpj = new Map()
  for (const r of relatorio) {
    const doc = somenteDigitos(r.CNPJ)
    if (doc && !consignatarioPorCnpj.has(doc)) consignatarioPorCnpj.set(doc, r.CNEE ?? '')
  }

  const clientes = new Map()
  const contatos = new Map()
  for (const bl of bls) {
    const d = bl.data ?? {}
    const doc = somenteDigitos(d.cnpj)
    if (!doc) {
      bloqueio(`B/L ${d.bl}: sem CNPJ — cliente e' chave da migracao`)
      continue
    }
    if (!clientes.has(doc)) {
      clientes.set(doc, razaoSocialDoCliente(doc, consignatarioPorCnpj.get(doc) ?? d.cnee ?? d.client))
    }
    if (!contatos.has(doc)) contatos.set(doc, new Set())
    for (const email of separarEmails(d.email)) contatos.get(doc).add(email)
  }

  secao('CLIENTES')
  linha('CNPJs distintos com B/L', clientes.size)
  linha('contas de portal (aguardando_analise / sem_conta)', clientes.size)
  const totalContatos = [...contatos.values()].reduce((t, s) => t + s.size, 0)
  linha('contatos de e-mail (purpose = demurrage)', totalContatos)
  linha('clientes sem nenhum e-mail', [...contatos.values()].filter((s) => s.size === 0).length)
  for (const [doc, nome] of clientes) {
    if (!nome || nome.length < 3) bloqueio(`CNPJ ${doc}: razao social vazia ou curta ("${nome}")`)
    if (/\b(CEP|RUA|AVENIDA|CNPJ|TEL|E-?MAIL)\b|@/.test(nome)) {
      aviso(`CNPJ ${doc}: razao social parece conter endereco — "${nome.slice(0, 60)}"`)
    }
  }

  // --- Viagens (#432) ------------------------------------------------------
  const viagens = new Map()
  for (const bl of bls) {
    const texto = bl.data?.vessel
    const { navio, viagem, reconhecido } = interpretarViagem(texto)
    if (!reconhecido) {
      bloqueio(`viagem nao interpretada: "${texto}" (B/L ${bl.data?.bl})`)
      continue
    }
    const chave = `${chaveNavio(navio)}|${viagem}`
    if (!viagens.has(chave)) viagens.set(chave, { navio, viagem, bls: 0, grafias: new Set() })
    const v = viagens.get(chave)
    v.bls += 1
    v.grafias.add(navio)
  }

  let naviosDestino = null
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const destino = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    })
    const { data, error } = await destino.from('vessels').select('id, name')
    if (error) aviso(`nao foi possivel ler navios do destino: ${error.message}`)
    else naviosDestino = data
  }

  secao('VIAGENS (aprovar antes da carga — #432)')
  linha('viagens distintas', viagens.size)
  const naviosOrigem = new Set([...viagens.values()].map((v) => chaveNavio(v.navio)))
  linha('navios distintos', naviosOrigem.size)
  for (const v of viagens.values()) {
    if (v.grafias.size > 1) {
      aviso(`navio com grafias diferentes na origem: ${[...v.grafias].join(' / ')}`)
    }
  }
  if (naviosDestino) {
    const porChave = new Map()
    for (const n of naviosDestino) {
      const k = chaveNavio(n.name)
      if (!porChave.has(k)) porChave.set(k, [])
      porChave.get(k).push(n)
    }
    const reutiliza = [...naviosOrigem].filter((k) => porChave.has(k))
    linha('navios que ja existem no destino', reutiliza.length)
    linha('navios a criar', naviosOrigem.size - reutiliza.length)
    for (const k of reutiliza) {
      if (porChave.get(k).length > 1) {
        aviso(`destino tem ${porChave.get(k).length} navios equivalentes a "${k}": ` +
          porChave.get(k).map((n) => `#${n.id} ${n.name}`).join(', '))
      }
    }
  } else {
    aviso('destino nao consultado — defina SUPABASE_URL e SUPABASE_ANON_KEY para conferir navios')
  }

  // --- Portos (#441) -------------------------------------------------------
  secao('PORTOS')
  const portos = new Map()
  for (const bl of bls) {
    for (const campo of ['pol', 'pod']) {
      const bruto = bl.data?.[campo]
      const locode = normalizarPorto(bruto)
      if (!locode) {
        bloqueio(`porto nao reconhecido: "${bruto}" (${campo} do B/L ${bl.data?.bl})`)
        continue
      }
      portos.set(`${campo}:${locode}`, (portos.get(`${campo}:${locode}`) ?? 0) + 1)
    }
  }
  for (const [k, n] of [...portos.entries()].sort()) linha(k, `${n} B/Ls`)

  // --- Containers e tarifas (#435, #436, #439) -----------------------------
  secao('CONTAINERS E TARIFAS')
  const tiposComTarifa = new Set(TARIFAS.map((t) => t.container_type))
  let containers = 0
  const tiposVistos = new Map()
  for (const bl of bls) {
    for (const c of bl.data?.containers ?? []) {
      containers += 1
      const tipo = normalizarTexto(c.type)
      tiposVistos.set(tipo, (tiposVistos.get(tipo) ?? 0) + 1)
      if (!tiposComTarifa.has(tipo)) {
        bloqueio(`container ${c.container} (B/L ${bl.data?.bl}): tipo "${tipo}" sem tarifa cadastrada`)
      }
      if (!c.discharge || !c.emptyReturn) {
        bloqueio(`container ${c.container} (B/L ${bl.data?.bl}): sem descarga ou sem devolucao`)
      } else if (new Date(c.emptyReturn) < new Date(c.discharge)) {
        bloqueio(`container ${c.container} (B/L ${bl.data?.bl}): devolucao anterior a descarga`)
      }
    }
  }
  linha('containers em escopo (array do B/L)', containers)
  linha('linhas de tarifa a carregar', TARIFAS.length)
  for (const [t, n] of [...tiposVistos.entries()].sort((a, b) => b[1] - a[1])) linha(`  tipo ${t}`, n)

  // --- CE Mercante (#433) --------------------------------------------------
  secao('CE MERCANTE (#433)')
  const cePorBl = new Map()
  for (const r of abaCe) {
    const bl = normalizarTexto(r.BL)
    const ce = String(r.CE ?? '').replace(/ /g, '').trim()
    if (bl && /^\d{5,}$/.test(ce)) cePorBl.set(bl, ce)
  }
  const semCe = bls.filter((b) => !cePorBl.has(normalizarTexto(b.data?.bl)))
  linha('B/Ls com CE valido', bls.length - semCe.length)
  linha('B/Ls sem CE', semCe.length)
  for (const b of semCe) {
    aviso(`sem CE Mercante: ${b.data?.bl} — sem ele a fatura nao aparece no portal`)
  }

  // --- Faturas (#434, #438, #442) ------------------------------------------
  secao('FATURAS')
  const pagosPorBl = new Map()
  for (const r of reconciliacao) {
    const bl = normalizarTexto(r['B/L'])
    if (!bl) continue
    if (!pagosPorBl.has(bl)) pagosPorBl.set(bl, new Map())
    pagosPorBl.get(bl).set(String(r.CONTAINER ?? '').trim(), Number(r['TOTAL PAID'] ?? 0))
  }

  const estados = new Map()
  const fontes = new Map()
  const paraDedup = []
  for (const bl of bls) {
    const d = bl.data ?? {}
    const numero = normalizarTexto(d.bl)
    const estado = estadoDaFatura(d)
    estados.set(estado, (estados.get(estado) ?? 0) + 1)

    if (BLS_PENDENTES_DE_DECISAO[numero]) {
      bloqueio(`B/L ${numero} aguarda decisao do dono: ${BLS_PENDENTES_DE_DECISAO[numero]}`)
      continue
    }
    if (estado === 'nao_faturada') continue

    paraDedup.push({
      bl: numero,
      docnum: String(d.docnum ?? '').trim(),
      pago: estado.startsWith('paga'),
      billedAt: d.billedAt ? String(d.billedAt).slice(0, 10) : null,
    })

    if (estado.startsWith('paga')) {
      const pagos = [...(pagosPorBl.get(numero)?.values() ?? [])]
      const { valor, fonte } = resolverBrlRecebido(d.frozenTotal, pagos)
      fontes.set(fonte, (fontes.get(fonte) ?? 0) + 1)
      if (valor === null) bloqueio(`B/L ${numero}: fatura paga sem BRL em nenhuma fonte`)
    }
  }
  for (const [e, n] of [...estados.entries()].sort()) linha(e, n)
  console.log('')
  for (const [f, n] of [...fontes.entries()].sort()) linha(`BRL das pagas via ${f}`, n)

  const docnums = resolverDocnums(paraDedup)
  const acoes = new Map()
  for (const { acao } of docnums.values()) acoes.set(acao, (acoes.get(acao) ?? 0) + 1)
  console.log('')
  for (const [a, n] of [...acoes.entries()].sort()) linha(`doc_number ${a}`, n)

  // --- Fecho ---------------------------------------------------------------
  secao('RESULTADO')
  linha('avisos', avisos.length)
  linha('bloqueios', bloqueios.length)
  if (avisos.length) {
    console.log('\nAVISOS')
    for (const a of avisos.slice(0, 40)) console.log(`  · ${a}`)
    if (avisos.length > 40) console.log(`  · … e mais ${avisos.length - 40}`)
  }
  if (bloqueios.length) {
    console.log('\nBLOQUEIOS — a carga nao deve rodar enquanto existirem')
    for (const b of bloqueios.slice(0, 40)) console.log(`  · ${b}`)
    if (bloqueios.length > 40) console.log(`  · … e mais ${bloqueios.length - 40}`)
    console.log('')
    process.exit(1)
  }
  console.log('\nNenhum bloqueio. Nada foi escrito — este script so le.\n')
}

main().catch((erro) => {
  console.error(`\nfalha no ensaio: ${erro.message}`)
  process.exit(2)
})
