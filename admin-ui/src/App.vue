<script setup lang="ts">
import { CONFIG_PROVIDER_LOCALE, theme } from '@/app/antd';
</script>

<template>
  <a-config-provider
    :locale="CONFIG_PROVIDER_LOCALE"
    :theme="theme"
  >
    <router-view />
  </a-config-provider>
</template>
