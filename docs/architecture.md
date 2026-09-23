

## 一、第一版架构

浏览器 React + Vite + TS
  ├─ Dexie / IndexedDB        主存储
  ├─ Web Speech API           语音转文字
  ├─ 业务计算                  热量/PFC 汇总、食物库匹配
  └─ fetch /api/ai/*
        ↓
本地 Node 代理（Express / Vite 插件）
  ├─ 缓存 + 限流
  └─ DeepSeek API

关键点：AI 调用不要从前端直连 DeepSeek。 即使本地开发，也建议走一个本地 Node 代理，API Key 放 .env.local，不暴露到浏览器 DevTools 和构建产物里。

## 二、技术栈

层	          选择
框架	    React 18 + Vite + TypeScript
本地数据库	 Dexie.js（IndexedDB 封装）
状态	    Zustand 或 React Context
UI	        Tailwind CSS + 轻量组件
语音	    Web Speech API（Chrome/Edge）
AI 代理	    Express + DeepSeek SDK
图表	    Recharts / ECharts
开发启动	concurrently 同时跑 Vite + 代理


## 三、项目目录结构

diet-tracker/
├── src/
│   ├── db/
│   │   ├── schema.ts          # Dexie 表定义
│   │   └── repo.ts            # 增删改查封装
│   ├── services/
│   │   ├── ai.ts              # 调 /api/ai/parse 和 /api/ai/report
│   │   ├── speech.ts          # Web Speech API 封装
│   │   ├── nutrition.ts       # 食物库匹配、热量计算
│   │   └── report.ts          # 本地聚合日报/周报
│   ├── pages/
│   │   ├── Today.tsx          # 今日汇总
│   │   ├── Record.tsx         # 记录页
│   │   ├── FoodLibrary.tsx    # 食物库
│   │   ├── Supplements.tsx    # 补剂方案
│   │   ├── Reports.tsx        # 日报/周报
│   │   └── Settings.tsx       # 档案、目标、导入导出
│   ├── components/
│   └── types/
├── server/
│   ├── index.ts               # Express 入口
│   ├── deepseek.ts            # DeepSeek 调用
│   ├── cache.ts               # 内存缓存 + 限流
│   └── prompt.ts              # 解析/报告提示词
├── .env.local                 # DEEPSEEK_API_KEY，不提交
├── vite.config.ts
└── package.json

## 四、IndexedDB 数据模型（Dexie）

所有表都预留 id（UUID）、updatedAt、deleted，方便以后迁移到 Supabase。

./src/db/schema.ts

## 五、AI 调用：本地代理 + 缓存 + 限流

### 5.1 本地代理

server/index.ts 用 Express 暴露两个接口：

POST /api/ai/parse：自然语言 → 结构化食物条目

POST /api/ai/report：结构化汇总 → 日报/周报文本

### 5.2 解析提示词

### 5.3 食物库优先逻辑

## 六、语音输入

本地开发用 Chrome 测试。

## 七、页面与功能

|--|--|
|页面	 | 功能 |
|Today	      | 今日总热量、PFC、补剂单独统计、进度对比目标 |
|Record	      | 语音/文字输入、AI 解析确认卡片、编辑、保存、存为常用 |
|FoodLibrary	| 食物库增删改查、搜索、别名、每 100g 营养 |
|Supplements	| 补剂方案增删改查、一键添加到加餐 |
|Reports	   | 生成日报/周报、查看 AI 分析、历史报告 |
|Settings	   | 档案、TDEE/目标计算、导入导出 JSON |


日报/周报的计算在本地完成，AI 只负责生成分析文本。