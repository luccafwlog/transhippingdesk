// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it } from 'vitest'
import { VaziosRedirect } from '../VaziosRedirect'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

it('preserves voyage context while redirecting the legacy Vazios route', async () => {
  render(
    <MemoryRouter initialEntries={['/vazios?voyage=77']}>
      <Routes>
        <Route path="/vazios" element={<VaziosRedirect />} />
        <Route path="/embarquevazios" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )

  expect(screen.getByTestId('location').textContent).toBe('/embarquevazios?voyage=77')
})
