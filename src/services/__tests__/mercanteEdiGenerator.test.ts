import { describe, expect, it } from 'vitest'
import {
  blToMercanteBlData,
  buildManifestData,
  generateM5Record,
  generateC5Record,
  generateI5Record,
  generateEdiMercante,
  toIsoContainerType,
  normalizeMercanteLocode,
  type MercanteBlData,
  type MercanteManifestData,
} from '../mercanteEdiGenerator'

// Reference B/L reconstructed from the real GREEN SANTOS 14 manifest
// (CSC45250E00N00 / FLOPAM), validated field-by-field against the
// FWL_MERCANTE_561416 file accepted by Mercante.
const FLOPAM_BL: MercanteBlData = {
  blNumber: 'CSC45250E00N00',
  consigneeCnpjCpf: '13.661.609/0001-53',
  consigneeName: 'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
  consigneeBlock: [
    'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA',
    'CNPJ:13.661.609/0001-53',
    'VIA DO MAR S/N - BA 530',
    'POLO PETROQUIMICO',
    'CEP 42.816-280 - CAMACARI - BAHIA - BRASIL',
    'JULIAN',
    'JMALULI@SNFBRASIL.COM',
  ].join('\n'),
  consigneeAddress: '',
  consigneePhone: 'PHONE: 71-35997719',
  shipperName: 'SNF (CHINA) FLOCCULANT CO., LTD',
  shipperBlock: [
    'SNF (CHINA) FLOCCULANT CO., LTD',
    'NO.6, NORTH BINJIANG ROAD,',
    'TAIXING ECONOMIC DEVELOPMENT ZONE,',
    'TAIXING, 225442, JIANGSU PROVINCE, CHINA',
    'TEL: 0086-523-80736300',
    'FAX: 0086-523-80735423',
  ].join('\n'),
  notifyCnpjCpf: '13.932.974/0001-55',
  notifyBlock: [
    'TRADICIONAL COMERCIO EXTERIOR EIRELI',
    'VIA CENTRO, 1O PAVIMENTO , CIA, 3644, CIA SUL,',
    'SIMOES FILHO, BAHIA, BRASIL, CEP: 43.700-000',
    'CNPJ:13.932.974/0001-55',
    'ATENDIMENTOIMP3@JOSERUBEM.COM.BR',
  ].join('\n'),
  notify2Block:
    'VIABILIDADE SERVICOS DE COMERCIO EXTERIOR LTDA CNPJ: 28.176.854/0001-42 RUA JOSE ROBERTO OTTONI, 864. VALERIA, SALVADOR-BA, CEP: 41.301.325 MARISA REIS-MARISA@VBLD.COM.BR-(+55)7198679-9400',
  cargoDescription:
    'FLOCRYL DADMAC 64 HST NET WEIGHT:71780KGS NCM:2923 WOODEN PACKAGE:NOT APPLICABLE(NOT USED) 21 DAYS FREE TIME',
  totalPackages: 3,
  packagesUnit: 'FLEXITANK',
  totalWeightKg: 72110,
  totalCbm: 78,
  polLocode: 'CNTAC',
  podLocode: 'BRSSA',
  countryOfOrigin: 'CN',
  destinationUf: 'BA',
  terminalCode: 'BRSSA002',
  paymentType: '',
  freightLines: [],
  containers: [
    {
      containerNumber: 'LYGU0131106',
      sealNumber: '140514',
      containerType: '20GP',
      tareWeightKg: 2100,
      grossWeightKg: 24050,
      totalCbm: 26,
      ncmCodes: ['2923'],
      isImo: false,
      imoClass: '',
      unNumber: '',
    },
  ],
}

const MANIFEST: MercanteManifestData = {
  shippingCompanyCode: 'CN001321',
  agencyCnpj: '06352972000121',
  voyageNumber: '14',
  vesselImo: '9996018',
  polLocode: 'CNTAC',
  podLocode: 'BRSSA',
  terminalCode: 'BRSSA002',
  emissionDate: '2026-04-25',
  operationDate: '2026-06-02',
  closingDate: '2026-04-25',
  bls: [FLOPAM_BL],
}

describe('helpers', () => {
  it('corrects the TAICANG locode to CNTAG', () => {
    expect(normalizeMercanteLocode('CNTAC')).toBe('CNTAG')
    expect(normalizeMercanteLocode('BRSSA')).toBe('BRSSA')
  })

  it('maps carrier container types to ISO 6346 codes', () => {
    expect(toIsoContainerType('20GP')).toBe('22G1')
    expect(toIsoContainerType('40HC')).toBe('45G1')
    expect(toIsoContainerType('22G1')).toBe('22G1') // already ISO -> pass through
  })
})

describe('generateM5Record (FWL parity)', () => {
  const m5 = generateM5Record(MANIFEST)

  it('has the fixed length', () => expect(m5.length).toBe(164))
  it('encerramento/descarga dates', () => {
    expect(m5.substring(38, 46)).toBe('20260425')
    expect(m5.substring(46, 54)).toBe('20260602')
  })
  it('POL is corrected to CNTAG and POD kept', () => {
    expect(m5.substring(54, 59)).toBe('CNTAG')
    expect(m5.substring(59, 64)).toBe('BRSSA')
  })
  it('voyage and vessel IMO are populated', () => {
    expect(m5.substring(64, 74)).toBe('14        ')
    expect(m5.substring(74, 84)).toBe('9996018   ')
  })
  it('terminal sits in the tail field (pos 124)', () => {
    expect(m5.substring(84, 124)).toBe(' '.repeat(40))
    expect(m5.substring(124, 132)).toBe('BRSSA002')
  })
})

describe('generateC5Record (FWL parity)', () => {
  const c5 = generateC5Record(FLOPAM_BL, '2026-04-25')

  it('has the fixed length', () => expect(c5.length).toBe(4104))

  it('B/L number, container count and flags', () => {
    expect(c5.substring(2, 6)).toBe('0001')
    expect(c5.substring(6, 24)).toBe('CSC45250E00N00    ')
    expect(c5.substring(24, 26)).toBe('NN')
    expect(c5.substring(28, 29)).toBe('N')
  })

  it('consignee block: /,- stripped, ** terminator', () => {
    expect(c5.substring(29, 196)).toBe(
      'FLOPAM DO BRASIL INDUSTRIA QUIMICA LTDA CNPJ:13.661.609000153 VIA DO MAR SN BA 530 POLO PETROQUIMICO CEP 42.816280 CAMACARI BAHIA BRASIL JULIAN JMALULI@SNFBRASIL.COM**',
    )
    expect(c5.substring(367, 381)).toBe('13661609000153')
  })

  it('shipper block: /,- stripped from contacts', () => {
    expect(c5.substring(381, 557)).toBe(
      'SNF (CHINA) FLOCCULANT CO., LTD NO.6, NORTH BINJIANG ROAD, TAIXING ECONOMIC DEVELOPMENT ZONE, TAIXING, 225442, JIANGSU PROVINCE, CHINA TEL: 008652380736300 FAX: 008652380735423',
    )
  })

  it('emission date + assembled description with notify2 and total', () => {
    expect(c5.substring(634, 992)).toBe(
      '20260425FLOCRYL DADMAC 64 HST NET WEIGHT:71780KGS NCM:2923 WOODEN PACKAGE:NOT APPLICABLE(NOT USED) 21 DAYS FREE TIME **PHONE: 71-35997719 ALSO NOTIFY:VIABILIDADE SERVICOS DE COMERCIO EXTERIOR LTDA CNPJ: 28.176.854/0001-42 RUA JOSE ROBERTO OTTONI, 864. VALERIA, SALVADOR-BA, CEP: 41.301.325 MARISA REIS-MARISA@VBLD.COM.BR-(+55)7198679-9400 TOTAL: 3 FLEXITANKS',
    )
  })

  it('cube, route and notify party', () => {
    expect(c5.substring(1401, 1414)).toBe('0000000078000')
    expect(c5.substring(1414, 1419)).toBe('CNTAG')
    expect(c5.substring(1419, 1424)).toBe('BRSSA')
    expect(c5.substring(1424, 1438)).toBe('13932974000155')
    expect(c5.substring(1438, 1620)).toBe(
      'TRADICIONAL COMERCIO EXTERIOR EIRELI VIA CENTRO, 1O PAVIMENTO , CIA, 3644, CIA SUL, SIMOES FILHO, BAHIA, BRASIL, CEP: 43.700000 CNPJ:13.932.974000155 ATENDIMENTOIMP3@JOSERUBEM.COM.BR',
    )
  })

  it('constant terminal/UF/flag tail block', () => {
    expect(c5.substring(1739, 1760)).toBe('000000000000000000000')
    expect(c5.substring(1760, 1799)).toBe('0000220PHHIBABRSSA002CNN000000000000000')
  })

  it('writes ocean freight and despesas for CSC45250E02Y00', () => {
    const bl = {
      ...FLOPAM_BL,
      blNumber: 'CSC45250E02Y00',
      oceanFreightValueCents: 260000,
      freightLines: [
        { code: '01779', valueCents: 171700, type: 'C' },
        { code: '00322', valueCents: 17200, type: 'P' },
      ],
    }
    const freightC5 = generateC5Record(bl, '2026-04-25')

    expect(freightC5.substring(1739, 1760)).toBe('000000000000000260000')
    expect(freightC5.substring(1760, 1771)).toBe('0000220PHHI')
    expect(freightC5.substring(3796, 3836)).toBe('0177900000000171700C0032200000000017200P')
  })
})

describe('generateI5Record (FWL parity)', () => {
  const i5 = generateI5Record(FLOPAM_BL.containers[0], 1)

  it('has the fixed length', () => expect(i5.length).toBe(5000))

  it('header: gross weight, ISO type, container, tare', () => {
    expect(i5.substring(0, 43)).toBe('I51000100002405000022G1LYGU0131106002100000')
  })

  it('cube + seal at pos 458', () => {
    expect(i5.substring(458, 477)).toBe('0000000026000140514')
  })

  it('NCM at pos 531', () => {
    expect(i5.substring(531, 535)).toBe('2923')
  })

  it('preserves alphanumeric seal values (no digit stripping)', () => {
    const alpha = generateI5Record({ ...FLOPAM_BL.containers[0], sealNumber: 'SEL123' }, 1)
    expect(alpha.substring(471, 477)).toBe('SEL123')
  })

  it('places multiple NCM codes on an 8-char stride', () => {
    const multi = generateI5Record(
      { ...FLOPAM_BL.containers[0], ncmCodes: ['2923', '8708'] },
      1,
    )
    expect(multi.substring(531, 535)).toBe('2923')
    expect(multi.substring(539, 543)).toBe('8708')
  })
})

describe('generateEdiMercante', () => {
  it('emits M5 + C5 + I5 with CRLF separators', () => {
    const lines = generateEdiMercante(MANIFEST).split('\r\n')
    expect(lines.length).toBe(3)
    expect(lines[0].startsWith('M5')).toBe(true)
    expect(lines[1].startsWith('C5')).toBe(true)
    expect(lines[2].startsWith('I5')).toBe(true)
    expect(lines.every((l) => l.length === 164 || l.length === 4104 || l.length === 5000)).toBe(true)
  })

  it('uses the emission date (not the discharge date) on the C5', () => {
    // operationDate is 2026-06-02 (discharge); the C5 emission field must stay
    // the emission date 2026-04-25.
    const c5 = generateEdiMercante(MANIFEST).split('\r\n')[1]
    expect(c5.substring(634, 642)).toBe('20260425')
  })

  it('prefers the B/L emission date when available', () => {
    const c5 = generateEdiMercante({
      ...MANIFEST,
      emissionDate: '2026-04-25',
      bls: [{ ...FLOPAM_BL, emissionDate: '2026-04-26' }],
    }).split('\r\n')[1]

    expect(c5.substring(634, 642)).toBe('20260426')
  })

  it('emits one I5 per container', () => {
    const edi = generateEdiMercante({
      ...MANIFEST,
      bls: [
        {
          ...FLOPAM_BL,
          containers: [
            FLOPAM_BL.containers[0],
            { ...FLOPAM_BL.containers[0], containerNumber: 'FTAU1747156', sealNumber: '140058' },
          ],
        },
      ],
    })
    const lines = edi.split('\r\n')
    expect(lines.length).toBe(4)
    expect(lines[1].substring(2, 6)).toBe('0002')
    expect(lines[2].includes('LYGU0131106')).toBe(true)
    expect(lines[3].includes('FTAU1747156')).toBe(true)
  })
})

describe('buildManifestData', () => {
  it('maps imported BL freight rows to ocean freight and Mercante despesas', () => {
    const bl = blToMercanteBlData(
      {
        id: 'CSC45250E02Y00',
        manifest_customer_cnpj_cpf: null,
        manifest_customer_name: null,
        consignee: null,
        consignee_block: '',
        consignee_address: '',
        consignee_phone: '',
        shipper: null,
        shipper_block: '',
        notify_cnpj_cpf: '',
        notify_block: '',
        notify_party: null,
        notify2_block: '',
        cargo_description: '',
        total_packages: 0,
        packages_unit: '',
        total_weight_kg: 0,
        total_cbm: 0,
        pol: 'CNTAC',
        pod: 'BRSSA',
        payment_type: null,
        bl_emission_date: '2026-04-26',
        bl_freight_lines: [
          { description: 'OCEAN FREIGHT', amount: 'USD 2,600.00', payment: 'PREPAID' },
          { category: 'THD', amount: 'USD 1,717.00', payment: 'COLLECT' },
          { category: 'BAF', amount: 'USD 172.00', payment: 'PREPAID' },
        ],
      } as Parameters<typeof blToMercanteBlData>[0],
      [],
    )

    expect(bl.emissionDate).toBe('2026-04-26')
    expect(bl.oceanFreightValueCents).toBe(260000)
    expect(bl.freightLines).toEqual([
      { code: '01779', valueCents: 171700, type: 'C' },
      { code: '00322', valueCents: 17200, type: 'P' },
    ])
  })

  it('uses each B/L destination to infer UF when route POD is shared', () => {
    const manifest = buildManifestData({
      shippingCompanyCode: 'CN01321',
      agencyCnpj: '06352972000121',
      terminalCode: 'BRSSA001',
      emissionDate: '2026-07-04',
      loadingDate: '2026-07-01',
      dischargeDate: '2026-07-04',
      voyage: { id: 1, voyage_number: '39', vessel_id: 1, pol_id: null, pod_id: null, etd: null, eta: null, ata: null, status: 'active', created_at: null },
      vessel: { id: 1, name: 'COSCO TEST', imo: '9846495', carrier_id: 1, created_at: null },
      polPort: { id: 1, name: 'Ningbo', locode: 'CNNGB', country: 'CN', created_at: null },
      podPort: { id: 2, name: 'Vitoria', locode: 'BRVIX', country: 'BR', created_at: null },
      bls: [
        {
          id: 'BLSSA',
          voyage_id: 1,
          batch_id: 1,
          cargo_mode: 'container',
          ce_mercante: null,
          bb_machine_qty: null,
          bb_packages_qty: null,
          bb_packages_total: null,
          bb_weight_ton: null,
          shipper: null,
          consignee: null,
          notify_party: null,
          customer_id: null,
          manifest_customer_cnpj_cpf: null,
          manifest_customer_name: null,
          manifest_customer_email: null,
          customer_reconciliation_status: null,
          customer_reconciliation_notes: null,
          billing_hold_reason: null,
          last_billing_run_id: null,
          pol: 'CNNGB',
          pod: 'Salvador',
          place_of_delivery: null,
          cargo_description: null,
          total_weight_kg: 1000,
          total_cbm: 30,
          incoterm: null,
          payment_type: null,
          financial_status: 'pending',
          review_status: 'ok',
          charge_status: 'not_calculated',
          charges_calculated_at: null,
          charges_reviewed_at: null,
          charge_exemption_reason: null,
          container_load_type: null,
          free_time_override: null,
          demurrage_rate_override_p1_usd: null,
          demurrage_rate_override_p2_usd: null,
          demurrage_roe_manual: null,
          demurrage_roe: null,
          notes: null,
          created_at: null,
          updated_at: null,
        },
      ],
      blContainers: new Map(),
    })

    expect(manifest.bls[0].destinationUf).toBe('BA')
  })

  it('uses the container CBM as the item cubage', () => {
    const ediBl = buildManifestData({
      shippingCompanyCode: 'CN01321',
      agencyCnpj: '06352972000121',
      terminalCode: 'BRSSA001',
      emissionDate: '2026-07-04',
      loadingDate: '2026-07-01',
      dischargeDate: '2026-07-04',
      voyage: { id: 1, voyage_number: '39', vessel_id: 1, pol_id: null, pod_id: null, etd: null, eta: null, ata: null, status: 'active', created_at: null },
      vessel: { id: 1, name: 'COSCO TEST', imo: '9846495', carrier_id: 1, created_at: null },
      polPort: { id: 1, name: 'Ningbo', locode: 'CNNGB', country: 'CN', created_at: null },
      podPort: { id: 2, name: 'Salvador', locode: 'BRSSA', country: 'BR', created_at: null },
      bls: [
        {
          id: 'BL001',
          voyage_id: 1,
          batch_id: 1,
          cargo_mode: 'container',
          ce_mercante: null,
          bb_machine_qty: null,
          bb_packages_qty: null,
          bb_packages_total: null,
          bb_weight_ton: null,
          shipper: null,
          consignee: null,
          notify_party: null,
          customer_id: null,
          manifest_customer_cnpj_cpf: null,
          manifest_customer_name: null,
          manifest_customer_email: null,
          customer_reconciliation_status: null,
          customer_reconciliation_notes: null,
          billing_hold_reason: null,
          last_billing_run_id: null,
          pol: 'CNNGB',
          pod: 'BRSSA',
          place_of_delivery: null,
          cargo_description: null,
          total_weight_kg: 6800,
          total_cbm: 99.9,
          incoterm: null,
          payment_type: null,
          financial_status: 'pending',
          review_status: 'ok',
          charge_status: 'not_calculated',
          charges_calculated_at: null,
          charges_reviewed_at: null,
          charge_exemption_reason: null,
          container_load_type: null,
          free_time_override: null,
          demurrage_rate_override_p1_usd: null,
          demurrage_rate_override_p2_usd: null,
          demurrage_roe_manual: null,
          demurrage_roe: null,
          notes: null,
          created_at: null,
          updated_at: null,
        },
      ],
      blContainers: new Map([
        [
          'BL001',
          [
            {
              id: 1,
              bl_id: 'BL001',
              container_number: 'CSGU6470070',
              seal_number: '03800000',
              type: '45G1',
              tare_weight_kg: 3800,
              gross_weight_kg: 6800,
              cbm: 42.5,
              is_oog: false,
              is_imo: true,
              imo_class: '9',
              un_number: '3556',
              discharge_date: null,
              return_date: null,
              demurrage_status: null,
              created_at: null,
            },
          ],
        ],
      ]),
    }).bls[0]

    expect(ediBl.containers[0].totalCbm).toBe(42.5)
  })
})
