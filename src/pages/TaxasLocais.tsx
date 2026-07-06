import { useState } from 'react'
import { TabButton } from '../components/ui/TabButton'
import { PageHeader } from '../components/ui/Card'
import { useAuth } from '../hooks/useAuth'
import { ChargeTablesTab } from '../components/taxasLocais/ChargeTablesTab'
import { ChargeOverridesTab } from '../components/taxasLocais/ChargeOverridesTab'
import type { CargoModeFilter, LocalChargeTab } from '../components/taxasLocais/chargeForms'

export function TaxasLocais() {
  const { can } = useAuth()
  const canManageTables = can('charge_tables')
  const canManageOverrides = can('charge_overrides')
  const [tab, setTab] = useState<LocalChargeTab>('tabelas')
  const [cargoModeFilter, setCargoModeFilter] = useState<CargoModeFilter>('')
  const [podFilter, setPodFilter] = useState('')
  const activeTab: LocalChargeTab =
    tab === 'tabelas' && canManageTables ? 'tabelas' : canManageOverrides ? 'overrides' : 'tabelas'

  return (
    <>
      <PageHeader
        title="Taxas Locais"
        description="Motor de cálculo por POD/modo de carga, overrides por cliente e pendências de revisão."
      />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {canManageTables ? <TabButton active={activeTab === 'tabelas'} label="Tabelas" onClick={() => setTab('tabelas')} /> : null}
        {canManageOverrides ? <TabButton active={activeTab === 'overrides'} label="Overrides" onClick={() => setTab('overrides')} /> : null}
      </div>

      {activeTab === 'tabelas' && canManageTables ? (
        <ChargeTablesTab
          cargoModeFilter={cargoModeFilter}
          setCargoModeFilter={setCargoModeFilter}
          podFilter={podFilter}
          setPodFilter={setPodFilter}
        />
      ) : null}

      {activeTab === 'overrides' && canManageOverrides ? (
        <ChargeOverridesTab
          cargoModeFilter={cargoModeFilter}
          setCargoModeFilter={setCargoModeFilter}
          podFilter={podFilter}
          setPodFilter={setPodFilter}
        />
      ) : null}
    </>
  )
}
