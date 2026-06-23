// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

const modulePath = '../DemurragePaymentReversalModal'

it('requires a justification and submits the trimmed reason', async () => {
  const module = await import(/* @vite-ignore */ modulePath).catch(() => null)
  expect(module).not.toBeNull()

  const ReversalModal = module!.DemurragePaymentReversalModal
  const onSubmit = vi.fn()
  const user = userEvent.setup()
  render(
    <ReversalModal
      open
      invoiceId={42}
      loading={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  )

  const submit = screen.getByRole('button', { name: 'Cancelar baixa' })
  expect(submit.hasAttribute('disabled')).toBe(true)

  await user.type(screen.getByLabelText(/Justificativa para cancelar a baixa/), '  PIX conciliado em duplicidade  ')
  expect(submit.hasAttribute('disabled')).toBe(false)
  await user.click(submit)

  expect(onSubmit).toHaveBeenCalledWith('PIX conciliado em duplicidade')
})
