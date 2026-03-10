/**
 * send-meta-report.js
 *
 * Emails a formatted Meta Analysis report via Resend.
 *
 * POST /.netlify/functions/send-meta-report
 * Body: { to, result, companyName }
 * Header: Authorization: Bearer <supabase_jwt>
 *
 * Required env vars:
 *   RESEND_API_KEY   — from resend.com
 *   RESEND_FROM      — verified sender, e.g. "reports@yourdomain.com"
 */

import { getSettings, jsonResponse } from './_getSettings.js'

const PRIORITY_COLORS = {
  problem:  '#dc2626',
  evidence: '#d97706',
  training: '#4f46e5',
  impact:   '#16a34a',
}

function buildHtml(result, companyName) {
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const period = result.period ? `Period: ${result.period}` : 'All time'

  const prioritiesHtml = (result.priorities || []).map(p => `
    <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:16px;">
      <div style="background:#4f46e5;padding:12px 16px;display:flex;align-items:center;gap:12px;">
        <span style="color:#fff;font-size:18px;font-weight:700;line-height:1;">#${p.rank}</span>
        <span style="color:#fff;font-size:14px;font-weight:600;">${escHtml(p.title || '')}</span>
      </div>
      <div style="padding:16px;font-size:13px;line-height:1.6;">
        ${section('THE PROBLEM', p.problem, PRIORITY_COLORS.problem)}
        ${section('EVIDENCE FROM CALLS', p.evidence, PRIORITY_COLORS.evidence)}
        ${section('WHAT TO TRAIN', p.training, PRIORITY_COLORS.training)}
        ${section('EXPECTED IMPACT', p.impact, PRIORITY_COLORS.impact)}
      </div>
    </div>
  `).join('')

  const quickWinHtml = result.quickWin ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
      <p style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">⚡ Quick Win — Implement Tomorrow</p>
      <p style="font-size:13px;color:#14532d;margin:0;line-height:1.6;">${escHtml(result.quickWin)}</p>
    </div>
  ` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">

    <!-- Header -->
    <div style="background:#4f46e5;padding:28px 32px;">
      <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Call Training Meta Analysis</h1>
      <p style="color:#c7d2fe;font-size:13px;margin:0;">${escHtml(companyName || '')}${companyName ? '  ·  ' : ''}${period}  ·  Generated ${date}</p>
    </div>

    <!-- Stats row -->
    <div style="background:#eef2ff;padding:14px 32px;display:flex;gap:32px;font-size:13px;">
      <div>
        <div style="font-size:20px;font-weight:700;color:#4f46e5;">${result.callCount || '—'}</div>
        <div style="color:#6b7280;text-transform:uppercase;font-size:10px;letter-spacing:.05em;">Calls Analyzed</div>
      </div>
      <div>
        <div style="font-size:20px;font-weight:700;color:#4f46e5;">${escHtml(result.bookedRate || String(result.bookedCount || '—'))}</div>
        <div style="color:#6b7280;text-transform:uppercase;font-size:10px;letter-spacing:.05em;">Booking Rate</div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">

      <!-- Executive Summary -->
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
        <p style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Executive Summary</p>
        <p style="font-size:13px;color:#111827;margin:0;line-height:1.7;">${escHtml(result.summary || '')}</p>
      </div>

      ${quickWinHtml}

      <!-- Top 5 Priorities -->
      <p style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;">Top 5 Training Priorities</p>
      ${prioritiesHtml}

    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 32px;">
      <p style="font-size:11px;color:#9ca3af;margin:0;">Call Analyzer — Confidential</p>
    </div>

  </div>
</body>
</html>`
}

function section(label, text, color) {
  if (!text) return ''
  return `
    <div style="margin-bottom:12px;">
      <p style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.05em;margin:0 0 4px;">${label}</p>
      <p style="color:#111827;margin:0;">${escHtml(text)}</p>
    </div>`
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const authHeader = event.headers['authorization'] || event.headers['Authorization']

  let user
  try {
    ;({ user } = await getSettings(authHeader))
  } catch (err) {
    return jsonResponse(401, { error: err.message })
  }

  const { RESEND_API_KEY, RESEND_FROM } = process.env
  if (!RESEND_API_KEY) return jsonResponse(500, { error: 'Email is not configured (missing RESEND_API_KEY).' })
  if (!RESEND_FROM)    return jsonResponse(500, { error: 'Email is not configured (missing RESEND_FROM).' })

  let body
  try { body = JSON.parse(event.body) } catch { return jsonResponse(400, { error: 'Invalid request body.' }) }

  const { to, result, companyName } = body
  if (!to?.includes('@'))  return jsonResponse(400, { error: 'A valid recipient email is required.' })
  if (!result?.priorities) return jsonResponse(400, { error: 'No meta analysis result provided.' })

  const html = buildHtml(result, companyName)
  const period = result.period || 'All time'
  const subject = `Call Training Meta Analysis — ${companyName || 'Report'} (${period})`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to.trim()],
      subject,
      html,
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.json().catch(() => ({}))
    return jsonResponse(500, { error: `Failed to send email: ${err.message || resendRes.status}` })
  }

  return jsonResponse(200, { success: true })
}
