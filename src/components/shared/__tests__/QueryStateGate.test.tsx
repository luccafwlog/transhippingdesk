// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryStateGate } from '../QueryStateGate'

afterEach(cleanup)

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new window.Event(value ? 'online' : 'offline'))
}

describe('QueryStateGate', () => {
  it('offline sem cache mostra indisponibilidade, nunca lista vazia falsa', () => {
    setOnline(false)
    try {
      render(
        <QueryStateGate isLoading={false} isError={false} isPaused hasData={false}>
          <div>Nenhum registro encontrado.</div>
        </QueryStateGate>,
      )

      expect(screen.getByText(/Sem conexão no momento/)).toBeTruthy()
      expect(screen.queryByText('Nenhum registro encontrado.')).toBeNull()
    } finally {
      setOnline(true)
    }
  })

  it('offline com cache conserva os dados com indicação', () => {
    setOnline(false)
    try {
      render(
        <QueryStateGate isLoading={false} isError={false} isPaused hasData>
          <div>Linha em cache</div>
        </QueryStateGate>,
      )

      expect(screen.getByText('Linha em cache')).toBeTruthy()
      expect(screen.getByText(/Exibindo dados salvos/)).toBeTruthy()
    } finally {
      setOnline(true)
    }
  })

  it('reconnect retoma a leitura sem o banner offline', () => {
    setOnline(false)
    const { rerender } = render(
      <QueryStateGate isLoading={false} isError={false} isPaused hasData>
        <div>Linha em cache</div>
      </QueryStateGate>,
    )
    expect(screen.getByText(/Exibindo dados salvos/)).toBeTruthy()

    // Reconnect: a query volta a buscar e o banner sai de cena.
    setOnline(true)
    try {
      rerender(
        <QueryStateGate isLoading={false} isError={false} isPaused={false} hasData>
          <div>Linha em cache</div>
        </QueryStateGate>,
      )
      expect(screen.queryByText(/Exibindo dados salvos/)).toBeNull()
      expect(screen.getByText('Linha em cache')).toBeTruthy()
    } finally {
      setOnline(true)
    }
  })

  it('erro online mostra falha com retry, não vazio', () => {
    const onRetry = vi.fn()
    render(
      <QueryStateGate isLoading={false} isError hasData={false} onRetry={onRetry}>
        <div>Nenhum registro encontrado.</div>
      </QueryStateGate>,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Nenhum registro encontrado.')).toBeNull()
    fireEvent.click(screen.getByText('Tentar novamente'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
