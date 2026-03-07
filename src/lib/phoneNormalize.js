/**
 * Strip all non-digit characters for phone number comparison.
 * Matches the logic from the reference Apps Script: rawPhone.replace(/\D/g, '')
 */
export function normalizePhone(phone) {
  if (!phone) return ''
  return String(phone).replace(/\D/g, '')
}
