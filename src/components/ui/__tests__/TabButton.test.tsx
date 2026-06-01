// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabButton } from '../TabButton'

afterEach(cleanup)

describe('TabButton', () => {
  it('renderiza o rótulo e dispara onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<TabButton active={false} label="Faturas" onClick={onClick} />)
    const btn = screen.getByRole('button', { name: 'Faturas' })
    expect(btn.className).not.toContain('app-tab--active')
    await user.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('aplica a classe ativa quando active=true', () => {
    render(<TabButton active label="Demurrage" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Demurrage' }).className).toContain('app-tab--active')
  })
})
