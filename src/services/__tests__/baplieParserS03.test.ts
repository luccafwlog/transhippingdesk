import { describe, expect, it } from 'vitest'
import { parseBaplieBuffer, parseBaplieText } from '../baplieParser'
import { hasBlockingIssues } from '../importValidation'

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

describe('baplie S03 vetores', () => {
  it('LOC→EQD associa POL/POD/peso ao container', () => {
    const parsed = parseBaplieText([
      "UNB+UNOA:2+X+Y+260701:1200+1'",
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:10000'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers[0]).toMatchObject({ container_number: 'TCLU1234567', pol: 'CNTAC', pod: 'BRVIX', weight_kg: 10000 })
  })

  it('EQD→LOC associa campos após o EQD no mesmo conjunto', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+VGM++KGM:12000'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers[0]).toMatchObject({ pol: 'CNTAC', pod: 'BRVIX', weight_kg: 12000 })
  })

  it('EQDs consecutivos não herdam POL/POD/peso', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:10000'",
      "EQD+CN+TCLU1111111+45G1+++5'",
      "EQD+CN+TCLU2222222+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers).toHaveLength(2)
    expect(parsed.containers[0]).toMatchObject({ pol: 'CNTAC', weight_kg: 10000 })
    expect(parsed.containers[1]).toMatchObject({ pol: null, pod: null, weight_kg: null })
  })

  it('DGS marca IMO e DIM não-zero marca OOG', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "DIM+9+10:20:30'",
      "DGS+IMD+9+3166'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers[0]).toMatchObject({ is_imo: true, imo_class: '9', un_number: '3166', is_oog: true })
  })

  it('EOF sem terminador final ainda emite o último container', () => {
    const parsed = parseBaplieText(
      "TDT+20+14+++:::GREEN SANTOS'\nLOC+147+010101'\nLOC+6+CNTAC'\nLOC+12+BRVIX'\nEQD+CN+TCLU1234567+45G1+++5",
    )
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0].container_number).toBe('TCLU1234567')
  })

  it('duplicata gera issue bloqueante por conjunto físico', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "LOC+147+010102'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers).toHaveLength(1)
    expect(hasBlockingIssues(parsed.issues)).toBe(true)
    expect(parsed.issues.some((i) => i.code === 'invalid_group' && i.severity === 'error')).toBe(true)
  })

  it('respeita UNA, separadores e release character', () => {
    // UNA: componente ':', elemento ';', release '?', terminador '*'.
    // "?*" dentro do dado não quebra segmento.
    const text = "UNA:;.? *TDT;20;14***:::GREEN SANTOS*LOC;147;010101*RFF;BM:ABC?*DEF*EQD;CN;TCLU1234567;45G1***5*"
    const parsed = parseBaplieText(text)
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0]).toMatchObject({ container_number: 'TCLU1234567', slot: '010101', bl_ref: 'ABC*DEF' })
  })

  it('parseBaplieBuffer round-trip UTF-8 sem BOM com Vitória', () => {
    const text = "TDT+20+12+++:172:20+++5LFD3:103::GREEN VITÓRIA'\nLOC+147+010101'\nLOC+11+BRVIX'\nEQD+CN+SEGU7664016+42P3+++5'\n"
    const parsed = parseBaplieBuffer(toBuffer(text))
    expect(parsed.vessel_name).toBe('GREEN VITÓRIA')
    expect(parsed.containers[0].pod).toBe('BRVIX')
  })
})
