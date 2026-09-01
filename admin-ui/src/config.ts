/**
 * 全局配置的唯一出口（F9：切换真实后端只改这里 / 环境变量，不改页面逻辑）。
 *
 * - USE_MOCK：true 时启用 MSW mock 网关（默认，独立闭环，不连任何真实后端）。
 * - API_BASE_URL：REST 契约基址，见 docs/program-design.md §6。
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';
