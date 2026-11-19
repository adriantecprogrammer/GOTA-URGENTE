<script setup lang="ts">
import { StorageSerializers, useStorage } from '@vueuse/core'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre v6 looks for its worker next to the bundle chunk, where Vite never copies it; ?url emits it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Leak } from '~/services/leaks'

maplibregl.setWorkerUrl(workerUrl)

const props = defineProps<{
  leaks: Leak[]
  selectedId?: string | null
  /** Show a fixed center pin and emit `center` as the map moves. */
  picking?: boolean
  /** Area covered by floating UI; map center and pin sit in the visible remainder. */
  padding?: { left: number, bottom: number }
  /** Thumbnail mode: zoom out around the user (or to every leak if unknown); restores the previous view when turned off. */
  overview?: boolean
  /** Ask for the user's position, open the map there and mark it. Falls back to CITY_CENTER. */
  locate?: boolean
}>()
const emit = defineEmits<{ select: [id: string], center: [pos: { lat: number, lng: number }], tap: [] }>()

const container = ref<HTMLDivElement>()
const moving = ref(false)
let map: maplibregl.Map

let view: { center: maplibregl.LngLatLike, zoom: number } | undefined
// Last flyTo destination. Later camera moves (padding change, leaving overview) re-aim at it instead of
// cancelling the flight; cleared as soon as the user moves the map themselves.
let target: typeof view
// Set once the user moves the map themselves; after that a late GPS fix only moves the dot, not the camera.
let touched = false

type Point = { lat: number, lng: number }
const STREET_ZOOM = 15
// Last known position: lets the next visit open in the right place before the GPS answers.
const lastPos = useStorage<Point | null>('gota:me', null, undefined, { serializer: StorageSerializers.object })
let me: Point | undefined
let meMarker: maplibregl.Marker | undefined

// ponytail: one fix per visit; use watchPosition if the dot should follow someone on the move.
const getFix = () => new Promise<Point | null>((resolve) => {
  if (!props.locate || !navigator.geolocation) return resolve(null)
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
  )
})

function showMe(p: Point) {
  me = lastPos.value = p
  if (!meMarker) {
    const el = document.createElement('div')
    el.className = 'grid size-10 place-items-center rounded-full bg-gota-400/25'
    el.innerHTML = '<span class="size-3.5 rounded-full bg-gota-500 ring-3 ring-white"></span>'
    el.setAttribute('aria-label', 'Tu ubicación')
    meMarker = new maplibregl.Marker({ element: el })
  }
  meMarker.setLngLat([p.lng, p.lat]).addTo(map)
  if (touched) return
  view = { center: [p.lng, p.lat], zoom: STREET_ZOOM }
  if (props.overview) fitOpen()
  else if (!target) map.jumpTo(view)
}

// One colour, one size: urgency is the dashboard's business, citizens only need to see where leaks are.
const PIN_HEX = '#0278C0'
const DOT_LAYERS = ['inc-dot']

const geojson = computed(() => ({
  type: 'FeatureCollection' as const,
  features: props.leaks.map(i => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [i.lng, i.lat] },
    properties: { id: i.id }
  }))
}))

onMounted(async () => {
  const el = container.value!
  // Open where the user is: the last known position at once, otherwise wait briefly for a first fix
  // (it has to answer a permission prompt the first time) before falling back to the city centre.
  const fix = getFix()
  const [style, start] = await Promise.all([
    gotaMapStyle(),
    props.locate ? lastPos.value ?? Promise.race([fix, new Promise<null>(r => setTimeout(r, 1500, null))]) : null
  ])
  map = new maplibregl.Map({
    container: el,
    style,
    center: start ? [start.lng, start.lat] : [CITY_CENTER.lng, CITY_CENTER.lat],
    zoom: start ? STREET_ZOOM : 14,
    attributionControl: { compact: true }
  })
  map.setPadding({ top: 0, right: 0, left: 0, bottom: 0, ...props.padding })
  if (props.overview) saveViewAndFit()
  if (start) showMe(start)
  fix.then(p => p && showMe(p))
  // The thumbnail shrinks over a transition; keep refitting until it settles at its final size.
  map.on('resize', () => props.overview && fitOpen())
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

  map.on('load', () => {
    map.addSource('incidents', { type: 'geojson', data: geojson.value })
    const radius = 8
    map.addLayer({
      id: 'inc-dot',
      type: 'circle',
      source: 'incidents',
      paint: {
        'circle-color': PIN_HEX,
        'circle-radius': radius,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2.5
      }
    })
    map.addLayer({
      id: 'inc-selected',
      type: 'circle',
      source: 'incidents',
      filter: ['==', ['get', 'id'], props.selectedId ?? ''],
      paint: {
        'circle-color': 'transparent',
        'circle-radius': radius + 5,
        'circle-stroke-color': '#002F59',
        'circle-stroke-width': 3
      }
    })
  })

  map.on('click', DOT_LAYERS, (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id
    if (id && !props.picking) emit('select', id)
  })
  // A tap on the map itself, not on an incident.
  map.on('click', (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) emit('tap')
  })
  const cursor = (c: string) => () => (map.getCanvas().style.cursor = props.picking ? '' : c)
  map.on('mouseenter', DOT_LAYERS, cursor('pointer'))
  map.on('mouseleave', DOT_LAYERS, cursor(''))
  map.on('movestart', (e) => {
    moving.value = true
    if ('originalEvent' in e && e.originalEvent) {
      target = undefined
      touched = true
    }
  })
  map.on('moveend', () => {
    moving.value = false
    if (props.picking) emitCenter()
  })
})

onBeforeUnmount(() => map?.remove())

function saveViewAndFit() {
  view = { center: map.getCenter(), zoom: map.getZoom() }
  fitOpen()
}
function fitOpen() {
  map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })
  if (me) return map.jumpTo({ center: [me.lng, me.lat], zoom: STREET_ZOOM - 2 })
  if (!props.leaks.length) return
  const b = new maplibregl.LngLatBounds()
  for (const i of props.leaks) b.extend([i.lng, i.lat])
  map.fitBounds(b, { padding: 16, animate: false })
}
watch(() => props.overview, (on) => {
  if (!map) return
  if (on) saveViewAndFit()
  else if (target ?? view) map.jumpTo((target ?? view)!)
})

function emitCenter() {
  const c = map.getCenter()
  emit('center', { lat: c.lat, lng: c.lng })
}

watch(geojson, (data) => {
  (map?.getSource('incidents') as GeoJSONSource | undefined)?.setData(data)
  // Leaks arrive after the map exists; without a user position the thumbnail frames them.
  if (map && props.overview && !me) fitOpen()
})
watch(() => props.selectedId, id => map?.getLayer('inc-selected') && map.setFilter('inc-selected', ['==', ['get', 'id'], id ?? '']))
watch(() => props.padding, p => p && !props.overview && map?.easeTo({ padding: { top: 0, right: 0, ...p }, ...target, duration: 300 }), { deep: true })
watch(() => props.picking, p => p && map && emitCenter())

function flyTo(pos: { lat: number, lng: number }, zoom = 16) {
  if (!map) return
  target = { center: [pos.lng, pos.lat], zoom: Math.max(map.getZoom(), zoom) }
  map.flyTo({ ...target, duration: 800 })
}

defineExpose({ flyTo })
</script>

<template>
  <div
    class="relative size-full"
    :style="{ '--pad-left': `${padding?.left ?? 0}px`, '--pad-bottom': `${padding?.bottom ?? 0}px` }"
  >
    <div
      ref="container"
      class="size-full bg-[#F6F6F6]"
    />

    <!-- Center pin (Base "pickup" pattern): map moves, pin stays. -->
    <div
      v-if="picking"
      class="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
      :style="{ left: `calc(50% + ${(padding?.left ?? 0) / 2}px)`, top: `calc(50% - ${(padding?.bottom ?? 0) / 2}px)` }"
      aria-hidden="true"
    >
      <div
        class="flex flex-col items-center transition-transform duration-150"
        :class="moving ? '-translate-y-2' : ''"
      >
        <div class="grid size-9 place-items-center rounded-full bg-inverted text-gota-300 shadow-lg">
          <UIcon
            name="i-lucide-droplet"
            class="size-4"
          />
        </div>
        <div class="h-3 w-0.5 bg-inverted" />
      </div>
      <div class="mx-auto -mt-0.5 h-1.5 w-3 rounded-full bg-black/30 blur-[1px]" />
    </div>
  </div>
</template>
