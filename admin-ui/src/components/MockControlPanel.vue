<script setup lang="ts">
import { db, resetDb } from '@/mocks/db';
import { clearMockSession } from '@/mocks/session';
import { message } from 'ant-design-vue';
import { ref } from 'vue';

/** Mock 场景控制台：仅在 mock 模式显示，用于按验收清单切换场景。 */
const open = ref(false);
const syncFailure = ref(db.scenario.syncOutcome === 'failure');
const piUnavailable = ref(db.scenario.piUnavailableConversations.length > 0);
const emptyMode = ref(db.scenario.emptyMode);

function applyScenario(): void {
  db.scenario.syncOutcome = syncFailure.value ? 'failure' : 'success';
  db.scenario.piUnavailableConversations = piUnavailable.value ? ['c_5'] : [];
  db.scenario.emptyMode = emptyMode.value;
  message.info('场景已切换：请重新加载对应页面或重新操作以生效');
}

function resetAll(): void {
  resetDb();
  clearMockSession();
  message.warning('Mock 数据已重置，即将重新加载登录页');
  window.setTimeout(() => {
    window.location.assign('/login');
  }, 600);
}
</script>

<template>
  <div class="mock-panel">
    <a-collapse v-model:active-key="open">
      <a-collapse-panel
        key="panel"
        header="Mock 场景控制台（仅 mock 模式）"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
        >
          <a-checkbox v-model:checked="syncFailure">
            Provider 同步失败（保留旧快照）
          </a-checkbox>
          <a-checkbox v-model:checked="piUnavailable">
            会话 c_5 正文 PI 暂不可读
          </a-checkbox>
          <a-checkbox v-model:checked="emptyMode">
            空数据模式（列表返回空）
          </a-checkbox>
          <a-space>
            <a-button
              size="small"
              type="primary"
              @click="applyScenario"
            >
              应用场景
            </a-button>
            <a-button
              size="small"
              @click="resetAll"
            >
              重置数据
            </a-button>
          </a-space>
          <p class="hint">
            管理员 admin/admin123；普通用户 alice/alice123；已禁用 bob/bob123
          </p>
        </a-space>
      </a-collapse-panel>
    </a-collapse>
  </div>
</template>

<style scoped>
.hint {
  margin: 0;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
