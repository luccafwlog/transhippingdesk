import fs from 'node:fs'

const SELF_CHECK = process.argv.includes('--self-check')

const dumpPath = 'dump_public_with_privs.sql'
const content = SELF_CHECK ? '' : fs.readFileSync(dumpPath, 'utf8')

// Clean \restrict, \unrestrict or psql meta commands
const cleanedContent = content
  .replace(/^\\(un)?restrict .*$/gm, '')
  .replace(/^\\.*$/gm, '')

const blocks = cleanedContent.split(/\n(?=--\n-- Name: )/)

const header001 = `-- Transhipping Desk — Schema Inicial v1.0 (Estrutura)
-- Consolidado em 2026-09-02 a partir das 383 migrações históricas pré-v1.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ---------------------------------------------------------------------------
-- ADR 0047 — os defaults de privilégio do schema \`public\` nascem fechados.
--
-- O Supabase mantém, por padrão, ALTER DEFAULT PRIVILEGES que concedem acesso a
-- \`anon\` e \`authenticated\` em TODA tabela, sequência e função nova de \`public\`.
-- A migration arquivada 297 inverteu esse default em produção. Esses defaults
-- vivem em \`pg_default_acl\`, fora do schema — o dump que originou este arquivo
-- não os carrega, e sem esta seção um banco novo (branch de preview, \`supabase
-- db reset\`) nasceria MAIS ABERTO que produção: \`anon\` receberia ALL nas 106
-- tabelas e EXECUTE nas 397 funções.
--
-- Precisa vir antes de qualquer CREATE: default privilege só vale na criação.
-- Os GRANT explícitos da 002 restauram exatamente o ACL auditado em produção.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
-- pg_trgm fica em public, como na migration arquivada 047: o dump qualifica
-- os opclasses como public.gin_trgm_ops e o apply quebra se ela for para extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`

const header002 = `-- Transhipping Desk — Schema Inicial v1.0 (Lógica de Negócio, Triggers e Segurança)
-- Consolidado em 2026-09-02 a partir das 383 migrações históricas pré-v1.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
`

const schemaTypes = new Set([
  'SEQUENCE',
  'TABLE',
  'SEQUENCE OWNED BY',
  'DEFAULT',
  'CONSTRAINT',
  'CHECK CONSTRAINT',
  'INDEX',
  'FK CONSTRAINT',
])

const logicSecurityTypes = new Set([
  'FUNCTION',
  'TRIGGER',
  'ROW SECURITY',
  'POLICY',
  'ACL',
])

const blocks001 = []
const blocks002 = []

// Tipos de bloco que o recorte descarta de propósito. Estão listados um a um,
// e não por omissão, porque foi exatamente uma omissão que apagou o
// `ALTER DEFAULT PRIVILEGES` da ADR 0047 na primeira geração: `DEFAULT ACL` não
// estava em nenhum dos dois conjuntos e sumiu sem aviso.
const descartadosDePropósito = new Set([
  'SCHEMA',
  'EXTENSION',
  'SEQUENCE SET',
  'TABLE DATA',
])

const tiposDesconhecidos = new Set()
const discardedExtensions = []

for (const b of blocks) {
  const m = b.match(/-- Name: (.*?); Type: (.*?); Schema: (.*?);/)
  if (!m) continue
  const [, name, type, schema] = m

  if (descartadosDePropósito.has(type)) {
    // A colocação real das extensões em produção é descartada aqui e vem do
    // cabeçalho manual header001: listar sem abortar, para a regeneração
    // continuar auditável (pg_trgm precisa ficar em public — bloqueante da PR 651).
    if (type === 'EXTENSION') discardedExtensions.push(`${schema}.${name}`)
    continue
  }

  if (type === 'COMMENT') {
    if (name.includes('SCHEMA public')) {
      continue
    }
    if (name.startsWith('FUNCTION ') || name.startsWith('TRIGGER ') || name.startsWith('POLICY ')) {
      blocks002.push(b)
    } else {
      blocks001.push(b)
    }
    continue
  }

  if (schemaTypes.has(type)) {
    if (type === 'TABLE' && name === 'audit_logs') {
      const sanitized = b.replace('DEFAULT public.current_actor_role()', '')
      blocks001.push(sanitized)
    } else {
      blocks001.push(b)
    }
  } else if (logicSecurityTypes.has(type)) {
    blocks002.push(b)
  } else {
    tiposDesconhecidos.add(`${type} (ex.: ${schema}.${name})`)
  }
}

if (tiposDesconhecidos.size > 0) {
  console.error('Tipos de bloco não classificados no dump:')
  for (const t of [...tiposDesconhecidos].sort()) console.error(`  - ${t}`)
  console.error(
    '\nCada um seria descartado em silêncio. Classifique-o em schemaTypes,' +
      '\nem logicSecurityTypes ou em descartadosDePropósito antes de gerar.',
  )
  process.exit(1)
}

if (discardedExtensions.length > 0) {
  console.error('EXTENSION descartadas do dump (a colocação aplicada vem do header001 manual):')
  for (const e of discardedExtensions.sort()) console.error(`  - ${e}`)
}

// O split 001/002 é sintático: um DEFAULT, CHECK ou índice do 001 que chame
// função criada só no 002 morre no apply. Hoje só o default de actor_role de
// audit_logs é diferido de propósito (sanitizado acima e reposto no fim do
// 002); qualquer outro caso aborta em vez de gerar schema quebrado.
assertNoForwardFunctionRefs(blocks001, blocks002)

// Canonical ports seed (required by depots and foreign keys)
const portsSeed = `
--
-- Seed canônico de Portos Brasileiros (ADR 0016 / Migration 307)
--
WITH seed(name, locode) AS (
  VALUES
    ('Vitória', 'BRVIX'),
    ('Salvador', 'BRSSA'),
    ('Pecém', 'BRPEC'),
    ('Suape', 'BRSUA'),
    ('Santos', 'BRSSZ'),
    ('Itaguaí', 'BRIGI'),
    ('Navegantes', 'BRNVT'),
    ('Paranaguá', 'BRPNG'),
    ('Rio Grande', 'BRRIG'),
    ('Rio de Janeiro', 'BRRIO'),
    ('Itajaí', 'BRITJ'),
    ('Maceió', 'BRMCZ'),
    ('Fortaleza', 'BRFOR'),
    ('Belém', 'BRBEL'),
    ('Recife', 'BRREC'),
    ('Natal', 'BRNAT'),
    ('São Luís', 'BRSLZ'),
    ('Manaus', 'BRMAO'),
    ('São Francisco do Sul', 'BRSFS'),
    ('Ilhéus', 'BRIOS')
)
INSERT INTO public.ports (name, locode, country)
SELECT seed.name, seed.locode, 'Brasil'
FROM seed
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ports AS existing
  WHERE upper(btrim(existing.locode)) = seed.locode
);
`

// Canonical foundation catalogs in 002
const foundationCatalogs002 = `
--
-- Configurações globais do sistema (app_settings singleton)
--
INSERT INTO public.app_settings (id, communications_enabled, demurrage_dunning_interval_days)
VALUES (1, false, 7)
ON CONFLICT (id) DO NOTHING;

--
-- Catálogo de tipos e naturezas de comunicação com clientes
--
INSERT INTO public.customer_communication_kinds (kind, nature)
VALUES
  ('aviso_chegada_noa', 'avisos_operacionais'),
  ('aviso_prontidao_nor', 'avisos_operacionais'),
  ('aviso_atracacao_nob', 'avisos_operacionais'),
  ('ce_mercante_taxas', 'documentacao'),
  ('cobranca_demurrage', 'demurrage'),
  ('institucional', 'avisos_gerais'),
  ('livre', 'avisos_gerais'),
  ('livre', 'avisos_operacionais'),
  ('livre', 'documentacao'),
  ('livre', 'demurrage')
ON CONFLICT (kind, nature) DO NOTHING;

--
-- Modelos padrão de e-mail de comunicados
--
INSERT INTO public.customer_communication_templates (
  kind, subject_template, body_html_template, body_text_template
)
VALUES
  (
    'aviso_chegada_noa',
    'Notice of Arrival / Aviso de Chegada — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}',
    '<p>Olá, {{customer_name}}.</p><p>O navio <strong>{{vessel_name}}</strong>, viagem <strong>{{voyage_number}}</strong>, tem chegada prevista para <strong>{{milestone_at}}</strong> no Porto de {{port}}.</p><p>B/Ls relacionados: {{bl_list}}.</p>',
    'Olá, {{customer_name}}. O navio {{vessel_name}}, viagem {{voyage_number}}, tem chegada prevista para {{milestone_at}} no Porto de {{port}}. B/Ls relacionados: {{bl_list}}.'
  ),
  (
    'aviso_prontidao_nor',
    'Notice of Readiness / Prontidão de Descarga — {{vessel_name}} / {{voyage_number}} — Porto de {{port}}',
    '<p>Olá, {{customer_name}}.</p><p>Registramos a prontidão de descarga do navio <strong>{{vessel_name}}</strong>, viagem <strong>{{voyage_number}}</strong>, em <strong>{{milestone_at}}</strong> no Porto de {{port}}.</p><p>B/Ls relacionados: {{bl_list}}.</p>',
    'Olá, {{customer_name}}. Registramos a prontidão de descarga do navio {{vessel_name}}, viagem {{voyage_number}}, em {{milestone_at}} no Porto de {{port}}. B/Ls relacionados: {{bl_list}}.'
  ),
  (
    'aviso_atracacao_nob',
    'Notice of Berthing / Aviso de Atracação — {{vessel_name}} / {{voyage_number}} — Porto de {{port}} ({{terminal_name}})',
    '<p>Olá, {{customer_name}}.</p><p>O navio <strong>{{vessel_name}}</strong>, viagem <strong>{{voyage_number}}</strong>, atracou em <strong>{{milestone_at}}</strong> no terminal {{terminal_name}}, Porto de {{port}}.</p><p>B/Ls relacionados: {{bl_list}}.</p>',
    'Olá, {{customer_name}}. O navio {{vessel_name}}, viagem {{voyage_number}}, atracou em {{milestone_at}} no terminal {{terminal_name}}, Porto de {{port}}. B/Ls relacionados: {{bl_list}}.'
  ),
  (
    'institucional',
    '{{subject}}',
    '<p>Olá, {{customer_name}}.</p><p>{{body}}</p>',
    'Olá, {{customer_name}}. {{body}}'
  ),
  (
    'livre',
    '{{subject}}',
    '<p>Olá, {{customer_name}}.</p><p>{{body}}</p>',
    'Olá, {{customer_name}}. {{body}}'
  ),
  (
    'ce_mercante_taxas',
    'CE Mercante Disponível e Resumo de Taxas Locais — {{vessel_name}} / {{voyage_number}}',
    '<p>CE Mercante disponível para desembaraço e registro da DI/DUIMP. O resumo de B/Ls e valores em BRL é gerado pelo comunicado.</p>',
    'CE Mercante disponível para desembaraço e registro da DI/DUIMP. O resumo de B/Ls e valores em BRL é gerado pelo comunicado.'
  ),
  (
    'cobranca_demurrage',
    'Cobrança de Demurrage — {{demurrage_number}} — {{vessel_name}} / {{voyage_number}}',
    '<p>A cobrança de Demurrage está disponível no Portal do Cliente. O valor em reais é informativo e será recalculado no dia do pagamento.</p>',
    'A cobrança de Demurrage está disponível no Portal do Cliente. O valor em reais é informativo e será recalculado no dia do pagamento.'
  )
ON CONFLICT (kind) DO UPDATE SET
  subject_template = EXCLUDED.subject_template,
  body_html_template = EXCLUDED.body_html_template,
  body_text_template = EXCLUDED.body_text_template;

--
-- Catálogo de tipos de alertas e responsabilidades departamentais
--
INSERT INTO public.alert_type_catalog (
  type, severity, responsible_department, audience_departments, default_destination, active
)
VALUES
  ('review_customer_unlinked', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao', true),
  ('review_customer_email_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao', true),
  ('review_portal_not_ready', 'critical', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('review_breakbulk_weight_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao', true),
  ('review_granite_customer_unlinked', 'critical', 'documentacao', ARRAY['documentacao'], '/revisao', true),
  ('billing_calculation_blocked', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais', true),
  ('billing_auto_issue_failed', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais', true),
  ('invoice_overdue', 'normal', 'documentacao', ARRAY['documentacao'], '/taxas-locais', false),
  ('invoice_payment_invalid', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais', false),
  ('invoice_cancel_blocked', 'critical', 'documentacao', ARRAY['documentacao'], '/taxas-locais', false),
  ('pix_unreconciled', 'critical', 'documentacao', ARRAY['documentacao', 'equipamentos'], '/reconciliacao', true),
  ('portal_dispute_opened', 'normal', 'equipamentos', ARRAY['equipamentos'], '/demurrage', true),
  ('portal_pendencia_geral', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('portal_convite_expirado', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('portal_falha_envio', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('portal_reprocessamento_falhou', 'critical', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('portal_email_suprimido', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('portal_abuso_login', 'critical', 'documentacao', ARRAY['documentacao'], '/clientes/portal', true),
  ('portal_excecao_critica_fatura', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/manifestos', true),
  ('voyage_bl_expected', 'critical', 'documentacao', ARRAY['documentacao'], '/viagens', true),
  ('voyage_baplie_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/baplie', true),
  ('voyage_baplie_documentary_coverage', 'critical', 'documentacao', ARRAY['documentacao'], '/baplie', true),
  ('voyage_ce_mercante_missing', 'critical', 'documentacao', ARRAY['documentacao'], '/viagens', true),
  ('voyage_schedule_date_pending', 'normal', 'operacoes', ARRAY['operacoes', 'documentacao'], '/viagens', true),
  ('voyage_terminal_date_pending', 'normal', 'operacoes', ARRAY['operacoes', 'documentacao'], '/viagens', true),
  ('voyage_export_after_atd', 'normal', 'operacoes', ARRAY['operacoes'], '/viagens', true),
  ('agency_report_department_pending', 'normal', 'documentacao', ARRAY['documentacao'], '/viagens', true),
  ('agency_report_deadline_missed', 'critical', 'documentacao', ARRAY['documentacao'], '/viagens', true),
  ('comunicado_noa_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao', true),
  ('comunicado_nor_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao', true),
  ('comunicado_nob_pendente', 'normal', 'documentacao', ARRAY['documentacao'], '/clientes/comunicacao', true),
  ('cliente_contato_bounced_sem_alternativa', 'critical', 'documentacao', ARRAY['documentacao', 'administrativo'], '/clientes', true)
ON CONFLICT (type) DO UPDATE SET
  severity = EXCLUDED.severity,
  responsible_department = EXCLUDED.responsible_department,
  audience_departments = EXCLUDED.audience_departments,
  default_destination = EXCLUDED.default_destination;

--
-- Baselines de detecção do ADR (migrations arquivadas 251 e 271). TABLE DATA
-- não sai no pg_dump, então o seed manual recria as duas linhas: sem elas, o
-- detector de vencimento dispara retroativamente sobre o histórico inteiro e
-- a fonte POL-ATD do detector de pendências fica desligada em silêncio.
--
INSERT INTO public.agency_report_pending_baselines (baseline_key, captured_at)
VALUES ('voyage_pol_schedule_atd', clock_timestamp()), ('agency_report_deadline_missed', clock_timestamp())
ON CONFLICT (baseline_key) DO NOTHING;
`

const alterAuditLogsDefault = `
--
-- Name: audit_logs actor_role default; Type: DEFAULT; Schema: public;
--
ALTER TABLE public.audit_logs ALTER COLUMN actor_role SET DEFAULT public.current_actor_role();
`

const sql001 = header001 + '\n\n' + blocks001.join('\n\n') + '\n\n' + portsSeed
const sql002 = header002 + '\n\n' + blocks002.join('\n\n') + '\n\n' + alterAuditLogsDefault + '\n\n' + foundationCatalogs002

if (SELF_CHECK) {
  selfCheck()
  process.exit(0)
}

fs.writeFileSync('supabase/test_001_initial_schema.sql', sql001, 'utf8')
fs.writeFileSync('supabase/test_002_business_logic_and_security.sql', sql002, 'utf8')

console.log('Blocks 001:', blocks001.length, 'Bytes:', sql001.length)
console.log('Blocks 002:', blocks002.length, 'Bytes:', sql002.length)

// Nomes de funções `public.nome(` definidos nos blocos (case-insensitive).
function definedFunctions(joined) {
  return new Set(
    [...joined.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  )
}

function assertNoForwardFunctionRefs(b001, b002) {
  const joined001 = b001.join('\n')
  const fns001 = definedFunctions(joined001)
  const only002 = [...definedFunctions(b002.join('\n'))].filter((n) => !fns001.has(n))
  if (only002.length === 0) return
  const refs001 = new Set(
    [...joined001.matchAll(/public\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1].toLowerCase()),
  )
  // audit_logs.actor_role é o único diferimento intencional: sanitizado no
  // 001 e reposto por ALTER no fim do 002 (alterAuditLogsDefault).
  const bad = only002.filter((n) => n !== 'current_actor_role' && refs001.has(n))
  if (bad.length > 0) {
    console.error('Referências do 001 para funções definidas só no 002 (quebram o apply):')
    for (const n of bad.sort()) console.error(`  - public.${n}()`)
    console.error('Diferir via seção manual no fim do 002 ou mover a definição.')
    process.exit(1)
  }
}

// Check runnable (CLAUDE.md): trava sem dump as invariantes que já quebraram
// o squash uma vez. Uso: node scripts/build-squash-migrations.mjs --self-check
function selfCheck() {
  const fail = (msg) => {
    console.error(`self-check FALHOU: ${msg}`)
    process.exit(1)
  }
  // Bloqueante 1 no gerador: pg_trgm sem schema (= public, como a 047).
  if (!/^CREATE EXTENSION IF NOT EXISTS pg_trgm;$/m.test(header001)) {
    fail('header001 não cria pg_trgm em public — regenerar reintroduz o abort da 001.')
  }
  // Bloqueantes 2/3/4 nos seeds manuais.
  for (const needle of [
    "'portal_reprocessamento_falhou'",
    "'voyage_pol_schedule_atd'",
    "'agency_report_deadline_missed'",
  ]) {
    if (!foundationCatalogs002.includes(needle)) fail(`seed manual sem ${needle}.`)
  }
  const alertUpsert = foundationCatalogs002.slice(foundationCatalogs002.indexOf('ON CONFLICT (type)'))
  if (/\bactive\b/.test(alertUpsert)) fail('DO UPDATE do catálogo de alertas reativa aposentados (347/348).')
  for (const t of ['invoice_overdue', 'invoice_payment_invalid', 'invoice_cancel_blocked']) {
    if (!new RegExp(`\\('${t}'[^;]*?, false\\)`).test(foundationCatalogs002)) {
      fail(`tipo aposentado ${t} sem active = false no seed.`)
    }
  }
  // Guarda de refs contra os arquivos comprometidos de verdade.
  let committed001, committed002
  try {
    committed001 = fs.readFileSync('supabase/migrations/001_initial_schema.sql', 'utf8')
    committed002 = fs.readFileSync('supabase/migrations/002_business_logic_and_security.sql', 'utf8')
  } catch {
    fail('rode a partir da raiz do repo (supabase/migrations/*.sql).')
  }
  const fns001 = definedFunctions(committed001)
  const only002 = [...definedFunctions(committed002)].filter((n) => !fns001.has(n))
  const refs001 = new Set(
    [...committed001.matchAll(/public\.([a-z_][a-z0-9_]*)\s*\(/gi)].map((m) => m[1].toLowerCase()),
  )
  const bad = only002.filter((n) => n !== 'current_actor_role' && refs001.has(n))
  if (bad.length > 0) fail(`001 referencia funções só do 002: ${bad.sort().join(', ')}.`)
  if (!/ALTER TABLE public\.audit_logs ALTER COLUMN actor_role SET DEFAULT/.test(committed002)) {
    fail('diferimento do default de audit_logs sumiu do fim do 002.')
  }
  console.log('self-check OK: pg_trgm, seeds 2/3/4 e guarda de refs.')
}

