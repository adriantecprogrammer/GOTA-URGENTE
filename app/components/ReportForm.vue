<script setup lang="ts">
import { useDebounceFn, useObjectUrl } from '@vueuse/core'
import type { NearbyResult } from '~/services/leaks'
import { hasReported, type CreateReportResult } from '~/services/reports'

interface Point { lat: number, lng: number }

/** `leakId`: opened from "Yo también la veo", so the form starts confirming that leak. */
const props = defineProps<{ center: Point | null, leakId?: string }>()
const emit = defineEmits<{ cancel: [], locate: [pos: Point], done: [leakId: string] }>()

const { $api } = useNuxtApp()
const toast = useToast()

const severity = ref<Severity>()
const photo = ref<File | null>(null)
const photoUrl = useObjectUrl(photo)
// Photo of an existing leak shown full size, so the person can tell whether it's the one in front of them.
const zoomed = ref<string | null>(null)

// Two native inputs: `capture` opens the rear camera straight away (Android's photo picker hides the camera
// when only `accept="image/*"` is given); the other one opens the gallery.
function pickPhoto(e: Event) {
  const input = e.target as HTMLInputElement
  photo.value = input.files?.[0] ?? null
  input.value = '' // so picking the same file again still fires `change`
}
const note = ref('')
const address = ref<string>()
const locating = ref(false)
const sending = ref(false)
const result = ref<CreateReportResult>()

// The pin counts as GPS only while it sits where the phone put it; once the map is dragged it's manual.
const gps = ref<Point & { accuracy: number }>()
const location = computed(() => gps.value && props.center && distanceM(gps.value, props.center) < 2
  ? { accuracy: gps.value.accuracy, source: 'gps' as const }
  : { source: 'manual' as const })

// Duplicate pre-check. `target`: leak id to confirm, NEW for "Es otra fuga", undefined = nothing nearby (new leak).
const NEW = 'new'
const nearby = ref<NearbyResult>()
const target = ref<string | undefined>(props.leakId)
// Once the person picks, pin moves don't override their choice.
const picked = ref(!!props.leakId)
const candidates = computed(() => nearby.value ? [nearby.value.exact, ...nearby.value.ambiguous].filter(c => !!c) : [])
const confirming = computed(() => !!target.value && target.value !== NEW)
// Leaks around: the person must say whether it's one of them (the ambiguous band is decided by them, not by a radius).
const mustChoose = computed(() => candidates.value.length > 0 && !target.value)
// A confirmation only asks for severity, prefilled with the leak's: "ya no es goteo, ahora es chorro".
// Prefill follows the chosen leak until the person touches the severity themselves.
const severityTouched = ref(false)
watch([target, candidates], ([id]) => {
  const c = candidates.value.find(c => c.id === id)
  if (c && !severityTouched.value) severity.value = c.max_severity
})

let seq = 0
const lookup = useDebounceFn(async (p: Point) => {
  const n = ++seq
  const [a, near] = await Promise.all([
    reverseGeocode(p),
    $api.leaks.nearby({ ...p, ...location.value }).catch(() => undefined)
  ])
  if (n !== seq) return // the pin moved again meanwhile
  address.value = a ?? fmtCoords(p)
  nearby.value = near
  if (!picked.value) target.value = near?.exact && !hasReported(near.exact.id) ? near.exact.id : undefined
}, 500)

function pick(id: string) {
  picked.value = true
  target.value = id
}
watch(() => props.center, (p) => {
  if (!p) return
  address.value = undefined
  lookup(p)
}, { immediate: true })

function useMyLocation() {
  if (!navigator.geolocation) return toast.add({ title: 'Tu navegador no permite ubicación', color: 'error' })
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      gps.value = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
      emit('locate', gps.value)
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

/** The API takes up to 5 MB but asks for ~800 px / ~200 KB. */
async function compress(file: File, max = 800) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
}

async function submit() {
  if (!props.center || !severity.value) return
  sending.value = true
  try {
    // A confirmation carries no photo or note: the leak already has them.
    const photoKey = !confirming.value && photo.value ? (await $api.uploads.photo(await compress(photo.value))).photo_key : undefined
    result.value = await $api.reports.create({
      ...props.center,
      ...location.value,
      severity: severity.value,
      photo_key: photoKey,
      note: (!confirming.value && note.value.trim()) || undefined,
      leak_id: confirming.value ? target.value : undefined,
      force_new: target.value === NEW || undefined
    })
    refreshNuxtData('leaks')
  } catch (e) {
    toast.add({ title: confirming.value ? 'No se pudo confirmar' : 'No se pudo enviar el reporte', description: apiErrorMessage(e), color: 'error' })
    // Already voted (409): the card now shows "Ya la reportaste"; let them pick again.
    if (confirming.value && hasReported(target.value!)) {
      target.value = undefined
      picked.value = false
    }
  } finally {
    sending.value = false
  }
}

function reset() {
  result.value = undefined
  severity.value = undefined
  photo.value = null
  note.value = ''
  severityTouched.value = false
  target.value = undefined
  picked.value = false
  if (props.center) lookup(props.center)
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
        {{ result.action === 'confirmed' ? 'Fuga confirmada' : 'Reporte enviado' }}
      </h2>
      <p class="text-muted">
        {{ result.action === 'confirmed' ? 'Gracias por confirmarla: así la cuadrilla sabe que sigue ahí.' : 'Gracias por cuidar el agua de tu colonia. La cuadrilla ya puede verla.' }}
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <UButton
        block
        size="xl"
        color="primary"
        label="Ver en el mapa"
        @click="emit('done', result.leak_id)"
      />
      <UButton
        block
        size="xl"
        color="neutral"
        variant="ghost"
        label="Hacer otro reporte"
        @click="reset"
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
        {{ confirming ? 'Confirmar fuga' : 'Reportar fuga' }}
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
          v-if="nearby?.must_drag_pin"
          color="warning"
          variant="subtle"
          icon="i-lucide-crosshair"
          title="Tu GPS es impreciso"
          description="Mueve el mapa para dejar el pin justo sobre la fuga."
        />
        <UAlert
          v-if="nearby?.resolved"
          color="neutral"
          variant="subtle"
          icon="i-lucide-history"
          description="Aquí ya se reparó una fuga antes. Tu reporte avisará que volvió a aparecer."
        />
      </section>

      <!-- 1b. Duplicates: asked BEFORE severity/photo, so nobody fills a form only to learn it already exists. -->
      <fieldset
        v-if="candidates.length"
        class="space-y-3"
      >
        <legend class="mb-1 text-base font-semibold text-highlighted">
          {{ nearby?.exact ? 'Ya se reportó una fuga aquí' : 'Hay fugas reportadas cerca' }}
        </legend>
        <p class="mb-3 text-sm text-muted">
          ¿Es la misma que ves? Confírmala con un toque.
        </p>
        <label
          v-for="c in candidates"
          :key="c.id"
          class="relative flex items-center gap-3 rounded-xl p-3 ring-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gota-500"
          :class="[
            target === c.id ? 'bg-default ring-inverted' : 'bg-muted ring-transparent',
            hasReported(c.id) ? 'opacity-60' : 'cursor-pointer hover:bg-elevated'
          ]"
        >
          <input
            type="radio"
            name="target"
            :value="c.id"
            :checked="target === c.id"
            :disabled="hasReported(c.id)"
            class="sr-only"
            @change="pick(c.id)"
          >
          <!-- Own button inside the card: .prevent keeps the tap from also picking this leak. -->
          <button
            v-if="c.photo_url"
            type="button"
            class="relative size-16 shrink-0 overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gota-500"
            aria-label="Ver foto en grande"
            @click.prevent="zoomed = c.photo_url"
          >
            <img
              :src="c.photo_url"
              alt=""
              class="size-full object-cover"
            >
            <span class="absolute bottom-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white">
              <UIcon
                name="i-lucide-maximize-2"
                class="size-3.5"
              />
            </span>
          </button>
          <SeverityIcon
            v-else
            :severity="c.max_severity"
            class="bg-default!"
          />
          <span class="min-w-0 flex-1">
            <span class="block font-semibold text-highlighted">{{ hasReported(c.id) ? 'Ya la reportaste' : 'Sí, es esta' }}</span>
            <span class="block text-sm text-muted">{{ SEVERITY[c.max_severity].label }} · a {{ Math.round(c.distance_m) }} m</span>
          </span>
          <UIcon
            v-if="target === c.id"
            name="i-lucide-circle-check"
            class="size-5 text-highlighted"
          />
        </label>
        <label
          class="relative flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gota-500"
          :class="target === NEW ? 'bg-default ring-inverted' : 'bg-muted ring-transparent hover:bg-elevated'"
        >
          <input
            type="radio"
            name="target"
            :value="NEW"
            :checked="target === NEW"
            class="sr-only"
            @change="pick(NEW)"
          >
          <span class="min-w-0 flex-1">
            <span class="block font-semibold text-highlighted">No, es otra fuga</span>
            <span class="block text-sm text-muted">La reportas como nueva, con foto</span>
          </span>
          <UIcon
            v-if="target === NEW"
            name="i-lucide-circle-check"
            class="size-5 text-highlighted"
          />
        </label>
      </fieldset>

      <!-- 2. Severity -->
      <fieldset class="space-y-3">
        <legend class="mb-3 text-base font-semibold text-highlighted">
          {{ confirming ? '¿Cuánta agua se pierde ahora?' : '¿Cuánta agua se pierde?' }}
          <span
            v-if="confirming"
            class="block text-sm font-normal text-muted"
          >Si empeoró, cámbialo</span>
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
            @change="severityTouched = true"
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

      <!-- 3. Photo (new leaks only) -->
      <section
        v-if="!confirming"
        class="space-y-3"
      >
        <div class="flex items-baseline justify-between">
          <h3 class="text-base font-semibold text-highlighted">
            Foto
          </h3>
          <span class="text-sm text-muted">Recomendada</span>
        </div>
        <div
          v-if="photoUrl"
          class="relative"
        >
          <img
            :src="photoUrl"
            alt="Foto de la fuga"
            class="aspect-video w-full rounded-xl object-cover"
          >
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="solid"
            class="absolute right-2 top-2 size-11 justify-center rounded-full!"
            aria-label="Quitar foto"
            @click="photo = null"
          />
        </div>
        <template v-else>
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="opt in [{ label: 'Tomar foto', icon: 'i-lucide-camera', camera: true }, { label: 'Galería', icon: 'i-lucide-image', camera: false }]"
              :key="opt.label"
              class="relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted p-3 font-semibold text-highlighted transition-colors hover:bg-elevated has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gota-500"
            >
              <input
                type="file"
                accept="image/*"
                :capture="opt.camera ? 'environment' : undefined"
                class="sr-only"
                @change="pickPhoto"
              >
              <UIcon
                :name="opt.icon"
                class="size-6"
              />
              {{ opt.label }}
            </label>
          </div>
          <p class="text-sm text-muted">
            Ayuda a la cuadrilla a llegar preparada
          </p>
        </template>
      </section>

      <!-- 4. Notes (new leaks only) -->
      <section
        v-if="!confirming"
        class="space-y-3"
      >
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
        :disabled="!severity || !center || nearby?.must_drag_pin || mustChoose"
        :label="mustChoose ? 'Dinos si es la misma fuga' : !severity ? 'Elige cuánta agua se pierde' : confirming ? 'Confirmar esta fuga' : 'Enviar reporte'"
      />
    </footer>
  </form>

  <UModal
    :open="!!zoomed"
    title="Foto de la fuga reportada"
    @update:open="v => !v && (zoomed = null)"
  >
    <template #body>
      <img
        v-if="zoomed"
        :src="zoomed"
        alt="Foto de la fuga reportada"
        class="max-h-[70dvh] w-full rounded-lg object-contain"
      >
    </template>
  </UModal>
</template>
