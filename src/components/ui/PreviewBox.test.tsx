// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PreviewBox } from './PreviewBox'

afterEach(cleanup)

describe('PreviewBox', () => {
  it('formats numeric values, preserves strings, and honors fixed decimals', () => {
    const { rerender } = render(<PreviewBox label="Quantidade" value={1234} />)
    expect(screen.getByText('1.234')).toBeTruthy()

    rerender(<PreviewBox label="Viagem" value="COSCO 123" />)
    expect(screen.getByText('COSCO 123')).toBeTruthy()

    rerender(<PreviewBox label="Peso" value={12.5} decimals={3} />)
    expect(screen.getByText('12,500')).toBeTruthy()
  })
})
