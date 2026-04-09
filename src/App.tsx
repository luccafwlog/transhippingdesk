import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { Login } from './pages/Login'
import { Painel } from './pages/Painel'
import { Viagens } from './pages/Viagens'
import { Manifestos } from './pages/Manifestos'
import { Containers } from './pages/Containers'
import { BlDetalhe } from './pages/BlDetalhe'
import { Revisao } from './pages/Revisao'
import { Clientes } from './pages/Clientes'
import { ClienteFicha } from './pages/ClienteFicha'
import { PlaceholderPage } from './pages/PlaceholderPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/painel" replace />} />
          <Route path="/painel" element={<Painel />} />
          <Route path="/viagens" element={<Viagens />} />
          <Route path="/manifestos" element={<Manifestos />} />
          <Route path="/containers" element={<Containers />} />
          <Route path="/manifestos/:blId" element={<BlDetalhe />} />
          <Route path="/revisao" element={<Revisao />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/clientes/:cnpj" element={<ClienteFicha />} />
          <Route path="/taxas-locais" element={<PlaceholderPage title="Taxas Locais" phase="Fase 2" />} />
          <Route path="/faturamento" element={<PlaceholderPage title="Faturamento" phase="Fase 3" />} />
          <Route path="/alertas" element={<PlaceholderPage title="Alertas" phase="Fase 3" />} />
          <Route path="/relatorios" element={<PlaceholderPage title="Relatorios" phase="Fase 3" />} />
          <Route path="/line-up-tv" element={<PlaceholderPage title="Line up TV" phase="Fase 4" />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute adminOnly />}>
        <Route element={<AppLayout />}>
          <Route path="/admin/usuarios" element={<PlaceholderPage title="Admin - Usuarios" phase="Fase 4" />} />
          <Route path="/admin/tarifas" element={<PlaceholderPage title="Admin - Tarifas" phase="Fase 4" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/painel" replace />} />
    </Routes>
  )
}
