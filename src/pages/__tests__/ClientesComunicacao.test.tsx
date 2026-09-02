// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientesComunicacao } from '../ClientesComunicacao'

const mockSetCommunicationsMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
}

const mockDispatchMutation = {
  mutateAsync: vi.fn(),
  isPending: false,
}

const mockCoverage = [
  {
    voyageId: 101,
    vesselName: 'MSC ALTAIR',
    voyageNumber: '2401E',
    customers: 3,
    noa: { sent: 3, total: 3 },
    nor: { sent: 2, total: 3 },
    nob: { sent: 1, total: 2 },
    finance: { sent: 2, ready: 3, total: 3, pending: 0 },
  },
]
const blockedCustomerRow = {
  key: 'aviso_chegada_noa:2',
  customerId: 2,
  customerName: 'Cliente Bloqueado S/A',
  customerCnpj: '22.222.222/0001-22',
  terminalId: null,
  terminalName: null,
  bls: [{ id: 'BL-99', customerId: 2 }],
  sourceBls: [{ id: 'BL-99', customerId: 2 }],
  eligibleRecipients: [],
  excludedRecipients: [{ contact: { id: 2, name: 'João', email: 'j@ex.com' }, reason: 'preferencia_desligada' as const }],
  blocked: true,
  selected: false,
  nextAttemptDiscriminator: 0,
  renderInput: {
    customerId: 2,
    customerName: 'Cliente Bloqueado S/A',
    vesselName: 'MSC ALTAIR',
    voyageNumber: '2401E',
    port: 'Santos',
    milestoneAt: '2026-09-10T12:00:00Z',
    bls: [{ id: 'BL-99', customerId: 2 }],
  },
}

const acmeRow = {
  key: 'aviso_chegada_noa:1',
  customerId: 1,
  customerName: 'ACME Importadora',
  customerCnpj: '11.111.111/0001-11',
  terminalId: null,
  terminalName: null,
  bls: [{ id: 'BL-01', customerId: 1 }],
  sourceBls: [{ id: 'BL-01', customerId: 1 }],
  eligibleRecipients: [
    { id: 10, email: 'contato@acme.com', name: 'Contato ACME' },
    { id: 11, email: 'financeiro@acme.com', name: 'Financeiro ACME' },
  ],
  excludedRecipients: [],
  blocked: false,
  selected: true,
  nextAttemptDiscriminator: 1, // Já enviado antes!
  renderInput: {
    customerId: 1,
    customerName: 'ACME Importadora',
    vesselName: 'MSC ALTAIR',
    voyageNumber: '2401E',
    port: 'Santos',
    milestoneAt: '2026-09-10T12:00:00Z',
    bls: [{ id: 'BL-01', customerId: 1 }],
  },
}

const mockConference = {
  kind: 'aviso_chegada_noa',
  nature: 'avisos_operacionais',
  mode: 'carga',
  totalCustomers: 2,
  totalEligibleEmails: 3,
  totalExcludedEmails: 1,
  excludedReasonCounts: {
    preferencia_desligada: 1,
    email_ausente: 0,
    suprimido_complaint: 0,
    suprimido_bounce: 0,
  },
  blockedCustomers: [blockedCustomerRow],
  rows: [acmeRow, blockedCustomerRow],
}

const mockHistory = [
  {
    id: 501,
    kind: 'aviso_chegada_noa',
    status: 'simulado',
    customer_id: 1,
    customer: { name: 'ACME Importadora', cnpj_cpf: '11111111000111' },
    vessel_name: 'MSC ALTAIR',
    voyage_number: '2401E',
    anchor_port: 'Santos',
    terminal_name: null,
    created_at: '2026-09-01T10:00:00Z',
    attempt_discriminator: 0,
    origin: 'manual',
    bl_links: [],
    attempts: [],
    attachments: [],
  },
]

let mockAppSettings = { communications_enabled: false }

vi.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: mockAppSettings }),
  useSetCommunicationsEnabled: () => mockSetCommunicationsMutation,
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    effectiveRole: 'administrativo',
    isAdmin: true,
    can: () => true,
  }),
}))

vi.mock('../../hooks/useCustomerCommunications', () => ({
  useCustomerCommunicationConference: () => ({
    data: mockConference,
    isFetching: false,
    isError: false,
  }),
  useCustomerCommunicationHistory: () => ({
    data: mockHistory,
    isLoading: false,
    isError: false,
  }),
  useCustomerCommunicationSavedTemplates: () => ({
    data: [],
    isLoading: false,
  }),
  useSaveCustomerCommunicationSavedTemplate: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDispatchCustomerCommunication: () => mockDispatchMutation,
  useVoyageCommunicationCoverage: () => ({
    data: mockCoverage,
    isLoading: false,
    isError: false,
  }),
}))

describe('Página ClientesComunicacao (UI e fluxos)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppSettings = { communications_enabled: false }
  })

  it('exibe o banner permanente de simulação quando communications_enabled é false', () => {
    mockAppSettings = { communications_enabled: false }
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Modo de simulação permanente')).toBeTruthy()
    expect(screen.getByText(/A chave global está desligada/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ativar envio real' })).toBeTruthy()
  })

  it('exibe o banner de canal ativo quando communications_enabled é true', () => {
    mockAppSettings = { communications_enabled: true }
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Canal de envio real ativo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desativar envio real' })).toBeTruthy()
  })

  it('renderiza o painel de cobertura na aba padrão com viagens e contadores', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=cobertura']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Painel de cobertura')).toBeTruthy()
    expect(screen.getByText('MSC ALTAIR · 2401E')).toBeTruthy()
    expect(screen.getByText('3/3')).toBeTruthy() // NOA 3/3
    expect(screen.getByText('2/3')).toBeTruthy() // NOR 2/3
  })

  it('na aba de disparo, valida filtros e exibe a conferência de destinatários com aviso de reenvio', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Critérios do disparo')).toBeTruthy()
    expect(screen.getByText('NOA · Aviso de Chegada')).toBeTruthy()

    const conferirBtn = screen.getByRole('button', { name: /Conferir destinatários/i })
    fireEvent.click(conferirBtn)

    // Detalhes da conferência renderizada
    expect(screen.getByText('Painel de conferência')).toBeTruthy()
    expect(screen.getByText('ACME Importadora')).toBeTruthy()
    expect(screen.getByText(/contato@acme.com/i)).toBeTruthy()

    // Cliente bloqueado por preferência desligada
    expect(screen.getByText('Cliente Bloqueado S/A')).toBeTruthy()
    expect(screen.getByText('Bloqueado')).toBeTruthy()

    // Alerta de reenvio com discriminador > 0
    expect(screen.getByText('Reenvio 1')).toBeTruthy()
    expect(screen.getByText(/Confirmo o reenvio dos clientes que já possuem um disparo/i)).toBeTruthy()
  })

  it('abre o modal de pré-visualização do comunicado com a identidade visual e o assunto correto', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=disparo']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    const previewBtn = screen.getByRole('button', { name: 'Visualizar prévia do e-mail' })
    fireEvent.click(previewBtn)

    expect(screen.getByText(/Pré-visualização do Comunicado/i)).toBeTruthy()
    expect(screen.getByText(/Destinatário:/i)).toBeTruthy()
    expect(screen.getByText(/Assunto:/i)).toBeTruthy()
  })

  it('renderiza o histórico de disparos na aba historico', () => {
    render(
      <MemoryRouter initialEntries={['/clientes/comunicacao?tab=historico']}>
        <ClientesComunicacao />
      </MemoryRouter>,
    )

    expect(screen.getByText('Histórico de Comunicados')).toBeTruthy()
    expect(screen.getByText('ACME Importadora')).toBeTruthy()
    expect(screen.getAllByText('Simulado').length).toBeGreaterThanOrEqual(1)
  })
})
