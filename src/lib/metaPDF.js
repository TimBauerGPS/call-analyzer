/**
 * metaPDF.js
 * Generates and downloads a formatted Meta Analysis PDF report using jsPDF.
 */
import { jsPDF } from 'jspdf'

const INDIGO  = [79, 70, 229]
const RED     = [220, 38, 38]
const AMBER   = [217, 119, 6]
const GREEN   = [22, 163, 74]
const GRAY9   = [17, 24, 39]
const GRAY6   = [75, 85, 99]
const GRAY4   = [156, 163, 175]
const WHITE   = [255, 255, 255]
const INDIGO_BG = [238, 242, 255]
const GREEN_BG  = [240, 253, 244]

export function downloadMetaPDF(result, companyName) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const ML = 18          // margin left
  const MR = 18          // margin right
  const PW = 210         // page width
  const CW = PW - ML - MR  // content width
  const PH = 297
  const MB = 15          // margin bottom
  let y = 0

  // ── Helpers ──────────────────────────────────────────────────

  function checkPage(needed = 10) {
    if (y + needed > PH - MB) {
      doc.addPage()
      y = 20
    }
  }

  // Wrapped text block — returns new Y
  function textBlock(text, { x = ML, maxW = CW, size = 10, color = GRAY9, bold = false, lineGap = 1.5 } = {}) {
    if (!text) return y
    doc.setFontSize(size)
    doc.setTextColor(...color)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const lines = doc.splitTextToSize(String(text), maxW - (x - ML))
    const lh = size * 0.4 + lineGap
    checkPage(lines.length * lh + 4)
    doc.text(lines, x, y)
    y += lines.length * lh
    return y
  }

  function gap(mm = 4) { y += mm }

  function hRule(color = [229, 231, 235]) {
    doc.setDrawColor(...color)
    doc.setLineWidth(0.3)
    doc.line(ML, y, PW - MR, y)
    y += 3
  }

  function label(text, color = GRAY4) {
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...color)
    doc.text(text.toUpperCase(), ML, y)
    y += 4
  }

  function filledBox(bY, bH, color) {
    doc.setFillColor(...color)
    doc.roundedRect(ML, bY, CW, bH, 2, 2, 'F')
  }

  function priorityBadge(rank, bY) {
    doc.setFillColor(...INDIGO)
    doc.roundedRect(ML, bY, CW, 8, 2, 2, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text(`#${rank}`, ML + 3, bY + 5.5)
  }

  // ── Cover / Header ───────────────────────────────────────────

  // Indigo header bar
  doc.setFillColor(...INDIGO)
  doc.rect(0, 0, PW, 38, 'F')

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...WHITE)
  doc.text('Call Training Meta Analysis', ML, 16)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(199, 210, 254)  // indigo-200
  const sub = [
    companyName,
    result.period ? `Period: ${result.period}` : null,
    `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
  ].filter(Boolean).join('  ·  ')
  doc.text(sub, ML, 26)

  y = 46

  // Stats row
  filledBox(y, 14, INDIGO_BG)
  const stats = [
    { label: 'Calls Analyzed', value: String(result.callCount || '—') },
    { label: 'Booking Rate',   value: result.bookedRate || `${result.bookedCount} booked` },
    { label: 'Period',         value: result.period || 'All time' },
  ]
  const colW = CW / stats.length
  stats.forEach((s, i) => {
    const sx = ML + i * colW + 4
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...INDIGO)
    doc.text(s.value, sx, y + 7)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRAY6)
    doc.text(s.label.toUpperCase(), sx, y + 12)
  })
  y += 20

  // ── Executive Summary ────────────────────────────────────────

  label('Executive Summary')
  textBlock(result.summary, { size: 10, color: GRAY9 })
  gap(6)

  // ── Quick Win ────────────────────────────────────────────────

  if (result.quickWin) {
    checkPage(24)
    const qwStartY = y
    label('⚡  Quick Win — Implement Tomorrow', GREEN)
    const qwLines = doc.splitTextToSize(result.quickWin, CW - 8)
    const qwH = qwLines.length * 5.5 + 12
    filledBox(qwStartY - 1, qwH, GREEN_BG)
    doc.setDrawColor(134, 239, 172)
    doc.setLineWidth(0.4)
    doc.line(ML, qwStartY - 1, ML, qwStartY - 1 + qwH)
    y = qwStartY + 5
    textBlock(result.quickWin, { x: ML + 4, maxW: CW - 8, size: 10, color: [20, 83, 45] })
    y = qwStartY + qwH + 4
  }

  gap(2)
  hRule()

  // ── 5 Priorities ─────────────────────────────────────────────

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...INDIGO)
  doc.text('Top 5 Training Priorities', ML, y)
  y += 8

  ;(result.priorities || []).forEach(p => {
    checkPage(50)

    // Rank header bar
    const headerY = y
    priorityBadge(p.rank, headerY)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text(p.title || '', ML + 12, headerY + 5.5)
    y += 12

    const sections = [
      { lbl: 'The Problem',         text: p.problem,  color: RED   },
      { lbl: 'Evidence from Calls', text: p.evidence, color: AMBER },
      { lbl: 'What to Train',       text: p.training, color: INDIGO },
      { lbl: 'Expected Impact',     text: p.impact,   color: GREEN },
    ]

    sections.forEach(({ lbl, text, color }) => {
      checkPage(20)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...color)
      doc.text(lbl.toUpperCase(), ML + 2, y)
      y += 4
      textBlock(text, { x: ML + 2, maxW: CW - 4, size: 9.5, color: GRAY9 })
      gap(3)
    })

    gap(4)
    hRule()
  })

  // ── Footer on each page ──────────────────────────────────────

  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRAY4)
    doc.text('Call Analyzer — Confidential', ML, PH - 8)
    doc.text(`Page ${i} of ${totalPages}`, PW - MR - 20, PH - 8)
  }

  const date = new Date().toISOString().slice(0, 10)
  doc.save(`meta-analysis-${date}.pdf`)
}
