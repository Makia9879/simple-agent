<script setup lang="ts">
import { message } from 'ant-design-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import { computed, onMounted, reactive, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as groupsApi from '@/api/modules/groups';
import * as usersApi from '@/api/modules/users';
import type { AdminGroup, AdminUser, GroupStatus } from '@/api/types';
import { formatDateTime } from '@/utils/format';

/**
 * F3 / AU-03：用户组 CRUD 与成员批量加入 / 移除（一个用户可属于多个组）。
 * 真实后端没有「读取组成员」接口：member_ids 为 null 时成员区降级为
 * 「勾选加入 / 勾选移除」两个全量用户表，变更仍是一次 PATCH 请求。
 */
const loading = ref(false);
const rows = ref<AdminGroup[]>([]);
const total = ref(0);
const allUsers = ref<AdminUser[]>([]);
const query = reactive({
  query: '',
  status: '' as '' | GroupStatus,
  page: 1,
  page_size: 10,
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await groupsApi.listGroups({
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

async function loadUsers(): Promise<void> {
  try {
    const result = await usersApi.listUsers({ page: 1, page_size: 200 });
    allUsers.value = result.items;
  } catch (err) {
    message.error(toApiError(err).displayMessage);
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
const modalVisible = ref(false);
const modalSubmitting = ref(false);
const modalError = ref('');
const form = reactive({ id: '' as string, name: '' });
const isEdit = computed(() => form.id !== '');

function openCreate(): void {
  modalError.value = '';
  Object.assign(form, { id: '', name: '' });
  modalVisible.value = true;
}

function openEdit(group: AdminGroup): void {
  modalError.value = '';
  Object.assign(form, { id: group.id, name: group.name });
  modalVisible.value = true;
}

async function submitModal(): Promise<void> {
  modalError.value = '';
  if (!form.name.trim()) {
    modalError.value = '用户组名称不能为空';
    return;
  }
  modalSubmitting.value = true;
  try {
    if (isEdit.value) {
      await groupsApi.updateGroup(form.id, { name: form.name });
      message.success('用户组已更新');
    } else {
      await groupsApi.createGroup({ name: form.name });
      message.success('用户组已创建');
    }
    modalVisible.value = false;
    await load();
  } catch (err) {
    modalError.value = toApiError(err).displayMessage;
  } finally {
    modalSubmitting.value = false;
  }
}

async function toggleStatus(group: AdminGroup): Promise<void> {
  const next: GroupStatus = group.status === 'active' ? 'disabled' : 'active';
  try {
    await groupsApi.updateGroup(group.id, { status: next });
    message.success(next === 'disabled' ? `已停用组 ${group.name}` : `已启用组 ${group.name}`);
    await load();
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  }
}

// ---- 成员批量管理 ----
const membersVisible = ref(false);
const membersSubmitting = ref(false);
const membersError = ref('');
const currentGroup = ref<AdminGroup | null>(null);
const addSelected = ref<string[]>([]);
const removeSelected = ref<string[]>([]);

/** 后端能提供成员列表时（契约完整形态）才区分「当前成员 / 待加入」。 */
const membersKnown = computed(() => currentGroup.value?.member_ids != null);

const currentMembers = computed<AdminUser[]>(() => {
  if (!currentGroup.value || currentGroup.value.member_ids == null) {
    return [];
  }
  const ids = new Set(currentGroup.value.member_ids);
  return allUsers.value.filter((u) => ids.has(u.id));
});

const candidateUsers = computed<AdminUser[]>(() => {
  if (!currentGroup.value) {
    return [] as AdminUser[];
  }
  if (currentGroup.value.member_ids == null) {
    return allUsers.value;
  }
  return allUsers.value.filter((u) => !currentGroup.value!.member_ids!.includes(u.id));
});

function openMembers(group: AdminGroup): void {
  membersError.value = '';
  currentGroup.value = group;
  addSelected.value = [];
  removeSelected.value = [];
  membersVisible.value = true;
  void loadUsers();
}

async function submitMembers(): Promise<void> {
  if (!currentGroup.value) {
    return;
  }
  if (addSelected.value.length === 0 && removeSelected.value.length === 0) {
    membersError.value = '请先选择要加入或移除的成员';
    return;
  }
  membersSubmitting.value = true;
  try {
    await groupsApi.changeMembers(currentGroup.value.id, {
      add_user_ids: addSelected.value,
      remove_user_ids: removeSelected.value,
    });
    message.success(`成员变更已提交：加入 ${addSelected.value.length} 人，移除 ${removeSelected.value.length} 人`);
    membersVisible.value = false;
    await load();
  } catch (err) {
    membersError.value = toApiError(err).displayMessage;
  } finally {
    membersSubmitting.value = false;
  }
}

function userLabel(user: AdminUser): string {
  return `${user.username}${user.status === 'disabled' ? '（已禁用）' : ''}`;
}

onMounted(() => {
  void load();
  void loadUsers();
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          用户组管理
        </h2>
        <p class="page-subtitle">
          创建用户组并批量管理成员；组是模型授权的推荐主体
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
          新建用户组
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
            placeholder="组名"
            style="width: 240px"
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
              停用
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
        :locale="{ emptyText: '暂无用户组，点击右上角“新建用户组”创建' }"
        @change="onTableChange"
      >
        <a-table-column
          title="组名"
          data-index="name"
          :width="180"
        />
        <a-table-column
          title="状态"
          data-index="status"
          :width="100"
        >
          <template #default="{ text }">
            <a-tag :color="text === 'active' ? 'green' : 'red'">
              {{ text === 'active' ? '启用' : '停用' }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column
          key="member_count"
          title="成员数"
          :width="100"
        >
          <template #default="{ record }">
            {{ record.member_count ?? '—' }}
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
          :width="220"
        >
          <template #default="{ record }">
            <a-space>
              <a @click="openEdit(record)">编辑</a>
              <a-divider type="vertical" />
              <a @click="openMembers(record)">成员</a>
              <a-divider type="vertical" />
              <a-popconfirm
                :title="record.status === 'active' ? `确认停用组 ${record.name}？` : `确认启用组 ${record.name}？`"
                @confirm="toggleStatus(record)"
              >
                <a :style="{ color: record.status === 'active' ? '#cf1322' : '#389e0d' }">
                  {{ record.status === 'active' ? '停用' : '启用' }}
                </a>
              </a-popconfirm>
            </a-space>
          </template>
        </a-table-column>
      </a-table>
    </a-card>

    <a-modal
      v-model:open="modalVisible"
      :title="isEdit ? '编辑用户组' : '新建用户组'"
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
          label="组名"
          required
        >
          <a-input
            v-model:value="form.name"
            placeholder="不超过 32 个字符"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-drawer
      v-model:open="membersVisible"
      :title="`成员管理：${currentGroup?.name ?? ''}`"
      width="560"
    >
      <a-alert
        v-if="membersError"
        type="error"
        :message="membersError"
        show-icon
        style="margin-bottom: 12px"
      />
      <a-alert
        v-if="currentGroup && !membersKnown"
        type="info"
        show-icon
        style="margin-bottom: 12px"
        message="当前后端未提供组成员查询接口"
        description="下方两个列表均为全部用户：勾选「加入」或「移除」后一次提交；变更结果可在用户的有效模型预览中验证。"
      />

      <template v-if="membersKnown">
        <p class="section-title">
          当前成员（勾选移除）
        </p>
        <a-table
          :data-source="currentMembers"
          :pagination="false"
          row-key="id"
          size="small"
          :row-selection="{
            selectedRowKeys: removeSelected,
            onChange: (keys: string[]) => (removeSelected = keys),
          }"
          :locale="{ emptyText: '该组暂无成员' }"
        >
          <a-table-column
            title="用户名"
            data-index="username"
            :width="140"
          />
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
        </a-table>
      </template>

      <p
        class="section-title"
        :style="membersKnown ? 'margin-top: 20px' : ''"
      >
        加入成员（勾选加入）
      </p>
      <a-table
        :data-source="candidateUsers"
        :pagination="false"
        row-key="id"
        size="small"
        :row-selection="{
          selectedRowKeys: addSelected,
          onChange: (keys: string[]) => (addSelected = keys),
        }"
        :locale="{ emptyText: '没有可加入的用户' }"
      >
        <a-table-column
          title="用户名"
          data-index="username"
          :width="140"
        />
        <a-table-column
          key="label"
          title="状态"
        >
          <template #default="{ record }">
            {{ userLabel(record) }}
          </template>
        </a-table-column>
      </a-table>

      <template v-if="!membersKnown">
        <p
          class="section-title"
          style="margin-top: 20px"
        >
          移除成员（勾选移除）
        </p>
        <a-table
          :data-source="allUsers"
          :pagination="false"
          row-key="id"
          size="small"
          :row-selection="{
            selectedRowKeys: removeSelected,
            onChange: (keys: string[]) => (removeSelected = keys),
          }"
          :locale="{ emptyText: '暂无用户' }"
        >
          <a-table-column
            title="用户名"
            data-index="username"
            :width="140"
          />
        </a-table>
      </template>

      <template #footer>
        <a-space>
          <span style="color: rgba(0, 0, 0, 0.45); font-size: 13px">
            本次将加入 {{ addSelected.length }} 人，移除 {{ removeSelected.length }} 人
          </span>
          <a-button
            :loading="membersSubmitting"
            type="primary"
            @click="submitMembers"
          >
            保存变更
          </a-button>
        </a-space>
      </template>
    </a-drawer>
  </div>
</template>

<style scoped>
.section-title {
  margin: 0 0 8px;
  font-weight: 600;
}
</style>
