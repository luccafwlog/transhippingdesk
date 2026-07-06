import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { InlineCustomerPicker, InlineFieldEditor } from '../shared/ReviewInlineEditors'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { formatCnpjCpf } from '../../lib/utils'
import { formatResultCount } from '../../lib/operationalState'
import {
  getGroupLinkedItem,
  groupNeedsEmail,
  groupNeedsPortal,
  needsCeMercante,
  needsCustomerLink,
  needsWeightFix,
  type ReviewGroup,
} from '../../pages/revisaoHelpers'

export function ReviewGroupBlock({
  group,
  collapsed,
  savingGroup,
  savingInlineId,
  isAdmin,
  onToggle,
  onGroupLink,
  onGroupAddEmail,
  onGroupProvisionPortal,
  onCorrect,
  onInlineField,
}: {
  group: ReviewGroup
  collapsed: boolean
  savingGroup: boolean
  savingInlineId: string | null
  isAdmin: boolean
  onToggle: () => void
  onGroupLink: (customerId: number) => void
  onGroupAddEmail: (email: string) => void
  onGroupProvisionPortal: () => void
  onCorrect: (id: string) => void
  onInlineField: (item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', value: string) => void
}) {
  const [emailDraft, setEmailDraft] = useState('')
  const unlinkedCount = group.items.filter(needsCustomerLink).length
  const hasLinkedCustomer = getGroupLinkedItem(group) != null
  const needsEmail = groupNeedsEmail(group)
  const needsPortal = groupNeedsPortal(group)
  const groupReasons = useMemo(() => {
    const reasons = new Set<string>()
    for (const item of group.items) {
      for (const r of item.review_reasons ?? []) reasons.add(r)
    }
    return [...reasons]
  }, [group.items])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 bg-[#0d1117] px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            size={16}
            className={`text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <span className="font-semibold text-white">{group.displayName}</span>
        </button>
        {group.cnpj ? (
          <span className="text-xs text-slate-500">{formatCnpjCpf(group.cnpj)}</span>
        ) : (
          <span className="text-xs text-amber-300">sem CNPJ</span>
        )}
        <Badge tone="slate">{formatResultCount(group.items.length, 'B/L', 'B/Ls')}</Badge>
        <div className="flex flex-wrap gap-1.5">
          {groupReasons.slice(0, 4).map((reason) => (
            <Badge key={reason} tone="yellow">
              {reason}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {unlinkedCount > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Vincular cliente a {unlinkedCount}:</span>
              <InlineCustomerPicker saving={savingGroup} onSelect={onGroupLink} />
            </div>
          ) : null}
          {hasLinkedCustomer && needsEmail ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                placeholder="E-mail de faturamento"
                className="w-52 py-1 text-xs"
                disabled={savingGroup}
              />
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                loading={savingGroup}
                onClick={() => onGroupAddEmail(emailDraft)}
              >
                Salvar e-mail
              </Button>
            </div>
          ) : null}
          {hasLinkedCustomer && needsPortal ? (
            isAdmin ? (
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                loading={savingGroup}
                disabled={needsEmail}
                title={needsEmail ? 'Adicione um e-mail antes de provisionar o portal' : undefined}
                onClick={onGroupProvisionPortal}
              >
                Provisionar portal
              </Button>
            ) : (
              <span className="text-xs text-slate-500">Portal pendente (admin)</span>
            )
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[820px] text-left text-sm">
            <tbody className="divide-y divide-[#30363d]">
              {group.items.map((item) => (
                <tr key={item.id} className="hover:bg-[#21262d]/60">
                  <td className="px-4 py-3 font-semibold text-white">
                    <div className="flex items-center gap-2">
                      {item.source === 'granite' ? <Badge tone="blue">Granito</Badge> : null}
                      {item.source === 'granite' ? item.bl_number : item.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="app-table__cell-stack">
                      <div className="flex flex-wrap gap-2">
                        {(item.review_reasons?.length ? item.review_reasons : ['Pendente de revisão']).map((reason) => (
                          <Badge key={reason} tone="yellow">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                      {item.source === 'bl' && needsCeMercante(item) ? (
                        <InlineFieldEditor
                          type="text"
                          placeholder="CE Mercante"
                          initial={item.ce_mercante ?? ''}
                          saving={savingInlineId === item.id}
                          onSave={(value) => onInlineField(item, 'ce_mercante', value)}
                        />
                      ) : null}
                      {item.source === 'bl' && needsWeightFix(item) ? (
                        <div className="grid max-w-xs gap-1">
                          <span className="text-xs font-medium text-slate-400">
                            Informar peso BB para liberar cálculo
                          </span>
                          <InlineFieldEditor
                            type="number"
                            placeholder="Peso BB (ton)"
                            initial={item.bb_weight_ton != null ? String(item.bb_weight_ton) : ''}
                            saving={savingInlineId === item.id}
                            onSave={(value) => onInlineField(item, 'bb_weight_ton', value)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {item.voyage?.vessel?.name ?? '-'} / {item.voyage?.voyage_number ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => onCorrect(item.id)}>
                        Corrigir
                      </Button>
                      {item.source === 'bl' ? (
                        <Link className="app-table__action" to={`/manifestos/${item.id}`}>
                          Abrir B/L
                        </Link>
                      ) : (
                        <Link className="app-table__action" to={`/granito`}>
                          Abrir Granito
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
