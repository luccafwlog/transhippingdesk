// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { PaymentModal } from '../PaymentModal'

it('submits the current payment date for the selected invoice', async () => {
  const onSubmit = vi.fn()
  const user = userEvent.setup()

  render(
    <PaymentModal
      open
      paymentId={42}
      paymentDate="2026-07-19"
      onPaymentDateChange={vi.fn()}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Confirmar' }))

  expect(onSubmit).toHaveBeenCalledWith(42, '2026-07-19')
})
