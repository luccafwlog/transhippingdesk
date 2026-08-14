import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// As Edge Functions montam clientes Supabase por URL (esm.sh) no topo do
// módulo, então o Vitest não as importa. A lógica que dá para exercitar de
// verdade foi extraída para `_shared/` e tem teste próprio
// (portalLoginRateLimit, portalInvites, portalAlerts); o que sobra aqui é a
// ORDEM em que o handler chama essas peças — que é justamente o contrato de
// cada achado, e que um refactor descuidado inverteria em silêncio.

const emailChange = readFileSync('supabase/functions/portal-recovery-email-change/index.ts', 'utf8')
const login = readFileSync('supabase/functions/portal-login/index.ts', 'utf8')
const recovery = readFileSync('supabase/functions/portal-password-recovery/index.ts', 'utf8')

function indexOf(source: string, needle: string): number {
  const at = source.indexOf(needle)
  expect(at, `trecho não encontrado: ${needle}`).toBeGreaterThan(-1)
  return at
}

describe('troca de Email de Recuperação consulta a trava antes de verificar a senha', () => {
  // Achado B: quem tivesse uma sessão do Portal aberta testava senha sem limite
  // por este caminho, contornando as 5 tentativas do login.
  it('chama isLoginRateLimited antes de signInWithPassword', () => {
    expect(indexOf(emailChange, 'isLoginRateLimited(admin, account.login_cnpj)')).toBeLessThan(indexOf(emailChange, 'verifier.auth.signInWithPassword'))
  })

  it('responde 429 sem seguir adiante quando o balde está cheio', () => {
    expect(emailChange).toContain('if (await isLoginRateLimited(admin, account.login_cnpj)) return new Response(JSON.stringify({ error: RATE_LIMITED }), { status: 429 })')
  })

  it('registra falha e sucesso no contador do login', () => {
    expect(emailChange).toContain('await registerLoginFailure(admin, account.login_cnpj)')
    expect(emailChange).toContain('await registerLoginSuccess(admin, account.login_cnpj)')
  })

  // A verificação criava uma sessão do Auth que ninguém mais usava.
  it('encerra a sessão criada só para verificar a senha', () => {
    expect(emailChange).toContain('verifier.auth.signOut()')
  })

  it('devolve mensagem própria para o pedido já resolvido, com status distinto', () => {
    expect(emailChange).toContain("if (resolution.outcome === 'pedido_ja_resolvido') return new Response(JSON.stringify({ error: ALREADY_RESOLVED }), { status: 409 })")
    expect(emailChange).toContain("if (resolution.outcome === 'link_invalido') return new Response(JSON.stringify({ error: 'Link inválido ou expirado.' }), { status: 410 })")
  })
})

describe('caminho bloqueado do login não faz trabalho síncrono a mais', () => {
  // Achado J: os dois desfechos devolvem o mesmo 401, mas um consultava a conta
  // (e às vezes `alerts`) antes de responder — assimetria mensurável num
  // caminho projetado para não ter nenhuma.
  it('move a consulta e o alerta para segundo plano com EdgeRuntime.waitUntil', () => {
    const blockedBranch = login.slice(indexOf(login, 'if (await isLoginRateLimited(admin, normalized))'), indexOf(login, 'const { data: account }'))
    expect(blockedBranch).toContain('EdgeRuntime.waitUntil(alertWork)')
    expect(indexOf(blockedBranch, 'EdgeRuntime.waitUntil(alertWork)')).toBeLessThan(indexOf(blockedBranch, 'return json(401, { error: GENERIC_ERROR }, origin)'))
    // A consulta à conta e a abertura do alerta ficam dentro do trabalho
    // adiado, não antes da resposta.
    expect(indexOf(blockedBranch, "from('customer_portal_accounts')")).toBeGreaterThan(indexOf(blockedBranch, 'const alertWork = (async () => {'))
  })

  it('preserva a deduplicação do alerta por cliente', () => {
    expect(login).toContain("type: 'portal_abuso_login'")
    expect(login).toContain('openAlertOnce(admin, {')
  })
})

describe('recuperação reusa o convite vivo em vez de enviar email novo', () => {
  // Achado I: cada pedido invalidava o convite anterior e criava outro, então
  // um terceiro com o CNPJ público fazia o sistema despejar emails na caixa de
  // um cliente real — e cancelava o link que o cliente estava lendo.
  it('procura o convite vivo antes de invalidar os pendentes', () => {
    expect(indexOf(recovery, 'findLiveRecoveryInvite(admin, account.id')).toBeLessThan(indexOf(recovery, "update({ status: 'invalidado_por_reenvio' })"))
    expect(recovery).toContain('if (liveInvite) return accepted()')
  })

  // Contar só os pedidos sem conta transformaria o bloqueio em oráculo de
  // enumeração; o registro da tentativa continua antes de qualquer bifurcação.
  it('não altera o balde de tentativas', () => {
    expect(indexOf(recovery, "admin.rpc('portal_recovery_register_failure'")).toBeLessThan(indexOf(recovery, 'findLiveRecoveryInvite(admin, account.id'))
  })

  it('o caminho de reuso devolve a mesma resposta dos demais casos elegíveis', () => {
    expect(recovery).toContain("const accepted = () => new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })")
  })
})
