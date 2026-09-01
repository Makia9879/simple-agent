<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import { onMounted, reactive, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as conversationsApi from '@/api/modules/conversations';
import type { AuditAction, AuditEntry } from '@/api/types';
import { formatDateTime } from '@/utils/format';

/** F8 / AU-12：操作与审阅审计列表。 */
const loading = ref(false);
const rows = ref<AuditEntry[]>([]);
const total = ref(0);
const query = reactive({
  action: '' as '' | AuditAction,
  page: 1,
  page_size: 10,
});

const ACTION_OPTIONS: Array<{ value: AuditAction; label: string }> = [
  { value: 'LOGIN', label: '登录' },
  { value: 'LOGIN_FAILED', label: '登录失败' },
  { value: 'LOGOUT', label: '退出' },
  { value: 'USER_CREATE', label: '创建用户' },
  { value: 'USER_UPDATE', label: '更新用户' },
  { value: 'USER_DISABLE', label: '禁用用户' },
  { value: 'USER_ENABLE', label: '启用用户' },
  { value: 'USER_RESET_PASSWORD', label: '重置密码' },
  { value: 'GROUP_CREATE', label: '创建用户组' },
  { value: 'GROUP_UPDATE', label: '更新用户组' },
  { value: 'GROUP_MEMBERS_CHANGE', label: '调整组成员' },
  { value: 'PROVIDER_SYNC_SUCCESS', label: 'Provider 同步成功' },
  { value: 'PROVIDER_SYNC_FAILURE', label: 'Provider 同步失败' },
  { value: 'MODEL_ENABLE', label: '启用模型' },
  { value: 'MODEL_DISABLE', label: '停用模型' },
  { value: 'GRANT_CREATE', label: '新增授权' },
  { value: 'GRANT_DELETE', label: '撤销授权' },
  { value: 'CONVERSATION_REVIEW', label: '会话审阅' },
];

function actionColor(action: string): string {
  if (action === 'CONVERSATION_REVIEW') return 'geekblue';
  if (action === 'LOGIN_FAILED' || action === 'PROVIDER_SYNC_FAILURE') return 'red';
  if (action.startsWith('GRANT_')) return 'cyan';
  if (action.startsWith('MODEL_')) return 'purple';
  return 'blue';
}

function actionLabel(action: string): string {
  return ACTION_OPTIONS.find((o) => o.value === action)?.label ?? action;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await conversationsApi.listAudit({
      action: query.action || undefined,
      page: query.page,
      page_size: query.page_size,
    });
    rows.value = result.items;
    total.value = result.total;
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  } finally {
    loading.value = false;
  }
}

function onSearch(): void {
  query.page = 1;
  void load();
}

function onTableChange(pagination: TablePaginationConfig): void {
  query.page = pagination.current ?? 1;
  query.page_size = pagination.pageSize ?? 10;
  void load();
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          审计日志
        </h2>
        <p class="page-subtitle">
          记录登录、用户/组变更、Model 启停、授权、Provider 同步与会话审阅；打开会话正文后可在此看到对应审阅记录
        </p>
      </div>
      <a-button @click="load">
        刷新
      </a-button>
    </div>

    <a-card>
      <a-form
        layout="inline"
        style="margin-bottom: 16px"
        @submit.prevent="onSearch"
      >
        <a-form-item label="动作">
          <a-select
            v-model:value="query.action"
            style="width: 220px"
            placeholder="全部动作"
            allow-clear
            @change="onSearch"
          >
            <a-select-option
              v-for="option in ACTION_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>

      <a-table
        :data-source="rows"
        :loading="loading"
        :pagination="{
          current: query.page,
          pageSize: query.page_size,
          total,
          showSizeChanger: true,
          showTotal: (t: number) => `共 ${t} 条`,
        }"
        row-key="id"
        :locale="{ emptyText: '暂无审计记录' }"
        @change="onTableChange"
      >
        <a-table-column
          title="时间"
          data-index="created_at"
          :width="150"
        >
          <template #default="{ text }">
            {{ formatDateTime(text) }}
          </template>
        </a-table-column>
        <a-table-column
          title="操作者"
          data-index="actor_username"
          :width="110"
        >
          <template #default="{ text }">
            <span v-if="text">{{ text }}</span>
            <span
              v-else
              style="color: rgba(0, 0, 0, 0.35)"
            >（未登录）</span>
          </template>
        </a-table-column>
        <a-table-column
          title="动作"
          data-index="action"
          :width="150"
        >
          <template #default="{ text }">
            <a-tag :color="actionColor(text)">
              {{ actionLabel(text) }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          key="object"
          title="对象"
          :width="200"
        >
          <template #default="{ record }">
            {{ record.object_type }} / {{ record.object_id }}
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
          title="详情"
          data-index="detail"
        />
        <a-table-column
          title="Trace ID"
          data-index="trace_id"
          :width="120"
        />
      </a-table>
    </a-card>
  </div>
</template>
