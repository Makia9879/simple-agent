<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="not-found-page">
    <a-result
      status="404"
      title="404"
      sub-title="页面不存在或已被移除。"
    >
      <template #extra>
        <a-button
          type="primary"
          @click="router.push('/dashboard')"
        >
          回仪表盘
        </a-button>
      </template>
    </a-result>
  </div>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f6fa;
}
</style>
