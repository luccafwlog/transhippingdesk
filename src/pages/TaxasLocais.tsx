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

  return (
    <>
      <PageHeader
        title="Taxas Locais"
        description="Motor de calculo por POD/cargo mode, overrides por cliente e pendencias de revisao."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {canManageTables ? <TabButton active={tab === 'tabelas'} label="Tabelas" onClick={() => setTab('tabelas')} /> : null}
        {canManageOverrides ? <TabButton active={tab === 'overrides'} label="Overrides" onClick={() => setTab('overrides')} /> : null}
      </div>

      {tab === 'tabelas' && canManageTables ? (
        <ChargeTablesTab
          cargoModeFilter={cargoModeFilter}
          setCargoModeFilter={setCargoModeFilter}
          podFilter={podFilter}
          setPodFilter={setPodFilter}
        />
      ) : null}

      {tab === 'overrides' && canManageOverrides ? (
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
