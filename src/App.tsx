import { Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { PortalProtectedRoute } from './components/layout/PortalProtectedRoute'
import { PortalLayout } from './components/layout/PortalLayout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { lazyPage } from './lib/lazyPage'

const Login = lazyPage(() => import('./pages/Login'), 'Login')
const PortalLogin = lazyPage(() => import('./pages/PortalLogin'), 'PortalLogin')
const PortalBilling = lazyPage(() => import('./pages/PortalBilling'), 'PortalBilling')
const PortalOperacao = lazyPage(() => import('./pages/PortalOperacao'), 'PortalOperacao')
const PortalDashboard = lazyPage(() => import('./pages/PortalDashboard'), 'PortalDashboard')
const PortalForgotPassword = lazyPage(() => import('./pages/PortalForgotPassword'), 'PortalForgotPassword')
const PortalResetPassword = lazyPage(() => import('./pages/PortalResetPassword'), 'PortalResetPassword')
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
const ClienteFicha = lazyPage(() => import('./pages/ClienteFicha'), 'ClienteFicha')
const TaxasLocais = lazyPage(() => import('./pages/TaxasLocais'), 'TaxasLocais')
const Faturamento = lazyPage(() => import('./pages/Faturamento'), 'Faturamento')
const Alertas = lazyPage(() => import('./pages/Alertas'), 'Alertas')
const Relatorios = lazyPage(() => import('./pages/Relatorios'), 'Relatorios')
const LineUpTV = lazyPage(() => import('./pages/LineUpTV'), 'LineUpTV')
const LineUpTVDisplay = lazyPage(() => import('./pages/LineUpTVDisplay'), 'LineUpTVDisplay')
const AdminUsuarios = lazyPage(() => import('./pages/AdminUsuarios'), 'AdminUsuarios')
const Demurrage = lazyPage(() => import('./pages/Demurrage'), 'Demurrage')
const Reconciliacao = lazyPage(() => import('./pages/Reconciliacao'), 'Reconciliacao')
const Granite = lazyPage(() => import('./pages/Granite'), 'Granite')
const GraniteRates = lazyPage(() => import('./pages/GraniteRates'), 'GraniteRates')
const DemurrageRates = lazyPage(() => import('./pages/DemurrageRates'), 'DemurrageRates')
const EmbarqueVazios = lazyPage(() => import('./pages/EmbarqueVazios'), 'EmbarqueVazios')
const VaziosImportacao = lazyPage(() => import('./pages/VaziosImportacao'), 'VaziosImportacao')
const BaplieEDI = lazyPage(() => import('./pages/Baplie'), 'Baplie')

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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={withSuspense(<Login />)} />
      <Route path="/portal/login" element={withSuspense(<PortalLogin />)} />
      <Route path="/portal/esqueci-senha" element={withSuspense(<PortalForgotPassword />)} />
      <Route path="/portal/recuperar-senha" element={withSuspense(<PortalResetPassword />)} />
      <Route element={<PortalProtectedRoute />}>
        <Route element={<PortalLayout />}>
          <Route path="/portal" element={withSuspense(<PortalDashboard />)} />
          <Route path="/portal/billing" element={withSuspense(<PortalBilling />)} />
          <Route path="/portal/operacao" element={withSuspense(<PortalOperacao />)} />
          <Route path="/portal/perfil" element={withSuspense(<PortalProfile />)} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/line-up-tv/display" element={withSuspense(<LineUpTVDisplay />)} />
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/painel" replace />} />
          <Route path="/painel" element={withSuspense(<Painel />)} />
          <Route path="/viagens" element={withSuspense(<Viagens />)} />
          <Route path="/manifestos" element={withSuspense(<Manifestos />)} />
          <Route path="/containers" element={withSuspense(<Containers />)} />
          <Route path="/carga-solta" element={withSuspense(<CargaSolta />)} />
          <Route path="/veiculos" element={withSuspense(<Veiculos />)} />
          <Route path="/manifestos/:blId" element={withSuspense(<BlDetalhe />)} />
          <Route path="/revisao" element={withSuspense(<Revisao />)} />
          <Route path="/clientes" element={withSuspense(<Clientes />)} />
          <Route path="/clientes/:cnpj" element={withSuspense(<ClienteFicha />)} />
          <Route path="/taxas-locais" element={withSuspense(<TaxasLocais />)} />
          <Route path="/faturamento" element={withSuspense(<Faturamento />)} />
          <Route path="/alertas" element={withSuspense(<Alertas />)} />
          <Route path="/relatorios" element={withSuspense(<Relatorios />)} />
          <Route path="/line-up-tv" element={withSuspense(<LineUpTV />)} />
          <Route path="/demurrage" element={withSuspense(<Demurrage />)} />
          <Route path="/demurrage/invoices" element={<Navigate to="/demurrage" replace />} />
          <Route path="/demurrage/reconciliacao" element={<Navigate to="/reconciliacao" replace />} />
          <Route path="/reconciliacao" element={withSuspense(<Reconciliacao />)} />
          <Route path="/granito" element={withSuspense(<Granite />)} />
          <Route path="/granito/taxas" element={withSuspense(<GraniteRates />)} />
          <Route path="/demurrage/taxas" element={withSuspense(<DemurrageRates />)} />
          <Route path="/embarquevazios" element={withSuspense(<EmbarqueVazios />)} />
          <Route path="/vazios" element={<Navigate to="/embarquevazios" replace />} />
          <Route path="/vazios-importacao" element={withSuspense(<VaziosImportacao />)} />
          <Route path="/baplie" element={withSuspense(<BaplieEDI />)} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute adminOnly />}>
        <Route element={<AppLayout />}>
          <Route path="/admin/usuarios" element={withSuspense(<AdminUsuarios />)} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  )
}
