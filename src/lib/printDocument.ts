export function printDocumentElement(element: HTMLElement, title: string) {
  const printWindow = window.open('', '_blank', 'width=900,height=1100')
  if (!printWindow) {
    window.print()
    return
  }

  printWindow.document.write(`<!doctype html><html><head><title>${title}</title><style>@page{size:A4;margin:0}html,body{margin:0;background:#fff}body{font-family:Arial,sans-serif}.invoice-print-content{width:198mm;min-height:281mm;margin:0 auto;padding:8mm;box-sizing:border-box;background:#fff}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}</style></head><body><div class="invoice-print-content">${element.innerHTML}</div></body></html>`)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => { printWindow.print(); printWindow.close() }, 250)
}
