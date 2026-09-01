<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as providersApi from '@/api/modules/providers';
import type { ModelSummary, ProvidersResponse } from '@/api/types';
import { formatDateTime } from '@/utils/format';

/**
 * F4 / AU-04 / AU-05：Provider 无密钥登记。
 * - 只读展示：名称、类型、状态、模型清单、同步时间；
 * - 进入页面自动同步，支持手动刷新；
 * - 同步失败保留上次快照并标记过期；
 * - 页面不出现任何 Key 输入或展示。
 */
const loading = ref(false);
const syncing = ref(false);
const data = ref<ProvidersResponse | null>(null);
const syncFailed = ref(false);
const syncErrorText = ref('');

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await providersApi.listProviders();
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  } finally {
    loading.value = false;
  }
}

async function sync(): Promise<void> {
  syncing.value = true;
  syncFailed.value = false;
  syncErrorText.value = '';
  try {
    await providersApi.syncProviders();
    message.success('同步成功：快照已更新');
  } catch (err) {
    // 失败时保留旧快照（接口返回 502，页面重新拉取仍显示旧数据并标记 stale）
    syncFailed.value = true;
    syncErrorText.value = toApiError(err).displayMessage;
    message.error('同步失败，已保留上次快照并标记过期');
  } finally {
    syncing.value = false;
    await load();
  }
}

function modelTags(models: ModelSummary[]): string {
  return models.map((m) => m.name).join('、');
}

onMounted(() => {
  // AU-05：进入 Provider 页面时自动尝试同步
  void load().then(() => sync());
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          Provider 登记
        </h2>
        <p class="page-subtitle">
          Provider 凭据只在 PI Agent 侧配置；本页仅显示无密钥快照（名称、状态、模型、同步时间）
        </p>
      </div>
      <a-space>
        <a-button @click="load">
          刷新列表
        </a-button>
        <a-button
          type="primary"
          :loading="syncing"
          @click="sync"
        >
          立即同步
        </a-button>
      </a-space>
    </div>

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="安全说明：Provider Key 不进入本系统。此处展示的登记快照由 PI Agent 返回，字段白名单中不包含任何密钥、Token 或凭据。"
    />
    <a-alert
      v-if="syncFailed"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
      :message="`上次同步失败：${syncErrorText}`"
      description="已保留上次成功的登记快照（下方状态已标记为“已过期”）。授权与模型数据不受影响。"
    />

    <a-card>
      <a-table
        :data-source="data?.providers ?? []"
        :loading="loading"
        :pagination="false"
        row-key="provider"
        :locale="{ emptyText: '暂无 Provider 登记，点击“立即同步”从 PI 拉取' }"
      >
        <a-table-column
          title="Provider"
          data-index="provider"
          :width="120"
        />
        <a-table-column
          title="名称"
          data-index="name"
          :width="140"
        />
        <a-table-column
          title="状态"
          data-index="status"
          :width="110"
        >
          <template #default="{ text }">
            <a-tag :color="text === 'active' ? 'green' : 'orange'">
              {{ text === 'active' ? '正常' : '已过期' }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          key="models"
          title="模型清单"
        >
          <template #default="{ record }">
            <template v-if="record.models.length > 0">
              <a-space
                wrap
                size="[4, 4]"
              >
                <a-tag
                  v-for="model in record.models"
                  :key="model.id"
                >
                  {{ model.name }}
                  <span
                    v-if="!model.enabled"
                    style="color: rgba(0, 0, 0, 0.4)"
                  >（停用）</span>
                  <span
                    v-if="!model.available"
                    style="color: #d46b08"
                  >（清单缺失）</span>
                </a-tag>
              </a-space>
            </template>
            <span
              v-else
              style="color: rgba(0, 0, 0, 0.35)"
            >暂无模型</span>
          </template>
        </a-table-column>
        <a-table-column
          title="上次同步时间"
          data-index="last_synced_at"
          :width="170"
        >
          <template #default="{ text }">
            {{ formatDateTime(text) }}
          </template>
        </a-table-column>
        <a-table-column
          key="count"
          title="模型数"
          :width="90"
        >
          <template #default="{ record }">
            {{ modelTags(record.models).length > 0 ? record.models.length : 0 }}
          </template>
        </a-table-column>
      </a-table>
    </a-card>
  </div>
</template>
