export function printDocumentElement(element: HTMLElement, title: string) {
  const printWindow = window.open('', '_blank', 'width=900,height=1100')
  if (!printWindow) {
    window.print()
    return
  }

  const printDocument = printWindow.document
  printDocument.title = title

  const style = printDocument.createElement('style')
  style.textContent = '@page{size:A4;margin:0}html,body{margin:0;background:#fff}body{font-family:Arial,sans-serif}.invoice-print-content{width:198mm;min-height:281mm;margin:0 auto;padding:8mm;box-sizing:border-box;background:#fff}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}'
  printDocument.head.appendChild(style)

  const wrapper = printDocument.createElement('div')
  wrapper.className = 'invoice-print-content'
  const clone = element.cloneNode(true) as HTMLElement
  while (clone.firstChild) wrapper.appendChild(clone.firstChild)
  printDocument.body.replaceChildren(wrapper)

  printWindow.focus()
  window.setTimeout(() => { printWindow.print(); printWindow.close() }, 250)
}
