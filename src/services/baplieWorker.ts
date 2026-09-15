import { parseBaplieBuffer, type ParsedBaplie } from './baplieParser'

export type BaplieWorkerResponse =
  | { ok: true; result: ParsedBaplie }
  | { ok: false; error: string }

addEventListener('message', (event: MessageEvent<ArrayBuffer>) => {
  try {
    const result = parseBaplieBuffer(event.data)
    postMessage({ ok: true, result } satisfies BaplieWorkerResponse)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    postMessage({ ok: false, error } satisfies BaplieWorkerResponse)
  }
})
