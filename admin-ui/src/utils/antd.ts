/** Ant Design Vue 通用回调工具。 */

/** Select 的 filterOption：按 option.label 过滤（label 在模板中传入）。 */
export function filterOptionByLabel(
  input: string,
  option: Record<string, unknown> | undefined,
): boolean {
  const label = String(option?.label ?? '');
  return label.toLowerCase().includes(input.trim().toLowerCase());
}
