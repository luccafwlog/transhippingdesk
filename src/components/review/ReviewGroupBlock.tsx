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
  needsCustomerLink,
  needsWeightFix,
  type ReviewGroup,
} from '../../pages/revisaoHelpers'
import { ReviewCustomerOnboarding, type ReviewCustomerOnboardingInput } from './ReviewCustomerOnboarding'
import { ReviewDocumentEvidence } from './ReviewDocumentEvidence'

export function ReviewGroupBlock({
  group,
  collapsed,
  savingGroup,
  savingInlineId,
  onToggle,
  onGroupLink,
  onGroupAddEmail,
  onGroupOnboard,
  onCorrect,
  onInlineField,
}: {
  group: ReviewGroup
  collapsed: boolean
  savingGroup: boolean
  savingInlineId: string | null
  onToggle: () => void
  onGroupLink: (customerId: number) => void
  onGroupAddEmail: (email: string) => void
  onGroupOnboard: (input: ReviewCustomerOnboardingInput) => void
  onCorrect: (id: string) => void
  onInlineField: (item: ReviewQueueItem, field: 'ce_mercante' | 'bb_weight_ton', value: string) => void
}) {
  const [emailDraft, setEmailDraft] = useState('')
  const unlinkedCount = group.items.filter(needsCustomerLink).length
  const hasLinkedCustomer = getGroupLinkedItem(group) != null
  const needsEmail = groupNeedsEmail(group)
  const blItems = group.items.filter((item) => item.source === 'bl')
  const linked = getGroupLinkedItem(group)
  const showOnboarding = blItems.length > 0 && group.identityKind !== 'conflict' && (unlinkedCount > 0 || needsEmail)
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
        {group.identityKind === 'conflict' ? <Badge tone="yellow">CNPJ conflitante</Badge> : null}
        {group.identityKind === 'name' ? <Badge tone="yellow">CNPJ pendente</Badge> : null}
        {hasLinkedCustomer && unlinkedCount === 0 ? <Badge tone="blue">Cliente vinculado</Badge> : null}
        {hasLinkedCustomer && needsEmail ? <Badge tone="yellow">E-mail pendente</Badge> : null}
        <Badge tone="slate">{formatResultCount(group.items.length, 'B/L', 'B/Ls')}</Badge>
        <div className="flex flex-wrap gap-1.5">
          {groupReasons.slice(0, 4).map((reason) => (
            <Badge key={reason} tone="yellow">
              {reason}
            </Badge>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {unlinkedCount > 0 && blItems.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Vincular cliente a {unlinkedCount}:</span>
              <InlineCustomerPicker saving={savingGroup} onSelect={onGroupLink} />
            </div>
          ) : null}
          {hasLinkedCustomer && needsEmail && blItems.length === 0 ? (
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
        </div>
      </div>

      {!collapsed ? (
        <div className="grid gap-3 p-3">
          {group.identityKind === 'conflict' || (group.identityKind === 'name' && blItems.length > 0) ? <ReviewDocumentEvidence group={group} /> : null}
          {showOnboarding ? (
            <ReviewCustomerOnboarding
              group={group}
              existingCustomerId={linked?.customer?.id ?? null}
              existingCustomer={linked?.customer ?? null}
              initialName={linked?.customer?.name ?? group.displayName}
              initialCnpj={linked?.customer?.cnpj_cpf ?? group.cnpj ?? ''}
              initialEmail={linked?.customer?.customer_contacts?.find((contact) => contact.email?.trim())?.email ?? blItems.find((item) => item.manifest_customer_email)?.manifest_customer_email ?? ''}
              saving={savingGroup}
              onSelectExistingCustomer={() => undefined}
              onSubmit={onGroupOnboard}
            />
          ) : null}
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
                      {item.source === 'granite' && item.suggested_customer?.name ? (
                        <div className="text-xs text-yellow-200">
                          Sugerido: <strong>{item.suggested_customer.name}</strong> — confirme em Corrigir
                        </div>
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
        </div>
      ) : null}
    </div>
  )
}
