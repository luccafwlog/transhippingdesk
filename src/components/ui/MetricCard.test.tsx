// @vitest-environment jsdom
import { afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MetricCard } from './MetricCard'

afterEach(cleanup)

describe('MetricCard', () => {
  it('renders label and string value', () => {
    render(<MetricCard label="Total" value="42" />)
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('renders numeric value', () => {
    render(<MetricCard label="Count" value={99} />)
    expect(screen.getByText('99')).toBeTruthy()
  })

  it('applies app-metric-tile classes', () => {
    const { container } = render(<MetricCard label="L" value="V" />)
    expect(container.querySelector('.app-metric-tile')).toBeTruthy()
    expect(container.querySelector('.app-metric-tile__label')).toBeTruthy()
    expect(container.querySelector('.app-metric-tile__value')).toBeTruthy()
  })
})
