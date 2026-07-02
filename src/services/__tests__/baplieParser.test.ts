import { describe, expect, it } from 'vitest'
import { parseBaplieFile } from '../baplieParser'

function baplieFile(text: string) {
  return new File([text], 'baplie.edi', { type: 'text/plain' })
}

describe('baplieParser', () => {
  it('deduplica containers repetidos no EDI preservando atributos fisicos', async () => {
    const parsed = await parseBaplieFile(baplieFile([
      "UNB+UNOA:2+X+Y+260701:1200+1'",
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+UETU7016802+45G1+++5'",
      "LOC+147+010102'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+UETU7016802+45G1+++5'",
      "DGS+IMD+9+3166'",
      "UNT+10+1'",
    ].join('\n')))

    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0]).toMatchObject({
      container_number: 'UETU7016802',
      is_imo: true,
      imo_class: '9',
      un_number: '3166',
      slot: '010102',
    })
  })
})
