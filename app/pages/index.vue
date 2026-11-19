<script setup lang="ts">
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { hasReported } from '~/services/reports'

const { data: leaks, error, status: loadStatus, refresh } = useLeaks()
const map = useTemplateRef('map')
const sheet = useTemplateRef('sheet')
// ssrWidth: gives the right answer on first render (the default is `false` until mounted).
const desktop = useMediaQuery('(min-width: 1024px)', { ssrWidth: window.innerWidth })
const { height: sheetH } = useElementSize(sheet, undefined, { box: 'border-box' })

type Mode = 'browse' | 'detail' | 'report'
const mode = ref<Mode>('browse')

// Mobile home: the panel is the whole screen and the map is a floating thumbnail until tapped.
const mapOpen = ref(false)
const mini = computed(() => !desktop.value && mode.value === 'browse' && !mapOpen.value)
// The map grows over the full-screen panel first; only then does the panel become a bottom sheet.
const GROW_MS = 300
const SNAP_MS = 250
const growing = ref(false)
watch(mini, (m) => {
  growing.value = !m
  if (!m) setTimeout(() => {
    growing.value = false
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    nextTick(() => sheet.value?.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: SNAP_MS, easing: 'ease-out' }))
  }, GROW_MS)
})
const full = computed(() => mini.value || growing.value)

// Drawer (mobile, map open), three positions: low (map takes the whole screen), half, full (sheet takes it).
// Moved by dragging or tapping the grabber; a tap on the map toggles low.
const SNAPS = ['low', 'half', 'full'] as const
type Snap = typeof SNAPS[number]
const LOW_PX = 96 // grabber + one header row; matches max-h-24 below
const snap = ref<Snap>('half')
const pulledUp = computed(() => snap.value === 'full')
const drag = ref<number | null>(null) // live sheet height in px while a finger is on the grabber
const snapping = ref(false) // height transition on, only while the sheet settles after a release
const instant = ref(false)
const tall = computed(() => full.value || pulledUp.value)
const low = computed(() => snap.value === 'low' && !full.value)

function settle(to: Snap) {
  drag.value = null
  snapping.value = true
  snap.value = to
  setTimeout(() => {
    snapping.value = false
    // The list pulled all the way up is the home screen: swap to it once the sheet has arrived.
    if (!pulledUp.value || mode.value !== 'browse') return
    instant.value = true
    mapOpen.value = false
    snap.value = 'half'
    setTimeout(() => (instant.value = false), 50)
  }, SNAP_MS)
}
function onMapTap() {
  if (!desktop.value && !full.value) settle(low.value ? 'half' : 'low')
}

let startY = 0
let startH = 0
let dragged = false
function onGrab(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  startY = e.clientY
  startH = sheet.value!.offsetHeight
  dragged = false
  snapping.value = false
}
function onDrag(e: PointerEvent) {
  if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
  const dy = startY - e.clientY
  if (!dragged && Math.abs(dy) < 6) return // movement threshold, so a tap is not a drag
  dragged = true
  drag.value = Math.min(window.innerHeight, Math.max(LOW_PX - 24, startH + dy))
}
function onRelease(e: PointerEvent) {
  if (!dragged) return
  const dy = startY - e.clientY
  const from = SNAPS.indexOf(snap.value)
  let to = from
  if (Math.abs(dy) >= 40) {
    // Land on the position nearest to where the finger let go; a short flick still moves one step.
    const heights = [LOW_PX, window.innerHeight * 0.56, window.innerHeight]
    const h = drag.value ?? startH
    to = heights.indexOf(heights.reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a))
    if (to === from) to = Math.min(2, Math.max(0, from + Math.sign(dy)))
  }
  settle(SNAPS[to]!)
  // A mouse drag also ends in a click, fired before this timer; touch drags fire none.
  setTimeout(() => (dragged = false))
}
// Tap and keyboard: the same control without the gesture.
function onTap() {
  if (!dragged) settle(snap.value === 'half' ? 'full' : 'half')
}

// Map padding follows the resting sheet only: not the finger, and not a sheet that covers the map.
const padBottom = ref(0)
watch(sheetH, (h) => {
  if (drag.value == null && !pulledUp.value) padBottom.value = Math.round(h)
})
const padding = computed(() => desktop.value
  ? { left: 432, bottom: 0 }
  : { left: 0, bottom: full.value ? 0 : padBottom.value })
const selectedId = ref<string | null>(null)
const center = ref<{ lat: number, lng: number } | null>(null)

// GET /leaks only returns open leaks.
const selected = computed(() => leaks.value.find(i => i.id === selectedId.value))
const inProgress = computed(() => leaks.value.filter(i => i.status === 'en_atencion').length)
// The API sorts by urgency; citizens get the newest first so the order doesn't hint at priority.
const recent = computed(() => leaks.value.toSorted((a, b) => b.first_reported_at.localeCompare(a.first_reported_at)))

function select(id: string) {
  selectedId.value = id
  mode.value = 'detail'
  const i = selected.value
  if (i) map.value?.flyTo(i)
}

// Set when the form is opened to confirm a specific leak ("Yo también la veo").
const confirmId = ref<string>()
function startReport(leak?: { id: string, lat: number, lng: number }) {
  confirmId.value = leak?.id
  mode.value = 'report'
  if (leak) map.value?.flyTo(leak, 17)
}

// Views swap inside the panel; move focus with them so keyboard/screen-reader users aren't dropped on <body>.
watch(mode, () => {
  if (snap.value !== 'half') settle('half')
  nextTick(() => sheet.value?.focus())
})

function finishReport(leakId: string) {
  select(leakId)
}
</script>

<template>
  <div class="relative h-dvh w-full overflow-hidden bg-default">
    <!-- Map: full screen, or a floating thumbnail on the mobile home. Sizes are explicit so they can transition. -->
    <div
      class="absolute isolate overflow-hidden transition-all ease-out motion-reduce:transition-none"
      :class="[
        mini ? 'bottom-4 right-4 h-36 w-28 rounded-2xl shadow-lg ring-1 ring-black/10 [&_.maplibregl-control-container]:hidden' : 'bottom-0 right-0 size-full',
        full && 'z-10'
      ]"
      :style="{ transitionDuration: `${instant ? 0 : GROW_MS}ms` }"
    >
      <MapView
        ref="map"
        :leaks="leaks"
        :selected-id="mode === 'detail' ? selectedId : null"
        :picking="mode === 'report'"
        :padding="padding"
        :overview="mini"
        locate
        @select="select"
        @center="center = $event"
        @tap="onMapTap"
      />
      <button
        v-if="mini"
        type="button"
        class="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gota-500"
        aria-label="Ampliar mapa"
        @click="mapOpen = true"
      >
        <span class="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-default text-highlighted shadow">
          <UIcon
            name="i-lucide-maximize-2"
            class="size-3.5"
          />
        </span>
      </button>
    </div>

    <!-- Top bar (mobile, over the open map) -->
    <header
      v-if="!tall"
      class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-3 lg:hidden"
    >
      <NuxtLink
        to="/"
        class="surface-float pointer-events-auto px-3 py-2"
        aria-label="Gota Urgente, inicio"
      >
        <AppLogo />
      </NuxtLink>
      <UButton
        v-if="mode === 'browse'"
        icon="i-lucide-minimize-2"
        color="neutral"
        variant="ghost"
        class="surface-float pointer-events-auto size-11 justify-center rounded-full!"
        aria-label="Minimizar mapa"
        @click="mapOpen = false"
      />
    </header>

    <!-- Sheet (mobile) / floating panel (desktop) -->
    <aside
      ref="sheet"
      tabindex="-1"
      class="surface-float outline-none absolute inset-x-0 bottom-0 flex flex-col rounded-b-none! lg:inset-y-4 lg:left-4 lg:right-auto lg:max-h-none lg:w-[400px] lg:rounded-b-2xl!"
      :class="[
        tall ? 'h-dvh max-h-dvh rounded-none! shadow-none!' : low ? 'max-h-24 overflow-hidden' : 'max-h-[56dvh]',
        snapping && 'transition-[height,max-height] duration-250 ease-out motion-reduce:transition-none'
      ]"
      :style="drag == null ? undefined : { height: `${drag}px`, maxHeight: `${drag}px` }"
      aria-label="Panel de reportes"
    >
      <!-- Grabber: drag, tap or press Enter to pull the sheet over the whole screen and back. -mb-4 lets its 44px hit area overlap the padding below. -->
      <button
        v-if="!full"
        type="button"
        class="relative z-10 -mb-4 flex h-11 w-full shrink-0 cursor-grab touch-none justify-center pt-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary lg:hidden"
        :aria-label="pulledUp ? 'Bajar el panel para ver el mapa' : low ? 'Subir el panel' : 'Subir el panel a pantalla completa'"
        :aria-expanded="!low"
        @pointerdown="onGrab"
        @pointermove="onDrag"
        @pointerup="onRelease"
        @pointercancel="settle(snap)"
        @click="onTap"
      >
        <span class="h-1 w-9 rounded-full bg-(--ui-border-accented)" />
      </button>

      <ReportForm
        v-if="mode === 'report'"
        :center="center"
        :leak-id="confirmId"
        @cancel="mode = 'browse'"
        @locate="map?.flyTo($event, 17)"
        @done="finishReport"
      />

      <!-- Leak detail -->
      <div
        v-else-if="mode === 'detail' && selected"
        class="flex min-h-0 flex-1 flex-col"
      >
        <header class="flex items-center gap-2 px-4 pb-2 pt-4">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            class="size-11 justify-center"
            aria-label="Volver a la lista"
            @click="mode = 'browse'"
          />
        </header>
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6">
          <div class="space-y-3">
            <h2 class="text-2xl font-bold leading-tight tracking-tight text-highlighted">
              {{ addressOf(selected) ?? fmtCoords(selected) }}
            </h2>
            <p class="text-muted">
              {{ SEVERITY[selected.max_severity].label }} · reportada {{ timeAgo(Date.parse(selected.first_reported_at)) }}
            </p>
          </div>

          <!-- Citizens see what and where, plus whether it's being fixed. Priority and metrics are for the dashboard. -->
          <div class="rounded-xl bg-muted p-4">
            <p class="text-sm text-muted">
              Estado
            </p>
            <div class="mt-1">
              <StatusSteps :status="selected.status" />
            </div>
          </div>

          <img
            v-if="selected.photo_url"
            :src="selected.photo_url"
            alt="Foto más reciente de la fuga"
            class="aspect-video w-full rounded-xl object-cover"
          >
        </div>
        <footer class="space-y-2 border-t border-default p-4">
          <!-- One vote per device: the API would answer 409, so say it up front. -->
          <p
            v-if="hasReported(selected.id)"
            class="flex items-center justify-center gap-2 rounded-xl bg-muted p-3 font-medium text-highlighted"
          >
            <UIcon
              name="i-lucide-circle-check"
              class="size-5"
            />
            Ya reportaste esta fuga. ¡Gracias!
          </p>
          <template v-else>
            <UButton
              block
              size="xl"
              color="primary"
              icon="i-lucide-hand"
              label="Yo también la veo"
              @click="startReport(selected)"
            />
          </template>
        </footer>
      </div>

      <!-- Browse -->
      <template v-else>
        <div
          v-show="!low"
          class="space-y-5 p-6 pb-4"
        >
          <div :class="full ? '' : 'hidden lg:block'">
            <AppLogo />
          </div>
          <div class="space-y-1">
            <h1 class="text-[28px] font-bold leading-tight tracking-tight text-balance text-highlighted">
              ¿Viste una fuga de agua?
            </h1>
            <p class="text-muted">
              Repórtala en menos de un minuto. Juntamos los reportes de la misma fuga para repararla antes.
            </p>
          </div>
          <UButton
            block
            size="xl"
            color="primary"
            icon="i-lucide-droplet"
            label="Reportar una fuga"
            @click="startReport()"
          />
        </div>

        <div
          class="flex items-baseline justify-between px-6 pb-2 pt-4"
          :class="low ? '' : 'border-t border-default'"
        >
          <h2 class="font-semibold text-highlighted">
            Fugas activas
          </h2>
          <span class="text-sm text-muted tabular-nums">{{ leaks.length }} activas · {{ inProgress }} en reparación</span>
        </div>

        <!-- pb-44: lets the last rows scroll clear of the floating mini map. -->
        <ul
          v-show="!low"
          class="min-h-0 flex-1 overflow-y-auto px-3"
          :class="mini ? 'pb-44' : 'pb-3'"
        >
          <li
            v-for="i in recent"
            :key="i.id"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted active:bg-elevated focus-visible:outline-2 focus-visible:outline-gota-500"
              @click="select(i.id)"
            >
              <SeverityIcon :severity="i.max_severity" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-highlighted">{{ addressOf(i) ?? fmtCoords(i) }}</span>
                <span class="block truncate text-sm text-muted">
                  {{ SEVERITY[i.max_severity].label }} · {{ i.status === 'en_atencion' ? 'En reparación' : `Reportada ${timeAgo(Date.parse(i.first_reported_at))}` }}
                </span>
              </span>
            </button>
          </li>
          <li
            v-if="error"
            class="space-y-3 p-6 text-center text-muted"
          >
            <p>{{ apiErrorMessage(error, 'No pudimos cargar las fugas.') }}</p>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-refresh-cw"
              label="Reintentar"
              :loading="loadStatus === 'pending'"
              @click="refresh()"
            />
          </li>
          <template v-else-if="loadStatus === 'pending' && !leaks.length">
            <li
              v-for="n in 4"
              :key="n"
              class="flex items-center gap-3 p-3"
            >
              <USkeleton class="size-11 rounded-drop" />
              <span class="flex-1 space-y-2">
                <USkeleton class="h-4 w-3/4" />
                <USkeleton class="h-3 w-1/2" />
              </span>
            </li>
          </template>
          <li
            v-else-if="!leaks.length"
            class="p-6 text-center text-muted"
          >
            No hay fugas activas. Si ves una, repórtala.
          </li>
        </ul>
      </template>
    </aside>
  </div>
</template>
