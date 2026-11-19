<script setup lang="ts">
import { useElementSize, useMediaQuery } from '@vueuse/core'

const { incidents } = useReports()
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
const growing = ref(false)
watch(mini, (m) => {
  growing.value = !m
  if (!m) setTimeout(() => (growing.value = false), GROW_MS)
})
const full = computed(() => mini.value || growing.value)
const padding = computed(() => desktop.value
  ? { left: 432, bottom: 0 }
  : { left: 0, bottom: full.value ? 0 : Math.round(sheetH.value) })
const selectedId = ref<string | null>(null)
const center = ref<{ lat: number, lng: number } | null>(null)

const active = computed(() => incidents.value.filter(i => i.status !== 'resuelto'))
const selected = computed(() => incidents.value.find(i => i.id === selectedId.value))
const inProgress = computed(() => active.value.filter(i => i.status === 'atencion').length)

function select(id: string) {
  selectedId.value = id
  mode.value = 'detail'
  const i = selected.value
  if (i) map.value?.flyTo(i)
}

function startReport(at?: { lat: number, lng: number }) {
  mode.value = 'report'
  if (at) map.value?.flyTo(at, 17)
}

// Views swap inside the panel; move focus with them so keyboard/screen-reader users aren't dropped on <body>.
watch(mode, () => nextTick(() => sheet.value?.focus()))

function finishReport(i: Incident) {
  select(i.id)
}
</script>

<template>
  <div class="relative h-dvh w-full overflow-hidden bg-default">
    <!-- Map: full screen, or a floating thumbnail on the mobile home. Sizes are explicit so they can transition. -->
    <div
      class="absolute overflow-hidden transition-all ease-out motion-reduce:transition-none"
      :class="[
        mini ? 'bottom-4 right-4 h-36 w-28 rounded-2xl shadow-lg ring-1 ring-black/10 [&_.maplibregl-control-container]:hidden' : 'bottom-0 right-0 size-full',
        full && 'z-10'
      ]"
      :style="{ transitionDuration: `${GROW_MS}ms` }"
    >
      <MapView
        ref="map"
        :incidents="incidents"
        :selected-id="mode === 'detail' ? selectedId : null"
        :picking="mode === 'report'"
        :padding="padding"
        :overview="mini"
        @select="select"
        @center="center = $event"
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
      v-if="!full"
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
      :class="full ? 'h-dvh rounded-none! shadow-none!' : 'max-h-[56dvh] max-lg:animate-[sheet-in_.25s_ease-out] motion-reduce:animate-none'"
      aria-label="Panel de reportes"
    >
      <ReportForm
        v-if="mode === 'report'"
        :center="center"
        @cancel="mode = 'browse'"
        @locate="map?.flyTo($event, 17)"
        @done="finishReport"
      />

      <!-- Incident detail -->
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
          <span class="text-sm font-medium text-muted tabular-nums">{{ selected.id }}</span>
        </header>
        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6">
          <div class="space-y-3">
            <div class="flex items-center gap-3">
              <UrgencyScore
                :incident="selected"
                size="lg"
              />
              <p class="text-sm text-muted">
                <span class="block text-base font-semibold text-highlighted">
                  {{ selected.status === 'resuelto' ? 'Fuga resuelta' : `Urgencia ${LEVEL[selected.level].label.toLowerCase()}` }}
                </span>
                {{ selected.urgency }} de 100
              </p>
            </div>
            <h2 class="text-2xl font-bold leading-tight tracking-tight text-highlighted">
              {{ selected.address ?? fmtCoords(selected) }}
            </h2>
            <p class="text-muted">
              {{ SEVERITY[selected.severity].label }} · reportada {{ timeAgo(selected.firstAt) }}
            </p>
          </div>

          <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-(--ui-border)">
            <div class="bg-muted p-4">
              <dt class="text-sm text-muted">
                Reportes
              </dt>
              <dd class="display text-2xl font-bold text-highlighted tabular-nums">
                {{ selected.reports.length }}
              </dd>
            </div>
            <div class="bg-muted p-4">
              <dt class="text-sm text-muted">
                Estado
              </dt>
              <dd class="mt-1">
                <StatusSteps :status="selected.status" />
              </dd>
            </div>
          </dl>

          <div
            v-if="selected.reports.some(r => r.photo)"
            class="grid grid-cols-3 gap-2"
          >
            <img
              v-for="r in selected.reports.filter(r => r.photo)"
              :key="r.id"
              :src="r.photo"
              :alt="`Foto del reporte ${r.id}`"
              class="aspect-square w-full rounded-lg object-cover"
            >
          </div>
        </div>
        <footer
          v-if="selected.status !== 'resuelto'"
          class="space-y-2 border-t border-default p-4"
        >
          <UButton
            block
            size="xl"
            color="primary"
            icon="i-lucide-hand"
            label="Yo también la veo"
            @click="startReport(selected)"
          />
          <p class="text-center text-xs text-muted">
            Confirmarla sube su prioridad
          </p>
        </footer>
      </div>

      <!-- Browse -->
      <template v-else>
        <div class="space-y-5 p-6 pb-4">
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

        <div class="flex items-baseline justify-between border-t border-default px-6 pb-2 pt-4">
          <h2 class="font-semibold text-highlighted">
            Fugas activas
          </h2>
          <span class="text-sm text-muted tabular-nums">{{ active.length }} activas · {{ inProgress }} en reparación</span>
        </div>

        <!-- pb-44: lets the last rows scroll clear of the floating mini map. -->
        <ul
          class="min-h-0 flex-1 overflow-y-auto px-3"
          :class="mini ? 'pb-44' : 'pb-3'"
        >
          <li
            v-for="i in active"
            :key="i.id"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted active:bg-elevated focus-visible:outline-2 focus-visible:outline-gota-500"
              @click="select(i.id)"
            >
              <UrgencyScore :incident="i" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-highlighted">{{ i.address ?? fmtCoords(i) }}</span>
                <span class="block truncate text-sm text-muted">
                  {{ SEVERITY[i.severity].label }} · {{ i.reports.length }} {{ i.reports.length === 1 ? 'reporte' : 'reportes' }} · {{ i.status === 'atencion' ? 'En reparación' : timeAgo(i.firstAt) }}
                </span>
              </span>
            </button>
          </li>
          <li
            v-if="!active.length"
            class="p-6 text-center text-muted"
          >
            No hay fugas activas. Si ves una, repórtala.
          </li>
        </ul>
      </template>
    </aside>
  </div>
</template>
