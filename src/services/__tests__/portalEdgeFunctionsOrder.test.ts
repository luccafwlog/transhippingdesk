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
const webhook = readFileSync('supabase/functions/portal-email-webhook/index.ts', 'utf8')

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

  // Falha ao resolver o usuário do Auth não é senha errada: registrá-la no
  // balde gastaria as tentativas do cliente por defeito do servidor e o
  // trancaria 15 minutos fora do Portal sem que ele tivesse errado nada.
  it('não registra falha quando o email técnico não pôde ser resolvido', () => {
    expect(emailChange).toContain("if (!technicalEmail) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 500 })")
    expect(indexOf(emailChange, 'if (!technicalEmail)')).toBeLessThan(indexOf(emailChange, 'await registerLoginFailure(admin, account.login_cnpj)'))
  })

  // A verificação criava uma sessão do Auth que ninguém mais usava. O escopo
  // importa: o padrão do supabase-js é `global`, que derrubaria também a aba em
  // que o cliente está fazendo o pedido.
  it('encerra só a sessão criada para verificar a senha, sem derrubar as do cliente', () => {
    expect(emailChange).toContain("verifier.auth.signOut({ scope: 'local' })")
    expect(emailChange).not.toContain('verifier.auth.signOut()')
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

describe('webhook do Resend grava o fato antes de tentar avisar', () => {
  // `openAlertOnce` passou a propagar erro que não seja o 23505 da corrida. No
  // webhook isso cai dentro de um laço por Cliente da mesma caixa: subir daqui
  // abortaria os Clientes seguintes e devolveria 500 -- e o retry do Resend
  // encontraria a linha de dedup já gravada no início do handler, que responde
  // 200 sem reprocessar nada. O alerta é aviso; `recovery_email_status` é o
  // fato, e ele já foi gravado.
  it('isola a falha do alerta sem abortar os demais Clientes da caixa', () => {
    expect(indexOf(webhook, "update({ recovery_email_status:")).toBeLessThan(indexOf(webhook, 'openAlertOnce(admin, {'))
    const laco = webhook.slice(indexOf(webhook, 'for (const account of affected ?? [])'))
    expect(laco).toContain('try {')
    expect(indexOf(laco, 'try {')).toBeLessThan(indexOf(laco, 'openAlertOnce(admin, {'))
    expect(laco).toContain("console.error('[portal-email-webhook] falha ao abrir alerta de email suprimido'")
  })

  // A linha de dedup entra antes de qualquer processamento, então um 500 depois
  // dela é definitivo: o retry cai no 23505 e devolve 200.
  it('devolve 200 no evento repetido, o que torna o 500 posterior irreversível', () => {
    expect(webhook).toContain("if (dedupError?.code === '23505') return new Response(null, { status: 200 })")
    expect(indexOf(webhook, 'portal_email_events').valueOf()).toBeLessThan(indexOf(webhook, 'openAlertOnce(admin, {'))
  })
})

describe('recuperação reusa o convite vivo em vez de enviar email novo', () => {
  // Achado I: cada pedido invalidava o convite anterior e criava outro, então
  // um terceiro com o CNPJ público fazia o sistema despejar emails na caixa de
  // um cliente real — e cancelava o link que o cliente estava lendo.
  it('procura o convite reusável antes de invalidar os pendentes', () => {
    expect(indexOf(recovery, 'findReusableRecoveryInvite(admin, account.id')).toBeLessThan(indexOf(recovery, "update({ status: 'invalidado_por_reenvio' })"))
    expect(recovery).toContain('if (liveInvite) return accepted()')
  })

  // Reuso é sobre um link que o cliente possa ler AGORA: o convite tem de estar
  // endereçado ao email vigente, e não basta estar pendente -- pendente também
  // fica o convite cujo envio o Resend recusou.
  it('passa o email de recuperação vigente para a decisão de reuso', () => {
    expect(recovery).toContain('findReusableRecoveryInvite(admin, account.id, account.recovery_email, Date.now())')
  })

  // Contar só os pedidos sem conta transformaria o bloqueio em oráculo de
  // enumeração; o registro da tentativa continua antes de qualquer bifurcação.
  it('não altera o balde de tentativas', () => {
    expect(indexOf(recovery, "admin.rpc('portal_recovery_register_failure'")).toBeLessThan(indexOf(recovery, 'findReusableRecoveryInvite(admin, account.id'))
  })

  it('o caminho de reuso devolve a mesma resposta dos demais casos elegíveis', () => {
    expect(recovery).toContain("const accepted = () => new Response(JSON.stringify({ accepted: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })")
  })
})
