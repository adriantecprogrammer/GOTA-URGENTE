import { useStorage } from '@vueuse/core'
import type { Severity } from '~/utils/urgency'
import type { Leak, LocationSource } from './leaks'

export interface CreateReportInput {
  lat: number
  lng: number
  severity: Severity
  accuracy?: number
  source?: LocationSource
  /** From `uploads.photo()`. */
  photo_key?: string
  /** Max 280 chars. */
  note?: string
  /** Confirm this existing leak. */
  leak_id?: string
  /** "Es otra fuga": skip server-side grouping. */
  force_new?: boolean
}

export interface CreateReportResult {
  /** created: new leak · confirmed: added to an existing one. */
  action: 'created' | 'confirmed'
  leak_id: string
  report_id: string
  is_recurrent: boolean
  leak: Leak
}

// The API dedupes confirmations per device; this id is that device.
const deviceId = useStorage('gota:device', () => crypto.randomUUID())

export const reportsService = (http: typeof $fetch) => ({
  /** 409 if this device already reported the leak or the leak is closed. */
  create: (input: CreateReportInput) =>
    http<CreateReportResult>('/reports', { method: 'POST', body: { ...input, device_id: deviceId.value } })
})
