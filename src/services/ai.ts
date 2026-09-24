// 只负责对本地 AI 代理发请求，不含任何业务逻辑。
// 前端不允许直连 DeepSeek，路径固定为 /api/ai/*（由 Vite 代理转发到 8787）。
import type { ParsedResult, ReportResult } from '../types/ai';

const DAILY_LIMIT_MESSAGE = 'AI 调用已达上限';

/** 解析失败返回 undefined 而不抛错：错误正文可能是 HTML，抛出去反而盖住真正的失败原因 */
function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const raw = await response.text();
  const parsed = parseJsonObject(raw);
  const message = parsed?.error;
  if (typeof message === 'string' && message !== '') {
    return message;
  }
  // 代理返回的不是标准 { error }，把正文截一段出来，比"HTTP 500"更容易定位
  return raw.trim() === '' ? `AI 代理返回 HTTP ${response.status}` : raw.slice(0, 200);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // 代理没启动时 fetch 只会抛 "Failed to fetch"，调用方拿不到任何可行动的信息
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接本地 AI 代理（${path}）：${detail}`, { cause: error });
  }

  if (response.status === 429) {
    throw new Error(DAILY_LIMIT_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new Error(`AI 代理返回的内容不是合法 JSON（${path}）`, { cause: error });
  }
}

export async function parseText(text: string): Promise<ParsedResult> {
  return postJson<ParsedResult>('/api/ai/parse', { text });
}

export async function generateReport(payload: object, type: 'daily' | 'weekly'): Promise<ReportResult> {
  return postJson<ReportResult>('/api/ai/report', { payload, type });
}
