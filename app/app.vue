<script setup lang="ts">
import { es } from '@nuxt/ui/locale'

useHead({
  htmlAttrs: { lang: 'es-MX' },
  link: [{ rel: 'icon', href: '/favicon.ico' }]
})
useSeoMeta({
  title: 'Gota Urgente',
  description: 'Reporta fugas de agua en tu calle. Agrupamos reportes cercanos y priorizamos las reparaciones.'
})
</script>

<template>
  <UApp
    :locale="es"
    :toaster="{ position: 'top-center' }"
  >
    <NuxtPage />
  </UApp>
</template>
