import express from 'express';

const PORT = Number(process.env.PORT ?? 8787);

const app = express();

// AI 请求的文本都走 JSON body，限制体积避免误传整份日报
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'diet-tracker-ai-proxy', port: PORT });
});

// 未命中的 /api 统一回 JSON：前端 fetch 拿到 HTML 404 会在解析处炸掉，难以定位
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// express.json 遇到非法 JSON 会抛错，默认处理器返回 HTML，同样会让前端解析失败
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] 请求处理失败:', err.message);
  res.status(400).json({ error: 'bad_request', message: err.message });
});

app.listen(PORT, () => {
  console.log(`[server] AI 代理已启动: http://localhost:${PORT}`);
});
