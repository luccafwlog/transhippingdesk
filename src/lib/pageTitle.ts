// Título de página por rota (WCAG 2.4.2 — Page Titled). Mantém o nome do
// produto como sufixo e antepõe o nome da tela, ajudando leitores de tela e o
// histórico do navegador a distinguir rotas. Ordene do mais específico para o
// mais genérico (o primeiro match vence).
const BASE = 'Transhipping Desk'

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/perfil/, 'Meu perfil'],
  [/^\/login/, 'Login'],
  [/^\/portal\/login/, 'Portal · Login'],
  [/^\/portal\/esqueci-senha/, 'Portal · Recuperar senha'],
  [/^\/portal\/recuperar-senha/, 'Portal · Nova senha'],
  [/^\/portal\/billing/, 'Portal · Faturas'],
  [/^\/portal\/operacao/, 'Portal · Operação'],
  [/^\/portal\/perfil/, 'Portal · Perfil'],
  [/^\/portal$/, 'Portal · Painel'],
  [/^\/painel/, 'Painel'],
  [/^\/viagens/, 'Viagens'],
  [/^\/manifestos\/[^/]+/, 'Detalhe do B/L'],
  [/^\/manifestos/, 'BLs CNTR'],
  [/^\/containers/, 'Containers'],
  [/^\/carga-solta/, 'BLs Carga Solta'],
  [/^\/veiculos/, 'Veículos'],
  [/^\/revisao/, 'Revisão'],
  [/^\/clientes\/[^/]+/, 'Ficha do Cliente'],
  [/^\/clientes/, 'Clientes'],
  [/^\/taxas-locais/, 'Taxas Locais'],
  [/^\/faturamento/, 'Faturamento'],
  [/^\/alertas/, 'Alertas'],
  [/^\/relatorios/, 'Relatórios'],
  [/^\/demurrage\/taxas/, 'Tarifas de Demurrage'],
  [/^\/demurrage/, 'Demurrage'],
  [/^\/reconciliacao/, 'Conciliação PIX'],
  [/^\/granito\/taxas/, 'Tarifas de Granito'],
  [/^\/granito/, 'Granito'],
  [/^\/embarquevazios/, 'Embarque de Vazios'],
  [/^\/vazios-importacao/, 'Vazios de Importação'],
  [/^\/baplie/, 'Baplie EDI'],
  [/^\/chegadas-saidas/, 'Chegadas e Saídas'],
  [/^\/admin\/usuarios/, 'Administração · Usuários'],
]

export function routeTitle(pathname: string): string {
  const match = ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))
  return match ? `${match[1]} · ${BASE}` : BASE
}
