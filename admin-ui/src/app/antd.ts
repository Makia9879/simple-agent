/** Ant Design Vue 全局配置（语言、主题）。 */
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import dayjs from 'dayjs';

import 'dayjs/locale/zh-cn';

dayjs.locale('zh-cn');

export const CONFIG_PROVIDER_LOCALE = zhCN;

export const theme = {
  token: {
    colorPrimary: '#2f54eb',
    borderRadius: 6,
  },
};
