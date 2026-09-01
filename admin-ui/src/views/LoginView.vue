<script setup lang="ts">
import { LockOutlined, UserOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { toApiError } from '@/api/errors';
import { USE_MOCK } from '@/config';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const formState = reactive({
  username: '',
  password: '',
});
const submitting = ref(false);
const loginError = ref('');

const mockAccounts = USE_MOCK
  ? [
      { username: 'admin', password: 'admin123', note: '管理员：可进入后台' },
      { username: 'alice', password: 'alice123', note: '普通用户：登录后台会被拒绝' },
      { username: 'bob', password: 'bob123', note: '已禁用账号：登录被拒绝' },
    ]
  : [];

async function handleSubmit(): Promise<void> {
  loginError.value = '';
  if (!formState.username || !formState.password) {
    loginError.value = '请输入用户名和密码';
    return;
  }
  submitting.value = true;
  try {
    const user = await auth.login(formState.username, formState.password);
    if (user.role !== 'admin') {
      // AU-01：普通用户登录成功，但无权进入后台
      message.warning('登录成功，但该账号不是管理员，无法访问后台');
      await router.push({ path: '/403' });
      return;
    }
    message.success(`欢迎，${user.username}`);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    await router.push(redirect);
  } catch (err) {
    const apiError = toApiError(err);
    loginError.value = apiError.displayMessage;
  } finally {
    submitting.value = false;
  }
}

function fillAccount(username: string, password: string): void {
  formState.username = username;
  formState.password = password;
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="title">
        Terminal Agent Hub
      </h1>
      <p class="subtitle">
        管理后台 · 仅管理员可登录
      </p>
      <a-form
        layout="vertical"
        @submit.prevent="handleSubmit"
      >
        <a-form-item
          label="用户名"
          required
        >
          <a-input
            v-model:value="formState.username"
            size="large"
            placeholder="用户名"
            autocomplete="username"
            @press-enter="handleSubmit"
          >
            <template #prefix>
              <UserOutlined />
            </template>
          </a-input>
        </a-form-item>
        <a-form-item
          label="密码"
          required
        >
          <a-input-password
            v-model:value="formState.password"
            size="large"
            placeholder="密码"
            autocomplete="current-password"
            @press-enter="handleSubmit"
          >
            <template #prefix>
              <LockOutlined />
            </template>
          </a-input-password>
        </a-form-item>
        <a-alert
          v-if="loginError"
          type="error"
          :message="loginError"
          show-icon
          style="margin-bottom: 16px"
        />
        <a-button
          type="primary"
          size="large"
          block
          :loading="submitting"
          @click="handleSubmit"
        >
          登录
        </a-button>
      </a-form>
      <div
        v-if="mockAccounts.length > 0"
        class="mock-accounts"
      >
        <p>Mock 账号（点击填充）：</p>
        <a-tag
          v-for="account in mockAccounts"
          :key="account.username"
          class="account-tag"
          @click="fillAccount(account.username, account.password)"
        >
          {{ account.username }} / {{ account.password }} · {{ account.note }}
        </a-tag>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1c2536 0%, #2f54eb 100%);
}

.login-card {
  width: 380px;
  background: #fff;
  border-radius: 10px;
  padding: 32px 32px 24px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.title {
  margin: 0;
  text-align: center;
  font-size: 20px;
}

.subtitle {
  margin: 6px 0 24px;
  text-align: center;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}

.mock-accounts {
  margin-top: 18px;
  border-top: 1px dashed rgba(0, 0, 0, 0.12);
  padding-top: 12px;
}

.mock-accounts p {
  margin: 0 0 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.account-tag {
  cursor: pointer;
  margin-bottom: 6px;
  white-space: normal;
}
</style>
