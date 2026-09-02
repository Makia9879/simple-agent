/**
 * 全局配置的唯一出口（F9：切换真实后端只改这里 / 环境变量，不改页面逻辑）。
 *
 * - USE_MOCK：true 时启用 MSW mock 网关（默认，独立闭环，不连任何真实后端）。
 * - API_BASE_URL：REST 契约基址，见 docs/program-design.md §6。
 * - PROXY_TARGET：USE_MOCK=false 时开发服务器的 /api 代理目标（Core API 地址）。
 *   真实后端不输出 CORS 头，且认证 Cookie 绑定在 /api/v1 路径上，浏览器必须与
 *   Core API 同源，因此开发态由 Vite 把 /api 转发到后端（见 vite.config.ts）。
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export const PROXY_TARGET =
  (import.meta.env.VITE_PROXY_TARGET as string | undefined) ?? 'http://localhost:8080';
