// DeepSeek 调用封装：只负责"发请求 + 解析 + 校验 + 转成项目用的字段名"。
// 缓存和限流不在这里做，那是 server/index.ts 的职责。
import OpenAI from 'openai';

import { parsePrompt, reportPrompt } from './prompt';

export type ParsedItemType = 'food' | 'supplement';

export interface ParsedNutrition {
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
}

export interface ParsedItem {
  name: string;
  weightG: number | null;
  quantityDesc: string;
  itemType: ParsedItemType;
  estimated: ParsedNutrition;
  confidence: number;
}

export interface ParsedResult {
  items: ParsedItem[];
}

export interface ReportResult {
  analysis: string;
  suggestions: string[];
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const TEMPERATURE = 0.2;

/** 传输层错误只重试一次，延迟 1.5 秒 */
const TRANSPORT_RETRY_DELAY_MS = 1500;

/** undici / Node 的套接字级错误码，这些都不带 HTTP 状态，属于典型瞬时故障 */
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /terminated/i,
  /fetch failed/i,
  /other side closed/i,
  /socket hang up/i,
  /timed? ?out/i,
  /connection error/i,
];

// 惰性创建：dotenv 在 index.ts 里加载，而 ES module 的 import 会被提升，
// 模块顶层读 process.env 会拿到还没注入的值。
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) {
    return client;
  }
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY，请检查 .env.local 是否已填写');
  }
  client = new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
  });
  return client;
}

function getModel(): string {
  const model = process.env.DEEPSEEK_MODEL?.trim();
  if (!model) {
    throw new Error('缺少 DEEPSEEK_MODEL，请检查 .env.local');
  }
  return model;
}

/**
 * 把错误链摊平。Node 的 fetch/undici 报错常常只有一句 "terminated"，
 * 真实原因（比如 code=UND_ERR_SOCKET）藏在不打印就看不到的 cause 里。
 */
function describeError(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    const status = (current as { status?: unknown }).status;
    parts.push(
      [
        current.message,
        typeof code === 'string' ? `code=${code}` : '',
        typeof status === 'number' ? `status=${status}` : '',
      ]
        .filter((part) => part !== '')
        .join(' | '),
    );
    current = (current as { cause?: unknown }).cause;
  }

  return parts.length > 0 ? parts.join(' <- ') : String(error);
}

/**
 * 判断是否属于"值得再试一次"的传输层故障。
 * 只认套接字错误码、APIConnection* 异常和没有 HTTP 状态的连接类报错；
 * 带 status 的响应错误（4xx/5xx）一律不重试，避免把参数错误也重打一遍。
 */
function isTransientTransportError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);

    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) {
      return true;
    }

    if (current.constructor.name.includes('APIConnection')) {
      return true;
    }

    const status = (current as { status?: unknown }).status;
    // 先取到局部常量：闭包里读被重新赋值的 current 会丢掉类型收窄
    const message = current.message;
    if (typeof status !== 'number' && TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * SDK 自己已经会重试 2 次，但那 3 次尝试都挤在 1-2 秒内，
 * 网络抖动持续几秒时会被整体吞掉（实测出现过连续 3 次都报 terminated）。
 * 所以这里隔一段时间再补一次，覆盖更晚的时间窗口。
 */
async function withTransportRetry<T>(run: () => Promise<T>, context: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isTransientTransportError(error)) {
      throw error;
    }
    console.warn(
      `[deepseek] 传输层失败，${TRANSPORT_RETRY_DELAY_MS}ms 后重试一次（${context}）：${describeError(error)}`,
    );
    await delay(TRANSPORT_RETRY_DELAY_MS);
    return run();
  }
}

/** 让模型按 system 提示词返回一个 JSON 对象，失败时抛出带上下文的错误 */
async function requestJsonObject(systemPrompt: string, userContent: string, context: string): Promise<Record<string, unknown>> {
  let content: string | null | undefined;
  try {
    const completion = await withTransportRetry(
      () =>
        getClient().chat.completions.create({
          model: getModel(),
          temperature: TEMPERATURE,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        }),
      context,
    );
    content = completion.choices[0]?.message?.content;
  } catch (error) {
    throw new Error(`调用 DeepSeek 失败（${context}）：${describeError(error)}`, { cause: error });
  }

  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error(`DeepSeek 返回了空内容（${context}）`);
  }

  // 提示词里明确要求不要 ```json 包裹，但模型偶尔仍会带上，这里做一次兜底剥离
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    const preview = cleaned.slice(0, 200);
    throw new Error(`DeepSeek 返回的内容不是合法 JSON（${context}）：${preview}`, { cause: error });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`DeepSeek 返回的 JSON 不是对象（${context}）`);
  }
  return parsed as Record<string, unknown>;
}

function readNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  // 模型有时把数值写成字符串
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toParsedNutrition(value: unknown): ParsedNutrition {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    proteinG: readNumber(source.protein_g),
    carbG: readNumber(source.carb_g),
    fatG: readNumber(source.fat_g),
    kcal: readNumber(source.kcal),
  };
}

/**
 * 模型输出用 snake_case，项目其余部分（schema.ts / repo.ts）都是 camelCase，
 * 在这里一次性转换，前端拿到的对象可以直接映射成 FoodItem。
 * 字段缺失或类型不对时抛错，不静默产出半截数据。
 */
function toParsedResult(raw: Record<string, unknown>): ParsedResult {
  const rawItems = raw.items;
  if (!Array.isArray(rawItems)) {
    throw new Error('DeepSeek 解析结果缺少 items 数组');
  }

  const items = rawItems.map((entry, index) => {
    const item = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const name = readString(item.name).trim();
    if (!name) {
      throw new Error(`DeepSeek 解析结果的第 ${index + 1} 个条目缺少 name`);
    }

    const rawWeight = item.weight_g;
    const weightG = rawWeight === null || rawWeight === undefined ? null : readNumber(rawWeight, 0);
    const rawItemType = readString(item.item_type, 'food');

    return {
      name,
      weightG,
      quantityDesc: readString(item.quantity_desc),
      itemType: rawItemType === 'supplement' ? 'supplement' : 'food',
      estimated: toParsedNutrition(item.estimated),
      confidence: Math.min(Math.max(readNumber(item.confidence), 0), 1),
    } satisfies ParsedItem;
  });

  return { items };
}

function toReportResult(raw: Record<string, unknown>): ReportResult {
  const analysis = readString(raw.analysis).trim();
  if (!analysis) {
    throw new Error('DeepSeek 报告结果缺少 analysis');
  }

  const rawSuggestions = raw.suggestions;
  const suggestions = Array.isArray(rawSuggestions)
    ? rawSuggestions.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];

  return { analysis, suggestions };
}

export async function callParse(text: string): Promise<ParsedResult> {
  const raw = await requestJsonObject(parsePrompt, text, 'parse');
  return toParsedResult(raw);
}

export async function callReport(payload: object, type: 'daily' | 'weekly'): Promise<ReportResult> {
  const userContent = [`报告类型：${type === 'daily' ? '日报' : '周报'}`, '饮食数据：', JSON.stringify(payload)].join('\n');
  const raw = await requestJsonObject(reportPrompt, userContent, `report:${type}`);
  return toReportResult(raw);
}
