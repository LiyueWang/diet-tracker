import { fileURLToPath } from 'node:url';

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

import {
  canCall,
  getCache,
  getCacheTtlHours,
  getStatus,
  hashString,
  incrementCall,
  setCache,
} from './cache';
import { callParse, callReport } from './deepseek';
import type { ParsedResult, ReportResult } from './deepseek';

// 用文件位置而不是 CWD 定位 .env.local：从别的目录启动 npm 脚本时 CWD 不一定是项目根
dotenv.config({ path: fileURLToPath(new URL('../.env.local', import.meta.url)) });

const PORT = Number(process.env.SERVER_PORT ?? 8787);

const app = express();

// 本地开发，前端可能直接打 8787，也可能走 Vite 代理，两种都放开
app.use(cors());
// AI 请求的文本都走 JSON body，限制体积避免误传整份日报
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'diet-tracker-ai-proxy', port: PORT });
});

// 当日额度用完时用过的次数，方便调试时对照 /api/ai/status
app.get('/api/ai/status', (_req, res) => {
  res.json(getStatus());
});

app.post('/api/ai/parse', async (req, res) => {
  const body = req.body as { text?: unknown } | undefined;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const cacheKey = `parse:${hashString(text)}`;
  const cached = getCache<ParsedResult>(cacheKey);
  if (cached) {
    // 命中缓存不消耗额度，也不打印业务日志，只有响应头能区分，所以显式标记
    res.setHeader('X-Cache', 'HIT');
    res.json(cached);
    return;
  }

  if (!canCall()) {
    res.status(429).json({ error: 'Daily AI call limit reached' });
    return;
  }

  const result = await callParse(text);
  setCache(cacheKey, result, getCacheTtlHours());
  incrementCall();
  res.setHeader('X-Cache', 'MISS');
  res.json(result);
});

app.post('/api/ai/report', async (req, res) => {
  const body = req.body as { payload?: unknown; type?: unknown } | undefined;
  const type = body?.type;
  const payload = body?.payload;

  if (type !== 'daily' && type !== 'weekly') {
    res.status(400).json({ error: 'type must be daily or weekly' });
    return;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    res.status(400).json({ error: 'payload must be an object' });
    return;
  }

  const cacheKey = `report:${type}:${hashString(JSON.stringify(payload))}`;
  const cached = getCache<ReportResult>(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.json(cached);
    return;
  }

  if (!canCall()) {
    res.status(429).json({ error: 'Daily AI call limit reached' });
    return;
  }

  const result = await callReport(payload, type);
  setCache(cacheKey, result, getCacheTtlHours());
  incrementCall();
  res.setHeader('X-Cache', 'MISS');
  res.json(result);
});

// 未命中的 /api 统一回 JSON：前端 fetch 拿到 HTML 404 会在解析处炸掉，难以定位
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// 统一错误出口。Express 5 会把 async 处理器里抛出的异常自动转到这里，
// 所以路由内不需要再套 try/catch；body-parser 的非法 JSON 也走这里（自带 status 400）。
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const rawStatus = (err as { status?: unknown })?.status;
  const status = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[server] 请求处理失败(${status}):`, message);
  res.status(status).json({ error: message });
});

if (!process.env.DEEPSEEK_API_KEY) {
  console.warn('[server] 未读到 DEEPSEEK_API_KEY，/api/ai/* 会返回 500，请检查 .env.local');
}

app.listen(PORT, () => {
  console.log(`AI proxy on http://localhost:${PORT}`);
  console.log(
    `[server] model=${process.env.DEEPSEEK_MODEL ?? '(未设置)'} 每日上限=${getStatus().limit} 缓存 TTL=${getCacheTtlHours()}h`,
  );
});
