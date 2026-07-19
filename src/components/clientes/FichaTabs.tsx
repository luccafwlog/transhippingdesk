import { FICHA_TABS, type FichaTabId } from './fichaTabConfig'
export function FichaTabBar({ active, onSelect }: { active: FichaTabId; onSelect: (tab: FichaTabId) => void }) {
  return <div className="mb-5 flex flex-wrap gap-2" role="tablist">{FICHA_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} onClick={() => onSelect(tab.id)} className={active === tab.id ? 'rounded-lg bg-[#1f6feb] px-3 py-1.5 text-sm font-semibold text-white' : 'rounded-lg border border-[#30363d] px-3 py-1.5 text-sm text-slate-300 hover:bg-[#161b22]'}>{tab.label}</button>)}</div>
}
