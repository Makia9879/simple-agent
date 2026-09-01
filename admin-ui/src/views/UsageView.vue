<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import dayjs, { type Dayjs } from 'dayjs';
import { onMounted, reactive, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as modelsApi from '@/api/modules/providers';
import * as usageApi from '@/api/modules/usage';
import * as usersApi from '@/api/modules/users';
import type { AdminUser, ModelSummary, UsageRecord, UsageSummary } from '@/api/types';
import { filterOptionByLabel } from '@/utils/antd';
import { formatDateTime, formatTokens } from '@/utils/format';

/** F8 / AU-08：全局用量，按用户、模型和时间筛选；未知 Token 显示“未知”。 */
const loading = ref(false);
const rows = ref<UsageRecord[]>([]);
const total = ref(0);
const summary = ref<UsageSummary | null>(null);
const users = ref<AdminUser[]>([]);
const models = ref<ModelSummary[]>([]);

const query = reactive({
  user_id: '' as string,
  model_id: '' as string,
  range: [] as [Dayjs, Dayjs] | [],
  page: 1,
  page_size: 10,
});

function rangeParams(): { from?: string; to?: string } {
  if (query.range && query.range.length === 2 && query.range[0] && query.range[1]) {
    return {
      from: `${query.range[0].format('YYYY-MM-DD')}T00:00:00Z`,
      to: `${query.range[1].format('YYYY-MM-DD')}T23:59:59Z`,
    };
  }
  return {};
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await usageApi.listUsage({
      ...rangeParams(),
      user_id: query.user_id || undefined,
      model_id: query.model_id || undefined,
      page: query.page,
      page_size: query.page_size,
    });
    rows.value = result.items;
    total.value = result.total;
    summary.value = result.summary;
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

function onReset(): void {
  query.user_id = '';
  query.model_id = '';
  query.range = [];
  query.page = 1;
  void load();
}

function onTableChange(pagination: TablePaginationConfig): void {
  query.page = pagination.current ?? 1;
  query.page_size = pagination.pageSize ?? 10;
  void load();
}

async function loadFilters(): Promise<void> {
  try {
    const [u, m] = await Promise.all([
      usersApi.listUsers({ page: 1, page_size: 100 }),
      modelsApi.listModels(),
    ]);
    users.value = u.items;
    models.value = m.items;
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  }
}

function statusColor(status: UsageRecord['status']): string {
  if (status === 'success') return 'green';
  if (status === 'error') return 'red';
  return 'orange';
}

function statusText(status: UsageRecord['status']): string {
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  return '已中止';
}

function duration(record: UsageRecord): string {
  const ms = new Date(record.ended_at).getTime() - new Date(record.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

onMounted(() => {
  void loadFilters();
  void load();
  message.config({ maxCount: 3 });
  dayjs.locale('zh-cn');
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          全局用量
        </h2>
        <p class="page-subtitle">
          按用户、模型和时间筛选调用次数、Token 与状态；Provider 未返回 Token 时显示“未知”
        </p>
      </div>
      <a-button @click="load">
        刷新
      </a-button>
    </div>

    <a-card style="margin-bottom: 16px">
      <a-form
        layout="inline"
        @submit.prevent="onSearch"
      >
        <a-form-item label="用户">
          <a-select
            v-model:value="query.user_id"
            style="width: 200px"
            placeholder="全部用户"
            allow-clear
            show-search
            :filter-option="filterOptionByLabel"
          >
            <a-select-option
              v-for="user in users"
              :key="user.id"
              :label="user.username"
            >
              {{ user.username }}（{{ user.nickname }}）
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="模型">
          <a-select
            v-model:value="query.model_id"
            style="width: 200px"
            placeholder="全部模型"
            allow-clear
            show-search
            :filter-option="filterOptionByLabel"
          >
            <a-select-option
              v-for="model in models"
              :key="model.id"
              :label="model.name"
            >
              {{ model.name }}（{{ model.provider }}）
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="时间">
          <a-range-picker
            v-model:value="query.range"
            value-format="YYYY-MM-DD"
          />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button
              type="primary"
              @click="onSearch"
            >
              查询
            </a-button>
            <a-button @click="onReset">
              重置
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <a-card
      v-if="summary"
      title="汇总（按当前筛选）"
      style="margin-bottom: 16px"
    >
      <a-row :gutter="16">
        <a-col :span="4">
          <a-statistic
            title="调用次数"
            :value="summary.calls"
          />
        </a-col>
        <a-col :span="4">
          <a-statistic
            title="成功"
            :value="summary.success"
          />
        </a-col>
        <a-col :span="4">
          <a-statistic
            title="失败"
            :value="summary.error"
          />
        </a-col>
        <a-col :span="4">
          <a-statistic
            title="中止"
            :value="summary.aborted"
          />
        </a-col>
        <a-col :span="4">
          <a-statistic
            title="输入 Token"
            :value="formatTokens(summary.input_tokens)"
          />
        </a-col>
        <a-col :span="4">
          <a-statistic
            title="输出 Token"
            :value="formatTokens(summary.output_tokens)"
          />
        </a-col>
      </a-row>
      <p class="hint">
        总 Token：{{ formatTokens(summary.total_tokens) }}；Token 未知的记录 {{ summary.unknown_token_records }} 条（不伪造估算值）。
      </p>
    </a-card>

    <a-card>
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
        row-key="request_id"
        :locale="{ emptyText: '当前筛选条件下暂无用量记录' }"
        @change="onTableChange"
      >
        <a-table-column
          title="Request ID"
          data-index="request_id"
          :width="110"
        />
        <a-table-column
          title="用户"
          data-index="username"
          :width="100"
        />
        <a-table-column
          title="模型"
          data-index="model_name"
          :width="160"
        />
        <a-table-column
          title="会话"
          data-index="conversation_id"
          :width="90"
        />
        <a-table-column
          title="状态"
          data-index="status"
          :width="90"
        >
          <template #default="{ text }">
            <a-tag :color="statusColor(text)">
              {{ statusText(text) }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          title="开始时间"
          data-index="started_at"
          :width="150"
        >
          <template #default="{ text }">
            {{ formatDateTime(text) }}
          </template>
        </a-table-column>
        <a-table-column
          key="duration"
          title="耗时"
          :width="80"
        >
          <template #default="{ record }">
            {{ duration(record) }}
          </template>
        </a-table-column>
        <a-table-column
          key="input"
          title="输入 Token"
          :width="110"
        >
          <template #default="{ record }">
            {{ formatTokens(record.input_tokens) }}
          </template>
        </a-table-column>
        <a-table-column
          key="output"
          title="输出 Token"
          :width="110"
        >
          <template #default="{ record }">
            {{ formatTokens(record.output_tokens) }}
          </template>
        </a-table-column>
        <a-table-column
          key="total"
          title="总 Token"
          :width="110"
        >
          <template #default="{ record }">
            {{ formatTokens(record.total_tokens) }}
          </template>
        </a-table-column>
      </a-table>
    </a-card>
  </div>
</template>

<style scoped>
.hint {
  margin: 12px 0 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
