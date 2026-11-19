import { useIntervalFn } from '@vueuse/core'

/** Polling interval until MQTT exists; MQTT will only ring the bell, the data always comes from the API. */
export const POLL_MS = 10_000

/** Citizen map: open leaks (pendiente + en_atencion), most urgent first. Refresh anywhere with `refreshNuxtData('leaks')`. */
export function useLeaks() {
  const { $api } = useNuxtApp()
  // ponytail: loads the whole city; pass the map bbox to $api.leaks.list() once there are thousands of pins.
  const res = useAsyncData('leaks', () => $api.leaks.list(), { default: () => [] })
  useIntervalFn(() => res.refresh(), POLL_MS)
  watch(res.data, leaks => queueAddresses(leaks), { immediate: true })
  return res
}
