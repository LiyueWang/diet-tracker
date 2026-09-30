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
    // 请求根本没发出去：Vite 都没起，或者网络中断。
    // 原始报错（"Failed to fetch" 之类）留在 cause 里备查，给用户看的是能行动的那句。
    throw new Error('无法连接本地 AI 代理，请确认 npm run dev 已启动', { cause: error });
  }

  if (response.status === 429) {
    throw new Error(DAILY_LIMIT_MESSAGE);
  }

  // 502/503 是 Vite 代理在"后端进程没起或崩了"时返回的，504 是代理连上了但上游超时。
  // 这三种要和下面的通用分支分开报，否则用户只看到"AI 代理返回 HTTP 502"，
  // 不知道该去启哪个服务、还是该重试。
  if (response.status === 502 || response.status === 503) {
    throw new Error('AI 代理未就绪，请确认 server 已启动');
  }
  if (response.status === 504) {
    throw new Error('AI 代理响应超时，请重试');
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

export async function generateReport(
  payload: object,
  type: 'daily' | 'weekly',
  options?: { skipCache?: boolean },
): Promise<ReportResult> {
  return postJson<ReportResult>('/api/ai/report', {
    payload,
    type,
    // 「重新生成」要的是换一段文案。不带这个标记时，数据没变会命中服务端响应缓存，
    // 用户点完却看到一模一样的分析，会以为按钮坏了
    skipCache: options?.skipCache === true,
  });
}
