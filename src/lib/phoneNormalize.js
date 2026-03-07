/**
 * Normalize a phone number to its 10-digit form for comparison.
 *
 * Strips all non-digit characters first, then removes a leading US country
 * code (1) if the result is 11 digits. This ensures all of the following
 * formats compare as equal:
 *
 *   +1 (323) 747-3482  →  3237473482
 *   +13237473482       →  3237473482
 *   323 7473482        →  3237473482
 *   (323) 747-3482     →  3237473482
 *   1-323-747-3482     →  3237473482
 *   3237473482         →  3237473482
 */
export function normalizePhone(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  // Strip leading US country code so 11-digit (+1XXXXXXXXXX) matches
  // 10-digit (XXXXXXXXXX) entries from manual CSV input
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1)
  }
  return digits
}
