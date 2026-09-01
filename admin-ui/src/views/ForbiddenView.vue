<script setup lang="ts">
import { useRouter } from 'vue-router';

import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

async function backToLogin(): Promise<void> {
  await auth.logout();
  await router.push({ path: '/login' });
}
</script>

<template>
  <div class="forbidden-page">
    <a-result
      status="403"
      title="403"
      sub-title="该账号不是管理员，无权访问管理后台。"
    >
      <template #extra>
        <a-button
          type="primary"
          @click="backToLogin"
        >
          返回登录
        </a-button>
      </template>
    </a-result>
  </div>
</template>

<style scoped>
.forbidden-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f6fa;
}
</style>
