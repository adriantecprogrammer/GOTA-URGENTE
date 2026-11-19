import type { Level, Severity, Status } from '~/utils/urgency'

export type LocationSource = 'gps' | 'manual'

/** A map pin: one physical leak grouping every report about it. */
export interface Leak {
  id: string
  lat: number
  lng: number
  status: Status
  max_severity: Severity
  /** Reports from distinct devices. */
  report_count: number
  /** 0–100. */
  urgency_score: number
  urgency_level: Level
  /** Estimated liters lost since the first report. */
  liters_wasted: number
  liters_per_day: number
  photo_url: string | null
  first_reported_at: string
}

export interface NearbyLeak {
  id: string
  distance_m: number
  status: Status
  max_severity: Severity
  report_count: number
  photo_url: string | null
}

export interface NearbyQuery {
  lat: number
  lng: number
  /** GPS accuracy in meters. */
  accuracy?: number
  source?: LocationSource
}

export interface NearbyResult {
  radius: { inner_m: number, outer_m: number }
  /** GPS too imprecise: ask the user to drag the pin. */
  must_drag_pin: boolean
  /** Same leak: show "Ya se reportó aquí" with Confirmar preselected. */
  exact: NearbyLeak | null
  /** Ambiguous band: show without preselecting. */
  ambiguous: NearbyLeak[]
  /** A leak was repaired here: a new report will be flagged as recurrent. */
  resolved: { id: string, distance_m: number, resolved_at: string | null } | null
}

/** [minLng, minLat, maxLng, maxLat] — e.g. MapLibre's `map.getBounds().toArray().flat()`. */
export type BBox = [number, number, number, number]

export const leaksService = (http: typeof $fetch) => ({
  /** Active leaks (pendiente + en_atencion), most urgent first. Without bbox returns all. */
  list: (bbox?: BBox) =>
    http<Leak[]>('/leaks', { query: { bbox: bbox?.join(',') } }),

  /** Duplicate pre-check. Call BEFORE asking for the photo. */
  nearby: (query: NearbyQuery) =>
    http<NearbyResult>('/leaks/nearby', { query })
})
