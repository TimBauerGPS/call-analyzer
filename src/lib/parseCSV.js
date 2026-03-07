import Papa from 'papaparse'
import { normalizePhone } from './phoneNormalize'

/**
 * Parse a job management CSV file.
 * Returns a Map keyed by normalized phone number.
 *
 * Supports Albiware exports with columns:
 *   Customer Phone Number, Name, Sales Person, Status,
 *   Estimated Revenue, Insurance Company, Insurance Claim Number,
 *   Link to Project (HTML anchor — URL extracted automatically),
 *   Contract Signed (date/value indicating a signed contract)
 *
 * Also supports generic CSVs with at minimum:
 *   a phone column + job ID + job type + job status
 */
export function parseJobCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error('CSV parse failed: ' + results.errors[0].message))
          return
        }

        const headers = results.meta.fields || []
        const phoneCol        = findColumn(headers, ['Customer Phone Number', 'Phone', 'Phone Number', 'caller_number'])
        const nameCol         = findColumn(headers, ['Name', 'Customer Name', 'Job Name', 'Project Name'])
        const salesPersonCol  = findColumn(headers, ['Sales Person', 'Salesperson', 'Sales Rep'])
        const statusCol       = findColumn(headers, ['Status', 'Job Status', 'job_status'])
        const revenueCol      = findColumn(headers, ['Estimated Revenue', 'Revenue', 'Amount'])
        const insuranceCoCol  = findColumn(headers, ['Insurance Company'])
        const insuranceClaimCol = findColumn(headers, ['Insurance Claim Number', 'Claim Number'])
        const jobIdCol        = findColumn(headers, ['Job ID', 'job_id', 'File Number', 'ID'])
        const jobTypeCol      = findColumn(headers, ['Job Type', 'job_type', 'Type', 'Loss Type'])
        const linkCol         = findColumn(headers, ['Link to Project', 'Project Link', 'Albi Link', 'Link'])
        const contractSignedCol = findColumn(headers, [
          'Contract Signed', 'Contract Date', 'contract_signed',
          'Signed Date', 'Sign Date', 'Signed',
        ])

        if (!phoneCol) {
          reject(new Error('Could not find a phone number column. Expected "Customer Phone Number", "Phone Number", or "Phone".'))
          return
        }

        const jobMap = new Map()
        for (const row of results.data) {
          const raw = row[phoneCol]
          const key = normalizePhone(raw)
          if (!key) continue

          // Parse albi URL from HTML anchor: <a href="https://..." target="...">Link to Project</a>
          let albiUrl = null
          if (linkCol && row[linkCol]) {
            const match = row[linkCol].match(/href="([^"]+)"/)
            albiUrl = match ? match[1] : row[linkCol].trim() || null
          }

          // Contract signed: store raw value if non-empty
          const rawContract = contractSignedCol ? row[contractSignedCol]?.trim() : null
          const contractSigned = rawContract || null

          jobMap.set(key, {
            jobId: jobIdCol ? row[jobIdCol] : null,
            jobType: jobTypeCol ? row[jobTypeCol] : null,
            jobStatus: statusCol ? row[statusCol] : null,
            customerName: nameCol ? row[nameCol] : null,
            salesPerson: salesPersonCol ? row[salesPersonCol] : null,
            estimatedRevenue: revenueCol ? row[revenueCol] : null,
            insuranceCompany: insuranceCoCol ? row[insuranceCoCol] : null,
            insuranceClaimNumber: insuranceClaimCol ? row[insuranceClaimCol] : null,
            albiUrl,
            contractSigned,
          })
        }

        resolve({ jobMap, rowCount: results.data.length, headers })
      },
      error: (err) => reject(err),
    })
  })
}

function findColumn(headers, candidates) {
  for (const candidate of candidates) {
    const match = headers.find(h => h && h.trim().toLowerCase() === candidate.toLowerCase())
    if (match) return match
  }
  return null
}
