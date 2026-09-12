// Título de página por rota (WCAG 2.4.2 — Page Titled). Mantém o nome do
// produto como sufixo e antepõe o nome da tela, ajudando leitores de tela e o
// histórico do navegador a distinguir rotas. Ordene do mais específico para o
// mais genérico (o primeiro match vence).
import { ADMIN_TABS } from '../pages/adminTabs'

const BASE = 'Transhipping Desk'

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/clientes\/portal\/inspecao\//, 'Portal · Inspeção'],
  [/^\/perfil/, 'Meu perfil'],
  [/^\/login/, 'Login'],
  [/^\/portal\/login/, 'Portal · Login'],
  [/^\/portal\/esqueci-senha/, 'Portal · Recuperar senha'],
  [/^\/portal\/recuperar-senha/, 'Portal · Nova senha'],
  [/^\/portal\/billing/, 'Portal · Faturas'],
  [/^\/portal\/operacao/, 'Portal · Operação'],
  [/^\/portal\/perfil/, 'Portal · Perfil'],
  [/^\/portal$/, 'Portal · Painel'],
  [/^\/line-up-tv\/display/, 'Line Up · Tela TV'],
  [/^\/painel/, 'Painel'],
  [/^\/viagens/, 'Viagens'],
  [/^\/manifestos\/[^/]+/, 'Detalhe do B/L'],
  [/^\/manifestos/, 'BLs CNTR'],
  [/^\/containers/, 'Containers'],
  [/^\/carga-solta/, 'BLs Carga Solta'],
  [/^\/veiculos/, 'Veículos'],
  [/^\/revisao/, 'Revisão'],
  [/^\/clientes\/comunicacao/, 'Clientes · Comunicação'],
  // Precisam vir antes do padrão de CNPJ, senão caem em "Ficha do Cliente".
  [/^\/clientes\/portal/, 'Clientes · Provisionamento do Portal'],
  [/^\/clientes\/[^/]+/, 'Ficha do Cliente'],
  [/^\/clientes/, 'Clientes'],
  [/^\/taxas-locais\/tabelas/, 'Tabelas de Taxas Locais'],
  [/^\/taxas-locais/, 'Taxas Locais'],
  [/^\/alertas\/regras/, 'Regras de Alertas'],
  [/^\/alertas/, 'Alertas'],
  [/^\/relatorios/, 'Relatórios'],
  [/^\/demurrage\/taxas/, 'Tarifas de Demurrage'],
  [/^\/demurrage/, 'Demurrage'],
  [/^\/reconciliacao/, 'Conciliação PIX'],
  [/^\/granito\/taxas/, 'Tarifas de Granito'],
  [/^\/granito/, 'Granito'],
  [/^\/embarquevazios\/depots/, 'Cadastro de Terminais'],
  [/^\/embarquevazios/, 'Embarque de Vazios'],
  [/^\/vazios-importacao/, 'Vazios de Importação'],
  [/^\/baplie/, 'Baplie EDI'],
  [/^\/chegadas-saidas/, 'Chegadas e Saídas'],
  // Cada aba de Administração tem rota própria e, portanto, título próprio.
  ...ADMIN_TABS.map(({ slug, label }) => [
    new RegExp(`^/admin/${slug}`), `Administração · ${label}`,
  ] as [RegExp, string]),
  [/^\/admin/, 'Administração'],
]

export function routeTitle(pathname: string): string {
  const match = ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))
  return match ? `${match[1]} · ${BASE}` : BASE
}
