<script setup lang="ts">
import { message } from 'ant-design-vue';
import dayjs from 'dayjs';
import { onMounted, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as conversationsApi from '@/api/modules/conversations';
import * as groupsApi from '@/api/modules/groups';
import * as modelsApi from '@/api/modules/providers';
import * as usageApi from '@/api/modules/usage';
import * as usersApi from '@/api/modules/users';
import type { AuditEntry, ModelSummary } from '@/api/types';
import { USE_MOCK } from '@/config';
import { formatDateTime } from '@/utils/format';

/** 仪表盘：全部数据来自契约接口（F0 健康页）；后端无分页字段，总数由客户端计算。
 * 数据来源随 USE_MOCK 开关动态标注（mock 契约接口 / Core API），真实模式联调时不误标为 mock。 */
const dataSourceLabel = USE_MOCK ? 'mock 契约接口' : 'Core API';
const loading = ref(false);
const loadError = ref('');
const stats = ref({
  users: 0,
  activeUsers: 0,
  groups: 0,
  models: 0,
  enabledModels: 0,
  conversations: 0,
  todayCalls: 0,
});
const recentAudit = ref<AuditEntry[]>([]);
const auditLoading = ref(false);

function actorLabel(entry: AuditEntry): string {
  return entry.actor_username ?? entry.actor_id;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const [users, groups, models, conversations, usage, audit] = await Promise.all([
      usersApi.listUsers({ page: 1, page_size: 1 }),
      groupsApi.listGroups({ page: 1, page_size: 1 }),
      modelsApi.listModels(),
      conversationsApi.listConversations({ page: 1, page_size: 1 }),
      usageApi.listUsage({
        from: `${dayjs().format('YYYY-MM-DD')}T00:00:00Z`,
        page: 1,
        page_size: 1,
      }),
      conversationsApi.listAudit({ page: 1, page_size: 8 }),
    ]);
    stats.value.users = users.total;
    stats.value.groups = groups.total;
    stats.value.models = models.items.length;
    stats.value.enabledModels = models.items.filter((m: ModelSummary) => m.enabled).length;
    stats.value.conversations = conversations.total;
    stats.value.todayCalls = usage.summary.calls;
    recentAudit.value = audit.items;
  } catch (err) {
    loadError.value = toApiError(err).displayMessage;
  } finally {
    loading.value = false;
  }
}

async function loadActiveUsers(): Promise<void> {
  try {
    const active = await usersApi.listUsers({ status: 'active', page: 1, page_size: 1 });
    stats.value.activeUsers = active.total;
  } catch {
    stats.value.activeUsers = 0;
  }
}

onMounted(() => {
  auditLoading.value = true;
  void load().finally(() => {
    auditLoading.value = false;
  });
  void loadActiveUsers();
  message.config({ maxCount: 3 });
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          仪表盘
        </h2>
        <p class="page-subtitle">
          Terminal Agent Hub 管理总览（数据来自 {{ dataSourceLabel }}）
        </p>
      </div>
      <a-button
        :loading="loading"
        @click="load"
      >
        刷新
      </a-button>
    </div>

    <a-alert
      v-if="loadError"
      type="error"
      show-icon
      :message="loadError"
      style="margin-bottom: 16px"
    />

    <a-spin :spinning="loading">
      <a-row :gutter="16">
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="用户总数"
              :value="stats.users"
              :suffix="`（启用 ${stats.activeUsers}）`"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="用户组"
              :value="stats.groups"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="模型（已启用）"
              :value="stats.models"
              :suffix="`（启用 ${stats.enabledModels}）`"
            />
          </a-card>
        </a-col>
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="会话总数"
              :value="stats.conversations"
            />
          </a-card>
        </a-col>
      </a-row>

      <a-card
        title="最近审计"
        style="margin-top: 16px"
      >
        <a-table
          :data-source="recentAudit"
          :loading="auditLoading"
          :pagination="false"
          row-key="id"
          size="small"
          :locale="{ emptyText: '暂无审计记录' }"
        >
          <a-table-column
            title="时间"
            :width="170"
          >
            <template #default="{ record }">
              {{ record.created_at ? formatDateTime(record.created_at) : '—' }}
            </template>
          </a-table-column>
          <a-table-column
            key="actor"
            title="操作者"
            :width="140"
          >
            <template #default="{ record }">
              {{ actorLabel(record) }}
            </template>
          </a-table-column>
          <a-table-column
            title="动作"
            data-index="action"
            :width="170"
          />
          <a-table-column
            key="object"
            title="对象"
            :width="200"
          >
            <template #default="{ record }">
              {{ record.object_type }}<template v-if="record.object_id">
                / {{ record.object_id }}
              </template>
            </template>
          </a-table-column>
          <a-table-column
            title="结果"
            data-index="result"
            :width="90"
          >
            <template #default="{ text }">
              <a-tag :color="text === 'success' ? 'green' : 'red'">
                {{ text === 'success' ? '成功' : '失败' }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column
            title="trace ID"
            data-index="trace_id"
          />
        </a-table>
      </a-card>
    </a-spin>
  </div>
</template>
