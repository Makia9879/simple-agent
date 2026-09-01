/** 展示格式化工具（时间、Token、状态标签等）。 */
import dayjs from 'dayjs';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  return dayjs(iso).format('YYYY-MM-DD HH:mm');
}

/** Token 为 null 时显示“未知”，不伪造估算值（§5.3）。 */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '未知';
  }
  return value.toLocaleString('zh-CN');
}

export function formatDateInput(iso: string): string {
  return dayjs(iso).format('YYYY-MM-DD');
}
