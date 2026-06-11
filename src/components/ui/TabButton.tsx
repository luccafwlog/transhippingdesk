// Botão de aba reutilizável. Antes duplicado identicamente em Faturamento,
// TaxasLocais e Relatorios — unificado aqui para consistência.
export function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`app-tab ${active ? 'app-tab--active' : ''}`}
      onClick={onClick}
      type="button"
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  )
}
