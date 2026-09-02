<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as usersApi from '@/api/modules/users';
import type { AdminUser, Role, UserStatus } from '@/api/types';
import { formatDateTime } from '@/utils/format';

/**
 * F3 / AU-02：用户列表、创建、编辑、禁用、重置密码。
 * 真实后端用户只有 id/username/role/status（无昵称/邮箱/创建时间），
 * 缺失字段降级显示「—」；密码策略为至少 12 位。
 */
const loading = ref(false);
const rows = ref<AdminUser[]>([]);
const total = ref(0);
const query = reactive({
  query: '',
  status: '' as '' | UserStatus,
  page: 1,
  page_size: 10,
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await usersApi.listUsers({
      query: query.query || undefined,
      status: query.status || undefined,
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

function onTableChange(pagination: TablePaginationConfig): void {
  query.page = pagination.current ?? 1;
  query.page_size = pagination.pageSize ?? 10;
  void load();
}

function onSearch(): void {
  query.page = 1;
  void load();
}

// ---- 创建 / 编辑 ----
interface UserFormState {
  id: string | null;
  username: string;
  role: Role;
  password: string;
}

const modalVisible = ref(false);
const modalSubmitting = ref(false);
const modalError = ref('');
const form = reactive<UserFormState>({
  id: null,
  username: '',
  role: 'user',
  password: '',
});

const isEdit = computed(() => form.id !== null);

function openCreate(): void {
  modalError.value = '';
  Object.assign(form, { id: null, username: '', role: 'user', password: '' });
  modalVisible.value = true;
}

function openEdit(user: AdminUser): void {
  modalError.value = '';
  Object.assign(form, { id: user.id, username: user.username, role: user.role, password: '' });
  modalVisible.value = true;
}

async function submitModal(): Promise<void> {
  modalError.value = '';
  modalSubmitting.value = true;
  try {
    if (isEdit.value) {
      await usersApi.updateUser(form.id!, { role: form.role });
      message.success('用户已更新');
    } else {
      await usersApi.createUser({
        username: form.username,
        password: form.password,
        role: form.role,
      });
      message.success('用户已创建');
    }
    modalVisible.value = false;
    await load();
  } catch (err) {
    modalError.value = toApiError(err).displayMessage;
  } finally {
    modalSubmitting.value = false;
  }
}

async function toggleStatus(user: AdminUser): Promise<void> {
  const nextStatus: UserStatus = user.status === 'active' ? 'disabled' : 'active';
  try {
    await usersApi.updateUser(user.id, { status: nextStatus });
    message.success(nextStatus === 'disabled' ? `已禁用 ${user.username}` : `已启用 ${user.username}`);
    await load();
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  }
}

// ---- 重置密码 ----
const resetVisible = ref(false);
const resetSubmitting = ref(false);
const resetError = ref('');
const resetTarget = ref<AdminUser | null>(null);
const resetForm = reactive({ password: '', confirm: '' });

function openReset(user: AdminUser): void {
  resetError.value = '';
  resetTarget.value = user;
  resetForm.password = '';
  resetForm.confirm = '';
  resetVisible.value = true;
}

async function submitReset(): Promise<void> {
  if (!resetTarget.value) {
    return;
  }
  resetError.value = '';
  if (resetForm.password.length < usersApi.MIN_PASSWORD_LENGTH) {
    resetError.value = `密码长度至少 ${usersApi.MIN_PASSWORD_LENGTH} 位`;
    return;
  }
  if (resetForm.password !== resetForm.confirm) {
    resetError.value = '两次输入的密码不一致';
    return;
  }
  resetSubmitting.value = true;
  try {
    await usersApi.resetPassword(resetTarget.value.id, resetForm.password);
    message.success(`已重置 ${resetTarget.value.username} 的密码`);
    resetVisible.value = false;
  } catch (err) {
    resetError.value = toApiError(err).displayMessage;
  } finally {
    resetSubmitting.value = false;
  }
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
          用户管理
        </h2>
        <p class="page-subtitle">
          创建、编辑、禁用用户并重置密码；用户可属于多个组（在用户组页维护成员）
        </p>
      </div>
      <a-space>
        <a-button @click="load">
          刷新
        </a-button>
        <a-button
          type="primary"
          @click="openCreate"
        >
          新建用户
        </a-button>
      </a-space>
    </div>

    <a-card>
      <a-form
        layout="inline"
        style="margin-bottom: 16px"
        @submit.prevent="onSearch"
      >
        <a-form-item label="关键词">
          <a-input-search
            v-model:value="query.query"
            placeholder="用户名"
            style="width: 260px"
            allow-clear
            @search="onSearch"
          />
        </a-form-item>
        <a-form-item label="状态">
          <a-select
            v-model:value="query.status"
            style="width: 120px"
            @change="onSearch"
          >
            <a-select-option value="">
              全部
            </a-select-option>
            <a-select-option value="active">
              启用
            </a-select-option>
            <a-select-option value="disabled">
              禁用
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
        :locale="{ emptyText: '暂无用户，点击右上角“新建用户”创建' }"
        @change="onTableChange"
      >
        <a-table-column
          title="用户名"
          data-index="username"
          :width="140"
        />
        <a-table-column
          title="角色"
          data-index="role"
          :width="110"
        >
          <template #default="{ text }">
            <a-tag :color="text === 'admin' ? 'purple' : 'blue'">
              {{ text === 'admin' ? '管理员' : '普通用户' }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          title="状态"
          data-index="status"
          :width="100"
        >
          <template #default="{ text }">
            <a-tag :color="text === 'active' ? 'green' : 'red'">
              {{ text === 'active' ? '启用' : '禁用' }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          key="groups"
          title="所属组"
        >
          <template #default="{ record }">
            <template v-if="record.group_names && record.group_names.length > 0">
              <a-tag
                v-for="name in record.group_names"
                :key="name"
              >
                {{ name }}
              </a-tag>
            </template>
            <span
              v-else
              style="color: rgba(0, 0, 0, 0.35)"
            >—</span>
          </template>
        </a-table-column>
        <a-table-column
          title="创建时间"
          :width="170"
        >
          <template #default="{ record }">
            {{ record.created_at ? formatDateTime(record.created_at) : '—' }}
          </template>
        </a-table-column>
        <a-table-column
          key="actions"
          title="操作"
          :width="230"
        >
          <template #default="{ record }">
            <a-space>
              <a @click="openEdit(record)">编辑</a>
              <a-divider type="vertical" />
              <a @click="openReset(record)">重置密码</a>
              <a-divider type="vertical" />
              <a-popconfirm
                :title="record.status === 'active' ? `确认禁用 ${record.username}？` : `确认启用 ${record.username}？`"
                @confirm="toggleStatus(record)"
              >
                <a :style="{ color: record.status === 'active' ? '#cf1322' : '#389e0d' }">
                  {{ record.status === 'active' ? '禁用' : '启用' }}
                </a>
              </a-popconfirm>
            </a-space>
          </template>
        </a-table-column>
      </a-table>
    </a-card>

    <a-modal
      v-model:open="modalVisible"
      :title="isEdit ? '编辑用户' : '新建用户'"
      :confirm-loading="modalSubmitting"
      @ok="submitModal"
    >
      <a-alert
        v-if="modalError"
        type="error"
        :message="modalError"
        show-icon
        style="margin-bottom: 12px"
      />
      <a-form layout="vertical">
        <a-form-item
          label="用户名"
          required
        >
          <a-input
            v-model:value="form.username"
            :disabled="isEdit"
            placeholder="3-32 位字母、数字或下划线"
          />
        </a-form-item>
        <a-form-item label="角色">
          <a-radio-group
            v-model:value="form.role"
            :disabled="isEdit"
          >
            <a-radio value="user">
              普通用户
            </a-radio>
            <a-radio value="admin">
              管理员
            </a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item
          v-if="!isEdit"
          label="初始密码"
          required
          extra="至少 12 位；密码只在创建时设置，之后可由管理员重置"
        >
          <a-input-password
            v-model:value="form.password"
            :placeholder="`至少 ${usersApi.MIN_PASSWORD_LENGTH} 位`"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="resetVisible"
      :title="`重置密码：${resetTarget?.username ?? ''}`"
      :confirm-loading="resetSubmitting"
      @ok="submitReset"
    >
      <a-alert
        v-if="resetError"
        type="error"
        :message="resetError"
        show-icon
        style="margin-bottom: 12px"
      />
      <a-form layout="vertical">
        <a-form-item
          label="新密码"
          required
        >
          <a-input-password
            v-model:value="resetForm.password"
            :placeholder="`至少 ${usersApi.MIN_PASSWORD_LENGTH} 位`"
          />
        </a-form-item>
        <a-form-item
          label="确认新密码"
          required
        >
          <a-input-password
            v-model:value="resetForm.confirm"
            placeholder="再次输入新密码"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>
