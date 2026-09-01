/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 是否启用 MSW mock 网关（默认启用）。 */
  readonly VITE_USE_MOCK?: string;
  /** REST API 基址，例如 /api/v1。 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
