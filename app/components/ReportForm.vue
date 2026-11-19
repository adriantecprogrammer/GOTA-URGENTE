<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'

const props = defineProps<{ center: { lat: number, lng: number } | null }>()
const emit = defineEmits<{ cancel: [], locate: [pos: { lat: number, lng: number }], done: [incident: Incident] }>()

const { incidents, addReport } = useReports()
const toast = useToast()

const severity = ref<Severity>()
const photo = ref<File | null>(null)
const note = ref('')
const address = ref<string>()
const locating = ref(false)
const sending = ref(false)
const result = ref<Incident>()

// Existing open incident the new report would join → tell the citizen before they submit.
const nearby = computed(() => props.center && incidents.value.find(i =>
  i.status !== 'resuelto' && distanceM(i.reports[0]!, props.center!) <= CLUSTER_RADIUS_M))

// ponytail: public Nominatim, fine for demo traffic (1 req/s policy); proxy + cache it server-side for production.
const geocode = useDebounceFn(async (p: { lat: number, lng: number }) => {
  address.value = undefined
  const r = await $fetch<{ address?: Record<string, string> }>('https://nominatim.openstreetmap.org/reverse', {
    query: { 'format': 'jsonv2', 'lat': p.lat, 'lon': p.lng, 'zoom': 18, 'accept-language': 'es' }
  }).catch(() => null)
  const a = r?.address
  address.value = a?.road ? [`${a.road} ${a.house_number ?? ''}`.trim(), a.suburb ?? a.neighbourhood].filter(Boolean).join(', ') : fmtCoords(p)
}, 500)
watch(() => props.center, p => p && geocode(p), { immediate: true })

function useMyLocation() {
  if (!navigator.geolocation) return toast.add({ title: 'Tu navegador no permite ubicación', color: 'error' })
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      emit('locate', { lat: pos.coords.latitude, lng: pos.coords.longitude })
    },
    () => {
      locating.value = false
      toast.add({ title: 'No pudimos obtener tu ubicación', description: 'Mueve el mapa para colocar el pin manualmente.', color: 'warning' })
    },
    { enableHighAccuracy: true, timeout: 8000 }
  )
}

function cancel() {
  // ponytail: native confirm; swap for a UModal if the dialog needs branding.
  if (!(severity.value || photo.value || note.value) || confirm('¿Descartar este reporte?')) emit('cancel')
}

async function toDataUrl(file: File, max = 1024) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = Object.assign(document.createElement('canvas'), { width: bmp.width * k, height: bmp.height * k })
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.75)
}

async function submit() {
  if (!props.center || !severity.value) return
  sending.value = true
  try {
    result.value = addReport({
      ...props.center,
      severity: severity.value,
      address: address.value,
      note: note.value.trim() || undefined,
      photo: photo.value ? await toDataUrl(photo.value) : undefined
    })
  } catch {
    toast.add({ title: 'No se pudo guardar el reporte', description: 'Intenta con una foto más ligera.', color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <!-- Success -->
  <div
    v-if="result"
    role="status"
    class="flex flex-col gap-6 p-6"
  >
    <div class="grid size-12 place-items-center rounded-drop bg-inverted text-inverted">
      <UIcon
        name="i-lucide-check"
        class="size-6"
      />
    </div>
    <div class="space-y-1.5">
      <h2 class="text-2xl font-bold tracking-tight text-highlighted">
        Reporte enviado
      </h2>
      <p class="text-muted">
        Folio <span class="font-medium text-highlighted tabular-nums">{{ result.reports.at(-1)!.id }}</span>. Gracias por cuidar el agua de tu colonia.
      </p>
    </div>

    <div class="space-y-3 rounded-xl bg-muted p-4">
      <div class="flex items-center justify-between gap-3">
        <span class="font-semibold text-highlighted">Prioridad {{ LEVEL[result.level].label.toLowerCase() }}</span>
        <UrgencyScore :incident="result" />
      </div>
      <p class="text-sm text-muted">
        <template v-if="result.reports.length > 1">
          Tu reporte se sumó a <b class="text-highlighted">{{ result.reports.length - 1 }} {{ result.reports.length === 2 ? 'reporte' : 'reportes' }}</b> de la misma fuga, así que subió su prioridad.
        </template>
        <template v-else>
          Eres la primera persona en reportarla. Si alguien más la reporta, su prioridad subirá.
        </template>
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <UButton
        block
        size="xl"
        color="primary"
        label="Ver en el mapa"
        @click="emit('done', result)"
      />
      <UButton
        block
        size="xl"
        color="neutral"
        variant="ghost"
        label="Hacer otro reporte"
        @click="result = undefined; severity = undefined; photo = null; note = ''"
      />
    </div>
  </div>

  <!-- Form -->
  <form
    v-else
    class="flex min-h-0 flex-1 flex-col"
    @submit.prevent="submit"
  >
    <header class="flex items-center gap-2 px-4 pb-2 pt-4">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        class="size-11 justify-center"
        aria-label="Volver"
        @click="cancel"
      />
      <h2 class="text-xl font-bold tracking-tight text-highlighted">
        Reportar fuga
      </h2>
    </header>

    <div class="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 pb-6">
      <!-- 1. Location -->
      <section class="space-y-3">
        <h3 class="text-base font-semibold text-highlighted">
          ¿Dónde está la fuga?
        </h3>
        <div class="flex items-start gap-3 rounded-xl bg-muted p-3">
          <UIcon
            name="i-lucide-map-pin"
            class="mt-0.5 size-5 shrink-0 text-highlighted"
          />
          <div class="min-w-0 flex-1">
            <USkeleton
              v-if="!address"
              class="my-0.5 h-5 w-48"
            />
            <p
              v-else
              class="truncate font-medium text-highlighted"
            >
              {{ address }}
            </p>
            <p class="text-sm text-muted">
              Mueve el mapa para ajustar el pin
            </p>
          </div>
        </div>
        <UButton
          icon="i-lucide-locate-fixed"
          color="neutral"
          variant="soft"
          :loading="locating"
          class="min-h-11"
          label="Usar mi ubicación"
          @click="useMyLocation"
        />
        <UAlert
          v-if="nearby"
          color="info"
          variant="subtle"
          icon="i-lucide-users"
          :title="`Ya hay ${nearby.reports.length} ${nearby.reports.length === 1 ? 'reporte' : 'reportes'} aquí`"
          description="Confirmarla sube su prioridad para que la atiendan antes."
        />
      </section>

      <!-- 2. Severity -->
      <fieldset class="space-y-3">
        <legend class="mb-3 text-base font-semibold text-highlighted">
          ¿Cuánta agua se pierde?
        </legend>
        <label
          v-for="(s, key) in SEVERITY"
          :key="key"
          class="relative flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gota-500"
          :class="severity === key ? 'bg-default ring-inverted' : 'bg-muted ring-transparent hover:bg-elevated'"
        >
          <input
            v-model="severity"
            type="radio"
            name="severity"
            :value="key"
            class="sr-only"
            required
          >
          <SeverityIcon
            :severity="key"
            :class="severity === key ? 'bg-inverted! text-inverted!' : 'bg-default!'"
          />
          <span class="min-w-0 flex-1">
            <span class="block font-semibold text-highlighted">{{ s.label }}</span>
            <span class="block text-sm text-muted">{{ s.hint }}</span>
          </span>
          <UIcon
            v-if="severity === key"
            name="i-lucide-circle-check"
            class="size-5 text-highlighted"
          />
        </label>
      </fieldset>

      <!-- 3. Photo -->
      <section class="space-y-3">
        <div class="flex items-baseline justify-between">
          <h3 class="text-base font-semibold text-highlighted">
            Foto
          </h3>
          <span class="text-sm text-muted">Recomendada</span>
        </div>
        <UFileUpload
          v-model="photo"
          accept="image/*"
          icon="i-lucide-camera"
          label="Toma o sube una foto"
          description="Ayuda a la cuadrilla a llegar preparada"
          class="min-h-36 w-full"
        />
      </section>

      <!-- 4. Notes -->
      <section class="space-y-3">
        <div class="flex items-baseline justify-between">
          <h3 class="text-base font-semibold text-highlighted">
            Referencias
          </h3>
          <span class="text-sm text-muted">Opcional</span>
        </div>
        <UTextarea
          v-model="note"
          :rows="2"
          :maxlength="280"
          autoresize
          aria-label="Referencias"
          placeholder="Ej. frente a la tienda, sale del medidor"
          class="w-full"
        />
      </section>
    </div>

    <footer class="border-t border-default p-4">
      <UButton
        type="submit"
        block
        size="xl"
        color="primary"
        :loading="sending"
        :disabled="!severity || !center"
        :label="severity ? 'Enviar reporte' : 'Elige cuánta agua se pierde'"
      />
    </footer>
  </form>
</template>
