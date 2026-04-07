export function isPpcAttributedCall(call) {
  if (!call) return false
  if (call.is_ppc === true) return true
  if (Boolean(call.gclid)) return true

  const source = `${call.source || ''} ${call.source_name || ''}`.toLowerCase()
  const medium = `${call.utm_medium || ''}`.toLowerCase()

  return (
    source.includes('ppc') ||
    source.includes('google ads') ||
    source.includes('lsa') ||
    source.includes('local service') ||
    medium.includes('cpc') ||
    medium.includes('ppc') ||
    medium.includes('paid')
  )
}
