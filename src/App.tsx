import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { PortalProtectedRoute } from './components/layout/PortalProtectedRoute'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { Login } from './pages/Login'
import { PortalBilling } from './pages/PortalBilling'
import { PortalLogin } from './pages/PortalLogin'
import { Painel } from './pages/Painel'
import { Viagens } from './pages/Viagens'
import { Manifestos } from './pages/Manifestos'
import { Containers } from './pages/Containers'
import { CargaSolta } from './pages/CargaSolta'
import { Veiculos } from './pages/Veiculos'
import { BlDetalhe } from './pages/BlDetalhe'
import { Revisao } from './pages/Revisao'
import { Clientes } from './pages/Clientes'
import { ClienteFicha } from './pages/ClienteFicha'
import { TaxasLocais } from './pages/TaxasLocais'
import { Faturamento } from './pages/Faturamento'
import { Alertas } from './pages/Alertas'
import { Relatorios } from './pages/Relatorios'
import { LineUpTV } from './pages/LineUpTV'
import { AdminUsuarios } from './pages/AdminUsuarios'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route element={<PortalProtectedRoute />}>
        <Route path="/portal/billing" element={<PortalBilling />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/painel" replace />} />
          <Route path="/painel" element={<Painel />} />
          <Route path="/viagens" element={<Viagens />} />
          <Route path="/manifestos" element={<Manifestos />} />
          <Route path="/containers" element={<Containers />} />
          <Route path="/carga-solta" element={<CargaSolta />} />
          <Route path="/veiculos" element={<Veiculos />} />
          <Route path="/manifestos/:blId" element={<BlDetalhe />} />
          <Route path="/revisao" element={<Revisao />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:cnpj" element={<ClienteFicha />} />
          <Route path="/taxas-locais" element={<TaxasLocais />} />
          <Route path="/faturamento" element={<Faturamento />} />
          <Route path="/alertas" element={<Alertas />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/line-up-tv" element={<LineUpTV />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute adminOnly />}>
        <Route element={<AppLayout />}>
          <Route path="/admin/usuarios" element={<AdminUsuarios />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  )
}
