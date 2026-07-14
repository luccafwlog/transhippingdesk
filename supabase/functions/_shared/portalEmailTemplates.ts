type InviteTemplateInput = { companyName: string; cnpjMasked: string; activationUrl: string; supportEmail: string }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
function layout(title: string, paragraphs: string[], button?: { label: string; url: string }) {
  const body = paragraphs.map((paragraph) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(paragraph)}</p>`).join('')
  const cta = button ? `<p><a href="${escapeHtml(button.url)}" style="background:#1f6feb;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block">${escapeHtml(button.label)}</a></p>` : ''
  return `<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:system-ui,sans-serif;color:#24292f"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px"><table role="presentation" width="600" style="max-width:600px;background:#fff;padding:32px"><tr><td><h1 style="font-size:22px">${escapeHtml(title)}</h1>${body}${cta}</td></tr></table></td></tr></table></body></html>`
}
export function inviteTemplate(i: InviteTemplateInput) {
  const text = [`A ${i.companyName} (CNPJ ${i.cnpjMasked}) foi convidada para o Portal do Cliente.`, '', 'Ative o acesso e crie sua própria senha. O link vale por 48 horas:', i.activationUrl, '', `Se você não é a pessoa autorizada, ignore este email e avise a Transhipping em ${i.supportEmail}.`].join('\n')
  return { subject: `Ative o acesso da ${i.companyName} ao Portal do Cliente`, text, html: layout(`Ative o acesso da ${i.companyName}`, [`A ${i.companyName} (CNPJ ${i.cnpjMasked}) foi convidada para o Portal do Cliente.`, 'O link vale por 48 horas.', `Se você não é a pessoa autorizada, ignore este email e avise a Transhipping em ${i.supportEmail}.`], { label: 'Ativar acesso', url: i.activationUrl }) }
}
export function resendTemplate(i: InviteTemplateInput) {
  const text = [`Enviamos um novo link de ativação para ${i.companyName} (CNPJ ${i.cnpjMasked}).`, 'Os links anteriores deixaram de funcionar.', '', i.activationUrl, '', `Se você não é a pessoa autorizada, ignore este email e avise a Transhipping em ${i.supportEmail}.`].join('\n')
  return { subject: 'Novo convite para ativar seu acesso ao Portal do Cliente', text, html: layout('Novo convite do Portal do Cliente', [`Enviamos um novo link de ativação para ${i.companyName} (CNPJ ${i.cnpjMasked}).`, 'Os links anteriores foram invalidados. O novo link vale por 48 horas.', `Se você não é a pessoa autorizada, ignore este email e avise a Transhipping em ${i.supportEmail}.`], { label: 'Ativar acesso', url: i.activationUrl }) }
}
export function recoveryTemplate(i: Omit<InviteTemplateInput, 'activationUrl'> & { recoveryUrl: string }) {
  const text = [`Recebemos um pedido de recuperação de acesso da ${i.companyName} (CNPJ ${i.cnpjMasked}).`, '', 'O link abaixo é de uso único e expira em 1 hora:', i.recoveryUrl, '', 'Se você não fez este pedido, ignore esta mensagem.'].join('\n')
  return { subject: 'Recuperação de acesso ao Portal do Cliente', text, html: layout('Recuperação de acesso', [`Recebemos um pedido de recuperação de acesso da ${i.companyName} (CNPJ ${i.cnpjMasked}).`, 'O link é de uso único e expira em 1 hora.', 'Se você não fez este pedido, ignore esta mensagem.'], { label: 'Recuperar acesso', url: i.recoveryUrl }) }
}
