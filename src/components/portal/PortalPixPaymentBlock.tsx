import { QRCodeSVG } from 'qrcode.react'
import { Card } from '../ui/Card'

export function PortalPixPaymentBlock({ pixPayload }: { pixPayload: string }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-semibold">Pagamento via PIX</div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <QRCodeSVG value={pixPayload} size={120} level="M" />
        <div>
          <div className="mb-1 text-xs text-[var(--app-muted)]">Copia e cola</div>
          <div className="max-w-xs break-all rounded bg-[var(--app-surface-muted)] p-2 font-mono text-xs">
            {pixPayload}
          </div>
        </div>
      </div>
    </Card>
  )
}
