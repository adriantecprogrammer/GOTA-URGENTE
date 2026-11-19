import { leaksService } from '~/services/leaks'
import { reportsService } from '~/services/reports'
import { uploadsService } from '~/services/uploads'

// Postgres bigints arrive as strings ("3"); turn them into numbers once, here, for every entity.
const INT_KEYS = new Set(['report_count', 'urgency_score', 'liters_wasted', 'liters_per_day'])
const reviver = (key: string, value: unknown) =>
  INT_KEYS.has(key) && typeof value === 'string' ? Number(value) : value

// Citizen app: public endpoints only, no login, no token.
export default defineNuxtPlugin(() => {
  const http = $fetch.create({
    baseURL: useRuntimeConfig().public.apiBase,
    parseResponse: text => JSON.parse(text, reviver)
  })

  return {
    provide: {
      api: {
        leaks: leaksService(http),
        reports: reportsService(http),
        uploads: uploadsService(http)
      }
    }
  }
})
