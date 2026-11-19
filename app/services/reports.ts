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

// One device = one vote per leak: the API rejects a second report of the same leak from this id with 409.
const deviceId = useStorage('gota:device', () => crypto.randomUUID())

// Mirror of what the API already knows, so the UI can say "ya la reportaste" before the user fills the form.
// ponytail: local only (lost if storage is cleared, like the device id itself); the API stays the source of truth.
const reported = useStorage<string[]>('gota:reported', [])
export const hasReported = (leakId: string) => reported.value.includes(leakId)
const remember = (leakId: string) => !hasReported(leakId) && reported.value.push(leakId)

export const reportsService = (http: typeof $fetch) => ({
  /** 409 if this device already reported the leak or the leak is closed. */
  async create(input: CreateReportInput) {
    try {
      const r = await http<CreateReportResult>('/reports', { method: 'POST', body: { ...input, device_id: deviceId.value } })
      remember(r.leak_id)
      return r
    } catch (e) {
      // 409 on an explicit confirmation: this device can't vote for that leak again.
      if (input.leak_id && (e as { status?: number }).status === 409) remember(input.leak_id)
      throw e
    }
  }
})
