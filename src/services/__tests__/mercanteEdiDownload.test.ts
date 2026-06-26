// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { downloadEdiMercante } from '../mercanteEdiDownload'

describe('downloadEdiMercante', () => {
  let clickSpy: ReturnType<typeof vi.fn>
  let appendChildSpy: ReturnType<typeof vi.fn>
  let removeChildSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clickSpy = vi.fn()
    appendChildSpy = vi.fn()
    removeChildSpy = vi.fn()
    revokeObjectURLSpy = vi.fn()

    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
    } as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildSpy as (node: Node) => Node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildSpy as (child: Node) => Node)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURLSpy as (url: string) => void)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates blob and triggers download with .edi extension', () => {
    downloadEdiMercante('M50001...', 'MERCANTE_M5_39')

    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/plain;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    expect(anchor.download).toBe('MERCANTE_M5_39.edi')
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test')
  })

  it('does not double .edi if filename already ends with it', () => {
    downloadEdiMercante('M50001...', 'MERCANTE_M5_39.edi')

    const anchor = document.createElement('a')
    expect(anchor.download).toBe('MERCANTE_M5_39.edi')
  })
})
