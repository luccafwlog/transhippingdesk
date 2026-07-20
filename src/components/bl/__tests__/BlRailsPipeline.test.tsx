// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { BlRailsPipeline } from '../BlRailsPipeline'

const stage = (key: string, label: string, state: 'done' | 'pending', detail = 'x') => ({ key, label, state, detail })

describe('BlRailsPipeline', () => {
  it('mostra os dois trilhos e a proxima acao', () => {
    render(<MemoryRouter><BlRailsPipeline operational={[stage('pol', 'Saída do POL', 'done'), stage('pod', 'Chegada ao POD', 'pending')]} financial={[stage('ce', 'CE Mercante', 'pending', 'Cadastrar CE')]} nextAction={{ key: 'ce', label: 'CE Mercante', detail: 'Cadastrar CE', state: 'pending', href: '/manifestos/BL1?tab=detalhes' }} /></MemoryRouter>)
    expect(screen.getByText('Operacional')).toBeTruthy()
    expect(screen.getByText('Financeiro')).toBeTruthy()
    expect(screen.getByText(/Próxima ação/i)).toBeTruthy()
    expect(screen.getAllByText('Cadastrar CE').length).toBe(2)
  })
})
