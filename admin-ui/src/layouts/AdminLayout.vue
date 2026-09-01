<script setup lang="ts">
import {
  AuditOutlined,
  BarChartOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  GroupOutlined,
  LogoutOutlined,
  AppstoreOutlined,
  TeamOutlined,
  MessageOutlined,
} from '@ant-design/icons-vue';
import { computed, ref, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import MockControlPanel from '@/components/MockControlPanel.vue';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const selectedKeys = computed(() => {
  const path = route.path;
  if (path.startsWith('/users')) return ['users'];
  if (path.startsWith('/groups')) return ['groups'];
  if (path.startsWith('/providers')) return ['providers'];
  if (path.startsWith('/models')) return ['models'];
  if (path.startsWith('/usage')) return ['usage'];
  if (path.startsWith('/conversations')) return ['conversations'];
  if (path.startsWith('/audit')) return ['audit'];
  return ['dashboard'];
});

const collapsed = ref(false);

async function handleLogout(): Promise<void> {
  await auth.logout();
  await router.push({ path: '/login' });
}

interface MenuItem {
  key: string;
  label: string;
  title: string;
  icon: Component;
}

const menuItems: MenuItem[] = [
  { key: 'dashboard', label: '仪表盘', title: '仪表盘', icon: DashboardOutlined },
  { key: 'users', label: '用户管理', title: '用户管理', icon: TeamOutlined },
  { key: 'groups', label: '用户组管理', title: '用户组管理', icon: GroupOutlined },
  { key: 'providers', label: 'Provider 登记', title: 'Provider 登记（无密钥）', icon: CloudServerOutlined },
  { key: 'models', label: 'Model 与授权', title: 'Model 启停与授权', icon: AppstoreOutlined },
  { key: 'usage', label: '全局用量', title: '全局用量', icon: BarChartOutlined },
  { key: 'conversations', label: '会话审阅', title: '会话审阅', icon: MessageOutlined },
  { key: 'audit', label: '审计日志', title: '审计日志', icon: AuditOutlined },
];

function onMenuClick({ key }: { key: string | number }): void {
  void router.push({ path: `/${key}` });
}

const pageTitle = computed(
  () => menuItems.find((item) => item.key === selectedKeys.value[0])?.title ?? '管理后台',
);
</script>

<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      breakpoint="lg"
    >
      <div class="brand">
        <span v-if="!collapsed">Terminal Agent Hub</span>
        <span v-else>TAH</span>
      </div>
      <a-menu
        theme="dark"
        mode="inline"
        :selected-keys="selectedKeys"
        @click="onMenuClick"
      >
        <a-menu-item
          v-for="item in menuItems"
          :key="item.key"
        >
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="app-header">
        <span class="app-title">{{ pageTitle }}</span>
        <a-dropdown>
          <span class="user-entry">
            <a-avatar
              :size="26"
              style="background-color: #2f54eb"
            >
              {{ auth.user?.username?.slice(0, 1).toUpperCase() ?? '?' }}
            </a-avatar>
            <span class="username">{{ auth.user?.username ?? '' }}（管理员）</span>
          </span>
          <template #overlay>
            <a-menu>
              <a-menu-item
                key="logout"
                @click="handleLogout"
              >
                <LogoutOutlined />
                退出登录
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>
      <a-layout-content class="app-content">
        <router-view />
      </a-layout-content>
    </a-layout>
    <MockControlPanel />
  </a-layout>
</template>

<style scoped>
.brand {
  height: 48px;
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  padding: 0 24px;
  height: 56px;
  line-height: 56px;
  border-bottom: 1px solid rgba(5, 5, 5, 0.06);
}

.app-title {
  font-size: 15px;
  font-weight: 600;
}

.user-entry {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 13px;
}

.app-content {
  overflow-y: auto;
}
</style>
