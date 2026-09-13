// @vitest-environment jsdom
import { type ReactNode } from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { VisualThemeProvider } from '../useVisualTheme'

function Wrapper({ children }: { children: ReactNode }) {
  return <VisualThemeProvider>{children}</VisualThemeProvider>
}

describe('VisualThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-visual-theme')
  })

  it('migra a preferência salva antes da renomeação para a chave Vela', async () => {
    window.localStorage.setItem('transhipping_visual_theme', 'dark')

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    )

    await waitFor(() => expect(document.documentElement.getAttribute('data-visual-theme')).toBe('dark'))
    expect(window.localStorage.getItem('vela_visual_theme')).toBe('dark')
  })
})
