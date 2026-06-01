// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Boxes } from 'lucide-react'
import {
  AccordionSection,
  Info,
  MetricPanel,
  MetricSection,
  NavigationCard,
} from '../VoyageSectionCards'

afterEach(cleanup)

describe('NavigationCard', () => {
  it('mostra título, no máximo 3 métricas, e dispara onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <NavigationCard icon={Boxes} title="Container" metrics={['a', 'b', 'c', 'd']} onClick={onClick} />,
    )
    expect(screen.getByText('Container')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('c')).toBeTruthy()
    expect(screen.queryByText('d')).toBeNull() // só as 3 primeiras
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('quando desabilitado mostra "Sem dados" e não dispara onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<NavigationCard icon={Boxes} title="Vazio" metrics={[]} disabled onClick={onClick} />)
    expect(screen.getByText('Sem dados')).toBeTruthy()
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('AccordionSection', () => {
  it('renderiza filhos só quando aberto e reflete aria-expanded', () => {
    const { rerender } = render(
      <AccordionSection title="Importação" description="desc" open={false} onToggle={() => {}}>
        <div>conteúdo</div>
      </AccordionSection>,
    )
    expect(screen.queryByText('conteúdo')).toBeNull()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')

    rerender(
      <AccordionSection title="Importação" description="desc" open onToggle={() => {}}>
        <div>conteúdo</div>
      </AccordionSection>,
    )
    expect(screen.getByText('conteúdo')).toBeTruthy()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })

  it('dispara onToggle ao clicar', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <AccordionSection title="T" description="d" open={false} onToggle={onToggle}>
        <div />
      </AccordionSection>,
    )
    await user.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('Info', () => {
  it('mostra valor simples', () => {
    render(<Info label="B/Ls" value="42" />)
    expect(screen.getByText('B/Ls')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('renderiza tokens quando o valor tem múltiplos itens separados por " | "', () => {
    render(<Info label="Tipos" value="40HC: 2 | 20GP: 1" />)
    expect(screen.getByText('40HC: 2')).toBeTruthy()
    expect(screen.getByText('20GP: 1')).toBeTruthy()
  })
})

describe('MetricPanel / MetricSection', () => {
  it('MetricPanel mostra título e filhos', () => {
    render(
      <MetricPanel title="Container">
        <Info label="x" value="1" />
      </MetricPanel>,
    )
    expect(screen.getByText('Container')).toBeTruthy()
    expect(screen.getByText('x')).toBeTruthy()
  })

  it('MetricSection mostra título, descrição, ações e filhos', () => {
    render(
      <MetricSection title="Exportação" description="resumo" actions={<button>Editar</button>}>
        <div>corpo</div>
      </MetricSection>,
    )
    expect(screen.getByText('Exportação')).toBeTruthy()
    expect(screen.getByText('resumo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy()
    expect(screen.getByText('corpo')).toBeTruthy()
  })
})
