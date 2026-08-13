import { Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { routeTitle } from './lib/pageTitle'
import { AppLayout } from './components/layout/AppLayout'
import { PortalProtectedRoute } from './components/layout/PortalProtectedRoute'
import { PortalLayout } from './components/layout/PortalLayout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { lazyPage } from './lib/lazyPage'
import { matchRoutePreload, type RoutePreloadTable } from './lib/routePreload'
import { markStartupStage } from './lib/telemetry'

const Login = lazyPage(() => import('./pages/Login'), 'Login')
const PortalLogin = lazyPage(() => import('./pages/PortalLogin'), 'PortalLogin')
const PortalBilling = lazyPage(() => import('./pages/PortalBilling'), 'PortalBilling')
const PortalOperacao = lazyPage(() => import('./pages/PortalOperacao'), 'PortalOperacao')
const PortalDashboard = lazyPage(() => import('./pages/PortalDashboard'), 'PortalDashboard')
const PortalForgotPassword = lazyPage(() => import('./pages/PortalForgotPassword'), 'PortalForgotPassword')
const PortalResetPassword = lazyPage(() => import('./pages/PortalResetPassword'), 'PortalResetPassword')
const PortalAtivacao = lazyPage(() => import('./pages/PortalAtivacao'), 'PortalAtivacao')
const PortalProfile = lazyPage(() => import('./pages/PortalProfile'), 'PortalProfile')
const Painel = lazyPage(() => import('./pages/Painel'), 'Painel')
const Viagens = lazyPage(() => import('./pages/Viagens'), 'Viagens')
const Manifestos = lazyPage(() => import('./pages/Manifestos'), 'Manifestos')
const Containers = lazyPage(() => import('./pages/Containers'), 'Containers')
const CargaSolta = lazyPage(() => import('./pages/CargaSolta'), 'CargaSolta')
const Veiculos = lazyPage(() => import('./pages/Veiculos'), 'Veiculos')
const BlDetalhe = lazyPage(() => import('./pages/BlDetalhe'), 'BlDetalhe')
const Revisao = lazyPage(() => import('./pages/Revisao'), 'Revisao')
const Clientes = lazyPage(() => import('./pages/Clientes'), 'Clientes')
const ClientesPortal = lazyPage(() => import('./pages/ClientesPortal'), 'ClientesPortal')
const ClienteFicha = lazyPage(() => import('./pages/ClienteFicha'), 'ClienteFicha')
const TaxasLocais = lazyPage(() => import('./pages/TaxasLocais'), 'TaxasLocais')
const Faturamento = lazyPage(() => import('./pages/Faturamento'), 'Faturamento')
const Alertas = lazyPage(() => import('./pages/Alertas'), 'Alertas')
const Relatorios = lazyPage(() => import('./pages/Relatorios'), 'Relatorios')
const LineUpTVDisplay = lazyPage(() => import('./pages/LineUpTVDisplay'), 'LineUpTVDisplay')
const AdminUsuarios = lazyPage(() => import('./pages/AdminUsuarios'), 'AdminUsuarios')
const Demurrage = lazyPage(() => import('./pages/Demurrage'), 'Demurrage')
const Reconciliacao = lazyPage(() => import('./pages/Reconciliacao'), 'Reconciliacao')
const Granite = lazyPage(() => import('./pages/Granite'), 'Granite')
const GraniteRates = lazyPage(() => import('./pages/GraniteRates'), 'GraniteRates')
const DepotCadastro = lazyPage(() => import('./pages/DepotCadastro'), 'DepotCadastro')
const DemurrageRates = lazyPage(() => import('./pages/DemurrageRates'), 'DemurrageRates')
const EmbarqueVazios = lazyPage(() => import('./pages/EmbarqueVazios'), 'EmbarqueVazios')
const VaziosImportacao = lazyPage(() => import('./pages/VaziosImportacao'), 'VaziosImportacao')
const BaplieEDI = lazyPage(() => import('./pages/Baplie'), 'Baplie')
const ChegadasSaidas = lazyPage(() => import('./pages/ChegadasSaidas'), 'ChegadasSaidas')
const Profile = lazyPage(() => import('./pages/Profile'), 'Profile')

function RouteLoading() {
  return (
    <main className="px-6 py-10">
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-5 py-4 text-sm text-[var(--app-muted)] shadow-[var(--app-shadow)]">
        Carregando tela...
      </div>
    </main>
  )
}

function withSuspense(node: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{node}</Suspense>
}

// Mantém document.title descritivo por rota (WCAG 2.4.2). Não renderiza nada.
function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = routeTitle(pathname)
  }, [pathname])
  return null
}

// O app é o mesmo SPA servido em dois domínios: `portal.<dominio>` é exclusivo
// do Portal do Cliente; qualquer outro host (raiz, web.app, localhost) é o
// sistema interno. Em host de Portal, rotas internas e a raiz caem em /portal.
const isPortalHost = typeof window !== 'undefined' && window.location.hostname.startsWith('portal.')

// Rota-padrão para quem cai em "/" ou num caminho sem correspondência: a
// própria árvore de <Routes> redireciona esses casos para o dashboard de
// cada host (Navigate), então pré-carregamos o mesmo chunk aqui para que o
// import() comece em paralelo com a resolução de sessão, e não depois dela.
const defaultPreload = isPortalHost ? PortalDashboard.preload : Painel.preload

const routePreloads: RoutePreloadTable = [
  ['/portal/login', PortalLogin.preload], ['/portal/esqueci-senha', PortalForgotPassword.preload],
  ['/portal/recuperar-senha', PortalResetPassword.preload], ['/portal/ativar', PortalAtivacao.preload],
  ['/portal', PortalDashboard.preload], ['/portal/billing', PortalBilling.preload], ['/portal/operacao', PortalOperacao.preload],
  ['/portal/perfil', PortalProfile.preload], ['/login', Login.preload], ['/line-up-tv/display', LineUpTVDisplay.preload],
  ['/painel', Painel.preload], ['/viagens/:voyageId', Viagens.preload], ['/viagens', Viagens.preload],
  ['/manifestos/:blId', BlDetalhe.preload], ['/manifestos', Manifestos.preload], ['/containers', Containers.preload],
  ['/carga-solta', CargaSolta.preload], ['/veiculos', Veiculos.preload], ['/revisao', Revisao.preload],
  ['/clientes/portal', ClientesPortal.preload], ['/clientes/:cnpj', ClienteFicha.preload], ['/clientes', Clientes.preload],
  ['/taxas-locais', TaxasLocais.preload], ['/faturamento', Faturamento.preload], ['/alertas', Alertas.preload],
  ['/relatorios', Relatorios.preload], ['/demurrage', Demurrage.preload], ['/reconciliacao', Reconciliacao.preload],
  ['/granito/taxas', GraniteRates.preload], ['/granito', Granite.preload], ['/demurrage/taxas', DemurrageRates.preload],
  ['/embarquevazios/depots', DepotCadastro.preload], ['/embarquevazios', EmbarqueVazios.preload],
  ['/vazios-importacao', VaziosImportacao.preload], ['/baplie', BaplieEDI.preload], ['/chegadas-saidas', ChegadasSaidas.preload],
  ['/perfil', Profile.preload], ['/admin/usuarios', AdminUsuarios.preload],
  ['/', defaultPreload], ['*', defaultPreload],
]

function RoutePreloader() {
  const { pathname } = useLocation()
  useEffect(() => {
    const preload = matchRoutePreload(pathname, routePreloads)
    preload?.()
      .then(() => markStartupStage('route-chunk'))
      .catch(() => {})
  }, [pathname])
  return null
}

export default function App() {
  return (
    <>
      <DocumentTitle />
      <RoutePreloader />
      <Routes>
      <Route path="/portal/login" element={withSuspense(<PortalLogin />)} />
      <Route path="/portal/esqueci-senha" element={withSuspense(<PortalForgotPassword />)} />
      <Route path="/portal/recuperar-senha" element={withSuspense(<PortalResetPassword />)} />
      <Route path="/portal/ativar" element={withSuspense(<PortalAtivacao />)} />
      <Route element={<PortalProtectedRoute />}>
        <Route element={<PortalLayout />}>
          <Route path="/portal" element={withSuspense(<PortalDashboard />)} />
          <Route path="/portal/billing" element={withSuspense(<PortalBilling />)} />
          <Route path="/portal/operacao" element={withSuspense(<PortalOperacao />)} />
          <Route path="/portal/perfil" element={withSuspense(<PortalProfile />)} />
        </Route>
      </Route>
      {isPortalHost ? (
        <Route path="*" element={<Navigate to="/portal" replace />} />
      ) : (
      <>
      <Route path="/login" element={withSuspense(<Login />)} />
      <Route element={<ProtectedRoute />}>
        <Route path="/line-up-tv/display" element={withSuspense(<LineUpTVDisplay />)} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/painel" replace />} />
          <Route path="/painel" element={withSuspense(<Painel />)} />
          <Route path="/viagens" element={withSuspense(<Viagens />)} />
          <Route path="/viagens/:voyageId" element={withSuspense(<Viagens />)} />
          <Route path="/manifestos" element={withSuspense(<Manifestos />)} />
          <Route path="/containers" element={withSuspense(<Containers />)} />
          <Route path="/carga-solta" element={withSuspense(<CargaSolta />)} />
          <Route path="/veiculos" element={withSuspense(<Veiculos />)} />
          <Route path="/manifestos/:blId" element={withSuspense(<BlDetalhe />)} />
          <Route path="/revisao" element={withSuspense(<Revisao />)} />
          <Route path="/clientes" element={withSuspense(<Clientes />)} />
          <Route path="/clientes/portal" element={withSuspense(<ClientesPortal />)} />
          <Route path="/clientes/:cnpj" element={withSuspense(<ClienteFicha />)} />
          <Route path="/taxas-locais" element={withSuspense(<TaxasLocais />)} />
          <Route path="/faturamento" element={withSuspense(<Faturamento />)} />
          <Route path="/alertas" element={withSuspense(<Alertas />)} />
          <Route path="/relatorios" element={withSuspense(<Relatorios />)} />
          <Route path="/demurrage" element={withSuspense(<Demurrage />)} />
          <Route path="/demurrage/invoices" element={<Navigate to="/demurrage" replace />} />
          <Route path="/demurrage/reconciliacao" element={<Navigate to="/reconciliacao" replace />} />
          <Route path="/reconciliacao" element={withSuspense(<Reconciliacao />)} />
          <Route path="/granito" element={withSuspense(<Granite />)} />
          <Route path="/granito/taxas" element={withSuspense(<GraniteRates />)} />
          <Route path="/demurrage/taxas" element={withSuspense(<DemurrageRates />)} />
          <Route path="/embarquevazios" element={withSuspense(<EmbarqueVazios />)} />
          <Route path="/embarquevazios/depots" element={withSuspense(<DepotCadastro />)} />
          <Route path="/vazios" element={<Navigate to="/embarquevazios" replace />} />
          <Route path="/vazios-importacao" element={withSuspense(<VaziosImportacao />)} />
          <Route path="/baplie" element={withSuspense(<BaplieEDI />)} />
          <Route path="/chegadas-saidas" element={withSuspense(<ChegadasSaidas />)} />
          <Route path="/perfil" element={withSuspense(<Profile />)} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute adminOnly />}>
        <Route element={<AppLayout />}>
          <Route path="/admin/usuarios" element={withSuspense(<AdminUsuarios />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
      </>
      )}
      </Routes>
    </>
  )
}
