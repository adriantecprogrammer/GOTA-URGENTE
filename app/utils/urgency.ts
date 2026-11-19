// Urgency and grouping are computed by the API and only shown in the dashboard; here, just the enums citizens see.
export type Severity = 'goteo' | 'chorro' | 'inundacion'
export type Status = 'pendiente' | 'en_atencion' | 'resuelta' | 'descartada'
export type Level = 'critica' | 'alta' | 'media' | 'baja'

export const SEVERITY: Record<Severity, { label: string, hint: string, icon: string }> = {
  goteo: { label: 'Goteo', hint: 'Gotas constantes o charco pequeño', icon: 'i-lucide-droplet' },
  chorro: { label: 'Chorro', hint: 'Flujo continuo que corre por la calle', icon: 'i-lucide-droplets' },
  inundacion: { label: 'Inundación', hint: 'Agua acumulada, brota del suelo o tubería rota', icon: 'i-lucide-waves' }
}

/** `step`: how far along the repair is, out of 3. Drawn as filled drops by StatusSteps. */
export const STATUS: Record<Status, { label: string, step: 0 | 1 | 2 | 3 }> = {
  pendiente: { label: 'Pendiente', step: 1 },
  en_atencion: { label: 'En atención', step: 2 },
  resuelta: { label: 'Resuelta', step: 3 },
  descartada: { label: 'Descartada', step: 0 }
}

export function distanceM(a: { lat: number, lng: number }, b: { lat: number, lng: number }) {
  const R = 6371e3
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
