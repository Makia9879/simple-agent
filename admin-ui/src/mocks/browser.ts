/**
 * 浏览器端 MSW 网关（mock 模式入口，main.ts 动态加载）。
 */
import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

export const browser = setupWorker(...handlers);
