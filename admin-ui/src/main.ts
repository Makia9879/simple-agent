/**
 * 应用入口：mock 模式先启动 MSW 网关，再挂载 SPA。
 */
import Antd from 'ant-design-vue';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router';
import { USE_MOCK } from '@/config';

import 'ant-design-vue/dist/reset.css';
import './styles/main.css';

async function bootstrap(): Promise<void> {
  if (USE_MOCK) {
    const { browser } = await import('./mocks/browser');
    await browser.start({
      onUnhandledRequest(request, print) {
        // mock 网关只应处理 /api/v1/*；其余请求警告提示，便于发现契约偏差
        if (request.url.includes('/api/')) {
          print.warning();
        }
      },
      serviceWorker: { url: '/mockServiceWorker.js' },
    });
  }

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(Antd);
  app.mount('#app');
}

void bootstrap();
