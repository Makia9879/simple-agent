<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import { onMounted, reactive, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as conversationsApi from '@/api/modules/conversations';
import * as modelsApi from '@/api/modules/providers';
import * as usersApi from '@/api/modules/users';
import type {
  AdminConversation,
  AdminUser,
  ConversationStatus,
  ModelSummary,
  ReviewFeedback,
  VisibleMessage,
} from '@/api/types';
import { filterOptionByLabel } from '@/utils/antd';
import { formatDateTime } from '@/utils/format';

/**
 * F8 / AU-09 / AU-10 / AU-11：
 * - 全量会话（含用户已隐藏）按用户/模型/状态筛选；
 * - 正文按 since 游标 + limit 分页读取，禁止一次拉全文；
 * - 打开正文即产生审阅审计，界面显示 trace 反馈；
 * - PI 暂不可读时明确提示，失败审阅同样入审计。
 */
const loading = ref(false);
const rows = ref<AdminConversation[]>([]);
const total = ref(0);
const users = ref<AdminUser[]>([]);
const models = ref<ModelSummary[]>([]);

const query = reactive({
  user_id: '' as string,
  model_id: '' as string,
  status: '' as '' | ConversationStatus,
  hidden: '' as '' | 'true' | 'false',
  page: 1,
  page_size: 10,
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await conversationsApi.listConversations({
      user_id: query.user_id || undefined,
      model_id: query.model_id || undefined,
      status: query.status || undefined,
      hidden: query.hidden === '' ? undefined : query.hidden === 'true',
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

function statusTag(status: ConversationStatus): { color: string; text: string } {
  if (status === 'generating') return { color: 'processing', text: '生成中' };
  if (status === 'readonly') return { color: 'default', text: '只读' };
  return { color: 'green', text: '活跃' };
}

// ---- 正文审阅 ----
const drawerVisible = ref(false);
const drawerConversation = ref<AdminConversation | null>(null);
const messages = ref<VisibleMessage[]>([]);
const nextSince = ref<string | null>(null);
const hasMore = ref(false);
const messagesLoading = ref(false);
const messagesError = ref('');
const review = ref<ReviewFeedback | null>(null);
const PAGE_SIZE = 20;

function openConversation(conversation: AdminConversation): void {
  drawerConversation.value = conversation;
  messages.value = [];
  nextSince.value = null;
  hasMore.value = false;
  messagesError.value = '';
  review.value = null;
  drawerVisible.value = true;
  void loadMore(true);
}

async function loadMore(first: boolean): Promise<void> {
  if (!drawerConversation.value) {
    return;
  }
  messagesLoading.value = true;
  messagesError.value = '';
  try {
    const result = await conversationsApi.readConversationMessages(drawerConversation.value.id, {
      since: first ? undefined : (nextSince.value ?? undefined),
      limit: PAGE_SIZE,
    });
    messages.value = [...messages.value, ...result.items];
    nextSince.value = result.next_since;
    hasMore.value = result.has_more;
    if (result.review.recorded) {
      review.value = result.review;
    }
  } catch (err) {
    const apiError = toApiError(err);
    messagesError.value = apiError.displayMessage;
  } finally {
    messagesLoading.value = false;
  }
}

function messageStatusMark(status: VisibleMessage['status']): string {
  if (status === 'aborted') return '（已中止）';
  if (status === 'error') return '（错误）';
  return '';
}

onMounted(() => {
  void loadFilters();
  void load();
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          会话审阅
        </h2>
        <p class="page-subtitle">
          查看全部用户的会话（含用户已删除的隐藏会话）；正文按条目分页读取，每次打开都会记录审阅审计
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
        <a-form-item label="用户">
          <a-select
            v-model:value="query.user_id"
            style="width: 180px"
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
            style="width: 180px"
            placeholder="全部模型"
            allow-clear
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
        <a-form-item label="状态">
          <a-select
            v-model:value="query.status"
            style="width: 110px"
            @change="onSearch"
          >
            <a-select-option value="">
              全部
            </a-select-option>
            <a-select-option value="active">
              活跃
            </a-select-option>
            <a-select-option value="generating">
              生成中
            </a-select-option>
            <a-select-option value="readonly">
              只读
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="隐藏">
          <a-select
            v-model:value="query.hidden"
            style="width: 130px"
            @change="onSearch"
          >
            <a-select-option value="">
              全部会话
            </a-select-option>
            <a-select-option value="true">
              仅用户已隐藏
            </a-select-option>
            <a-select-option value="false">
              仅用户可见
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-button
            type="primary"
            @click="onSearch"
          >
            查询
          </a-button>
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
        :locale="{ emptyText: '当前筛选条件下暂无会话' }"
        @change="onTableChange"
      >
        <a-table-column
          title="会话"
          data-index="id"
          :width="80"
        />
        <a-table-column
          title="标题"
          data-index="title"
          :width="170"
        />
        <a-table-column
          title="用户"
          data-index="owner_username"
          :width="100"
        />
        <a-table-column
          title="模型"
          data-index="model_name"
          :width="160"
        />
        <a-table-column
          title="状态"
          data-index="status"
          :width="100"
        >
          <template #default="{ text }">
            <a-tag :color="statusTag(text).color">
              {{ statusTag(text).text }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          key="hidden"
          title="用户删除"
          :width="100"
        >
          <template #default="{ record }">
            <a-tag
              v-if="record.hidden"
              color="orange"
            >
              已隐藏
            </a-tag>
            <span
              v-else
              style="color: rgba(0, 0, 0, 0.35)"
            >—</span>
          </template>
        </a-table-column>
        <a-table-column
          title="消息数"
          data-index="message_count"
          :width="90"
        />
        <a-table-column
          title="最近更新"
          data-index="updated_at"
          :width="150"
        >
          <template #default="{ text }">
            {{ formatDateTime(text) }}
          </template>
        </a-table-column>
        <a-table-column
          key="actions"
          title="操作"
          :width="110"
        >
          <template #default="{ record }">
            <a @click="openConversation(record)">查看正文</a>
          </template>
        </a-table-column>
      </a-table>
    </a-card>

    <a-drawer
      v-model:open="drawerVisible"
      :title="`会话审阅：${drawerConversation?.title ?? ''}`"
      width="640"
    >
      <template v-if="drawerConversation">
        <a-descriptions
          :column="2"
          size="small"
          bordered
          style="margin-bottom: 16px"
        >
          <a-descriptions-item label="会话 ID">
            {{ drawerConversation.id }}
          </a-descriptions-item>
          <a-descriptions-item label="用户">
            {{ drawerConversation.owner_username }}
          </a-descriptions-item>
          <a-descriptions-item label="模型">
            {{ drawerConversation.model_name }}
          </a-descriptions-item>
          <a-descriptions-item label="状态">
            <a-tag :color="statusTag(drawerConversation.status).color">
              {{ statusTag(drawerConversation.status).text }}
            </a-tag>
            <a-tag
              v-if="drawerConversation.hidden"
              color="orange"
            >
              用户已隐藏
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="创建时间">
            {{ formatDateTime(drawerConversation.created_at) }}
          </a-descriptions-item>
          <a-descriptions-item label="最近更新">
            {{ formatDateTime(drawerConversation.updated_at) }}
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          v-if="review"
          type="success"
          show-icon
          style="margin-bottom: 16px"
          :message="`已记录本次审阅（trace ID：${review.trace_id}）。可在“审计日志”中查看该记录。`"
        />
        <a-alert
          v-if="messagesError"
          type="error"
          show-icon
          style="margin-bottom: 16px"
          :message="messagesError"
          description="读取正文失败也会记录审阅审计；请稍后重试。"
        />

        <a-spin :spinning="messagesLoading">
          <a-empty
            v-if="messages.length === 0 && !messagesError && !messagesLoading"
            description="暂无可展示的消息"
          />
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message-item"
          >
            <div
              class="message-avatar"
              :class="msg.role"
            >
              {{ msg.role === 'user' ? '用户' : '助手' }}
            </div>
            <div class="message-body">
              <div class="message-meta">
                {{ msg.id }} · {{ formatDateTime(msg.created_at) }}{{ messageStatusMark(msg.status) }}
              </div>
              <div class="message-content">
                {{ msg.content }}
              </div>
            </div>
          </div>
        </a-spin>

        <div style="margin-top: 16px; text-align: center">
          <a-button
            v-if="hasMore"
            :loading="messagesLoading"
            @click="loadMore(false)"
          >
            加载更多（每次 {{ PAGE_SIZE }} 条）
          </a-button>
          <span
            v-else-if="messages.length > 0"
            style="color: rgba(0, 0, 0, 0.45); font-size: 12px"
          >
            已到末尾，共 {{ messages.length }} 条
          </span>
        </div>
      </template>
    </a-drawer>
  </div>
</template>
