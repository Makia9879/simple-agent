<script setup lang="ts">
import { message } from 'ant-design-vue';
import { onMounted, reactive, ref } from 'vue';

import { toApiError } from '@/api/errors';
import * as groupsApi from '@/api/modules/groups';
import * as modelsApi from '@/api/modules/providers';
import * as usersApi from '@/api/modules/users';
import type {
  AdminGroup,
  AdminUser,
  EffectiveModel,
  Grant,
  ModelSummary,
  SubjectType,
} from '@/api/types';
import { filterOptionByLabel } from '@/utils/antd';
import { formatDateTime } from '@/utils/format';

/**
 * F4 / AU-06 / AU-07：
 * - 以 provider + upstream_model_id 识别模型；
 * - Model 启停（新同步模型默认停用，缺失模型不可用但不删授权）；
 * - 对用户/用户组授权与撤销；
 * - 预览某用户的最终有效模型。
 */
const activeTab = ref('models');

// ---- 模型管理 ----
const modelsLoading = ref(false);
const models = ref<ModelSummary[]>([]);

async function loadModels(): Promise<void> {
  modelsLoading.value = true;
  try {
    const result = await modelsApi.listModels();
    models.value = result.items;
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  } finally {
    modelsLoading.value = false;
  }
}

async function toggleModel(model: ModelSummary, enabled: boolean): Promise<void> {
  try {
    await modelsApi.setModelEnabled(model.id, enabled);
    message.success(`${enabled ? '启用' : '停用'}模型 ${model.name}`);
    await loadModels();
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  }
}

// ---- 授权管理 ----
const grantsLoading = ref(false);
const grants = ref<Grant[]>([]);
const grantFilter = ref<'' | SubjectType>('');
const users = ref<AdminUser[]>([]);
const groups = ref<AdminGroup[]>([]);
const grantForm = reactive<{ subject_type: SubjectType; subject_id: string; model_id: string }>({
  subject_type: 'group',
  subject_id: '',
  model_id: '',
});
const grantSubmitting = ref(false);

const grantableModels = ref<ModelSummary[]>([]);

async function loadGrants(): Promise<void> {
  grantsLoading.value = true;
  try {
    const result = await modelsApi.listGrants({
      subject_type: grantFilter.value === '' ? undefined : grantFilter.value,
    });
    grants.value = result.items;
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  } finally {
    grantsLoading.value = false;
  }
}

async function loadSubjects(): Promise<void> {
  try {
    const [u, g] = await Promise.all([
      usersApi.listUsers({ page: 1, page_size: 100 }),
      groupsApi.listGroups({ page: 1, page_size: 100 }),
    ]);
    users.value = u.items;
    groups.value = g.items;
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  }
}

async function submitGrant(): Promise<void> {
  if (!grantForm.subject_id || !grantForm.model_id) {
    message.warning('请选择授权对象与模型');
    return;
  }
  grantSubmitting.value = true;
  try {
    await modelsApi.createGrant({ ...grantForm });
    message.success('授权已创建');
    grantForm.subject_id = '';
    grantForm.model_id = '';
    await loadGrants();
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  } finally {
    grantSubmitting.value = false;
  }
}

async function removeGrant(grant: Grant): Promise<void> {
  try {
    await modelsApi.deleteGrant({
      subject_type: grant.subject_type,
      subject_id: grant.subject_id,
      model_id: grant.model_id,
    });
    message.success('授权已撤销');
    await loadGrants();
  } catch (err) {
    message.error(toApiError(err).displayMessage);
  }
}

// ---- 有效模型预览 ----
const previewUserId = ref<string>('');
const previewLoading = ref(false);
const previewModels = ref<EffectiveModel[] | null>(null);
const previewError = ref('');

async function loadPreview(): Promise<void> {
  if (!previewUserId.value) {
    message.warning('请先选择用户');
    return;
  }
  previewLoading.value = true;
  previewError.value = '';
  try {
    const result = await modelsApi.effectiveModels(previewUserId.value);
    previewModels.value = result.items;
  } catch (err) {
    previewError.value = toApiError(err).displayMessage;
    previewModels.value = [];
  } finally {
    previewLoading.value = false;
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([loadModels(), loadGrants(), loadSubjects()]);
  grantableModels.value = models.value.filter((m) => m.enabled);
}

onMounted(() => {
  void refreshAll();
});
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h2 class="page-title">
          Model 与授权
        </h2>
        <p class="page-subtitle">
          模型以 provider + upstream_model_id 标识；新同步模型默认停用；有效模型 = 用户/组授权 ∩ 已启用 ∩ 可用
        </p>
      </div>
      <a-button @click="refreshAll">
        刷新
      </a-button>
    </div>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane
        key="models"
        tab="模型管理"
      >
        <a-card>
          <a-table
            :data-source="models"
            :loading="modelsLoading"
            :pagination="false"
            row-key="id"
            :locale="{ emptyText: '暂无模型，请到 Provider 登记页同步' }"
          >
            <a-table-column
              title="模型名称"
              data-index="name"
              :width="170"
            />
            <a-table-column
              title="Provider"
              data-index="provider"
              :width="110"
            />
            <a-table-column
              title="upstream_model_id"
              data-index="upstream_model_id"
              :width="180"
            />
            <a-table-column
              key="available"
              title="可用性"
              :width="120"
            >
              <template #default="{ record }">
                <a-tag :color="record.available ? 'green' : 'orange'">
                  {{ record.available ? '可用' : '清单缺失' }}
                </a-tag>
              </template>
            </a-table-column>
            <a-table-column
              key="enabled"
              title="启用状态"
              :width="120"
            >
              <template #default="{ record }">
                <a-switch
                  :checked="record.enabled"
                  :disabled="!record.available && !record.enabled"
                  :loading="modelsLoading"
                  @change="(checked: boolean | string | number) => toggleModel(record, Boolean(checked))"
                />
                <span style="margin-left: 8px">{{ record.enabled ? '已启用' : '已停用' }}</span>
              </template>
            </a-table-column>
          </a-table>
          <p class="hint">
            说明：Provider 清单缺失的模型保持不可用，但既有授权不会被删除；恢复出现在清单后可再次启用。
          </p>
        </a-card>
      </a-tab-pane>

      <a-tab-pane
        key="grants"
        tab="授权管理"
      >
        <a-card>
          <a-form
            layout="inline"
            style="margin-bottom: 16px"
            @submit.prevent="submitGrant"
          >
            <a-form-item label="授权对象类型">
              <a-select
                v-model:value="grantForm.subject_type"
                style="width: 110px"
                @change="grantForm.subject_id = ''"
              >
                <a-select-option value="group">
                  用户组
                </a-select-option>
                <a-select-option value="user">
                  用户
                </a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="对象">
              <a-select
                v-model:value="grantForm.subject_id"
                style="width: 220px"
                placeholder="选择用户组或用户"
                show-search
                :filter-option="filterOptionByLabel"
              >
                <template v-if="grantForm.subject_type === 'group'">
                  <a-select-option
                    v-for="group in groups"
                    :key="group.id"
                    :label="group.name"
                  >
                    {{ group.name }}（{{ group.member_count }} 人）
                  </a-select-option>
                </template>
                <template v-else>
                  <a-select-option
                    v-for="user in users"
                    :key="user.id"
                    :label="user.username"
                  >
                    {{ user.username }}（{{ user.nickname }}）
                  </a-select-option>
                </template>
              </a-select>
            </a-form-item>
            <a-form-item label="模型">
              <a-select
                v-model:value="grantForm.model_id"
                style="width: 200px"
                placeholder="仅显示已启用模型"
                show-search
                :filter-option="filterOptionByLabel"
              >
                <a-select-option
                  v-for="model in grantableModels"
                  :key="model.id"
                  :label="model.name"
                >
                  {{ model.name }}（{{ model.provider }}）
                </a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item>
              <a-button
                type="primary"
                :loading="grantSubmitting"
                @click="submitGrant"
              >
                添加授权
              </a-button>
            </a-form-item>
          </a-form>

          <a-space style="margin-bottom: 12px">
            <span>筛选：</span>
            <a-select
              v-model:value="grantFilter"
              style="width: 140px"
              @change="loadGrants"
            >
              <a-select-option value="">
                全部对象
              </a-select-option>
              <a-select-option value="group">
                仅用户组
              </a-select-option>
              <a-select-option value="user">
                仅用户
              </a-select-option>
            </a-select>
          </a-space>

          <a-table
            :data-source="grants"
            :loading="grantsLoading"
            :pagination="false"
            :row-key="(record: Grant) => `${record.subject_type}:${record.subject_id}:${record.model_id}`"
            :locale="{ emptyText: '暂无授权记录' }"
          >
            <a-table-column
              title="对象类型"
              data-index="subject_type"
              :width="100"
            >
              <template #default="{ text }">
                <a-tag :color="text === 'group' ? 'cyan' : 'blue'">
                  {{ text === 'group' ? '用户组' : '用户' }}
                </a-tag>
              </template>
            </a-table-column>
            <a-table-column
              key="subject"
              title="对象"
            >
              <template #default="{ record }">
                {{ record.subject_name }}（{{ record.subject_id }}）
              </template>
            </a-table-column>
            <a-table-column
              title="模型"
              data-index="model_name"
              :width="170"
            />
            <a-table-column
              title="创建时间"
              data-index="created_at"
              :width="160"
            >
              <template #default="{ text }">
                {{ formatDateTime(text) }}
              </template>
            </a-table-column>
            <a-table-column
              key="actions"
              title="操作"
              :width="100"
            >
              <template #default="{ record }">
                <a-popconfirm
                  :title="`确认撤销 ${record.subject_name} 对 ${record.model_name} 的授权？`"
                  @confirm="removeGrant(record)"
                >
                  <a style="color: #cf1322">撤销</a>
                </a-popconfirm>
              </template>
            </a-table-column>
          </a-table>
        </a-card>
      </a-tab-pane>

      <a-tab-pane
        key="preview"
        tab="有效模型预览"
      >
        <a-card>
          <a-form
            layout="inline"
            style="margin-bottom: 16px"
            @submit.prevent="loadPreview"
          >
            <a-form-item label="用户">
              <a-select
                v-model:value="previewUserId"
                style="width: 240px"
                placeholder="选择要预览的用户"
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
            <a-form-item>
              <a-button
                type="primary"
                :loading="previewLoading"
                @click="loadPreview"
              >
                查询有效模型
              </a-button>
            </a-form-item>
          </a-form>

          <a-alert
            v-if="previewError"
            type="error"
            show-icon
            :message="previewError"
            style="margin-bottom: 12px"
          />
          <template v-if="previewModels !== null">
            <a-empty
              v-if="previewModels.length === 0"
              description="该用户当前没有有效模型（无授权、模型停用或不可用）"
            />
            <template v-else>
              <p>共 {{ previewModels.length }} 个有效模型：</p>
              <a-table
                :data-source="previewModels"
                :pagination="false"
                row-key="id"
                size="small"
              >
                <a-table-column
                  title="模型名称"
                  data-index="name"
                  :width="170"
                />
                <a-table-column
                  title="Provider"
                  data-index="provider"
                  :width="110"
                />
                <a-table-column
                  title="upstream_model_id"
                  data-index="upstream_model_id"
                />
              </a-table>
            </template>
          </template>
          <p
            v-else
            class="hint"
          >
            选择用户后点击“查询有效模型”，结果为 用户直接授权 ∪ 所属组授权，再与模型启用、可用状态取交集。
          </p>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<style scoped>
.hint {
  margin: 12px 0 0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
