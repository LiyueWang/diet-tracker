import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  // 挂载点缺失说明 index.html 与入口不匹配，直接暴露比静默失败好排查
  throw new Error('index.html 中缺少 #root 挂载节点');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
