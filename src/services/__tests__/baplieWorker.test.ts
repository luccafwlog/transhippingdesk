import { describe, expect, it, vi } from 'vitest'
import { parseBaplieFile, parseBaplieInWorker } from '../baplieParser'
import type { BaplieWorkerResponse } from '../baplieWorker'

function makeBaplieBuffer(): ArrayBuffer {
  const content = [
    "UNA:+.? '",
    "UNB+UNOA:2+SENDER+RECEIVER+260601:1200+1'",
    "UNH+1+BAPLIE:D:95B:UN:SMDG20'",
    "BGM++001+9'",
    "TDT+20+001E+1++COSCO:172:20+++9876543:103::COSCO SHIPPING STAR'",
    "LOC+5+CNSHA:139:6'",
    "LOC+11+BRVIT:139:6'",
    "EQD+CN+COSU1234567+45G1+2+2+5'",
    "LOC+147+010204:139:6'",
    "MEA+WT++KGM:28000'",
    "UNT+10+1'",
    "UNZ+1+1'",
  ].join('\n')
  return new TextEncoder().encode(content).buffer as ArrayBuffer
}

describe('baplieWorker & parseBaplieInWorker', () => {
  it('parseBaplieFile utiliza fallback gracioso quando Worker nao esta disponivel no ambiente', async () => {
    const buffer = makeBaplieBuffer()
    const file = new File([buffer], 'manifest.edi', { type: 'text/plain' })

    const parsed = await parseBaplieFile(file)
    expect(parsed.vessel_name).toBe('COSCO SHIPPING STAR')
    expect(parsed.voyage_number).toBe('001E')
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0].container_number).toBe('COSU1234567')
  })

  it('parseBaplieInWorker interage com a API Worker com sucesso', async () => {
    const buffer = makeBaplieBuffer()
    const mockResponse: BaplieWorkerResponse = {
      ok: true,
      result: {
        vessel_name: 'COSCO SHIPPING STAR',
        voyage_number: '001E',
        containers: [
          {
            container_number: 'COSU1234567',
            size_type: '45G1',
            status: 'full',
            weight_kg: 28000,
            pol: 'CNSHA',
            pod: 'BRVIT',
            final_dest: null,
            bl_ref: null,
            slot: '010204',
            is_imo: false,
            imo_class: null,
            un_number: null,
            is_oog: false,
          },
        ],
        pods: ['BRVIT'],
        issues: [],
        encoding: 'utf-8',
      },
    }

    class MockWorker {
      onmessage: ((event: MessageEvent<BaplieWorkerResponse>) => void) | null = null
      onerror: ((event: unknown) => void) | null = null

      postMessage() {
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage(new MessageEvent('message', { data: mockResponse }))
          }
        }, 0)
      }

      terminate = vi.fn()
    }

    const originalWorker = globalThis.Worker
    globalThis.Worker = MockWorker as unknown as typeof Worker

    try {
      const result = await parseBaplieInWorker(buffer)
      expect(result.vessel_name).toBe('COSCO SHIPPING STAR')
      expect(result.containers[0].container_number).toBe('COSU1234567')
    } finally {
      globalThis.Worker = originalWorker
    }
  })

  it('parseBaplieInWorker rejeita Promise caso o Worker sinalize erro', async () => {
    const buffer = makeBaplieBuffer()
    const mockErrorResponse: BaplieWorkerResponse = {
      ok: false,
      error: 'Arquivo Baplie corrompido no segmento UNH',
    }

    class FailingWorker {
      onmessage: ((event: MessageEvent<BaplieWorkerResponse>) => void) | null = null
      onerror: ((event: unknown) => void) | null = null

      postMessage() {
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage(new MessageEvent('message', { data: mockErrorResponse }))
          }
        }, 0)
      }

      terminate = vi.fn()
    }

    const originalWorker = globalThis.Worker
    globalThis.Worker = FailingWorker as unknown as typeof Worker

    try {
      await expect(parseBaplieInWorker(buffer)).rejects.toThrow('Arquivo Baplie corrompido no segmento UNH')
    } finally {
      globalThis.Worker = originalWorker
    }
  })
})
