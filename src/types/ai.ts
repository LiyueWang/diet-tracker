// 本地 AI 代理返回的数据形状。
// server/deepseek.ts 已经把模型的 snake_case 转成 camelCase，这里保持一致：
// 如果前端按 snake_case 声明，类型检查会通过但运行时字段全是 undefined。

export interface ParsedItem {
  name: string;
  weightG: number | null;
  quantityDesc?: string;
  itemType: 'food' | 'supplement';
  estimated: {
    proteinG: number;
    carbG: number;
    fatG: number;
    kcal: number;
  };
  confidence: number;
}

export interface ParsedResult {
  items: ParsedItem[];
}

export interface ReportResult {
  analysis: string;
  suggestions: string[];
}
