
# AGENTS.md — Diet Tracker

本文件是 Codex 在本项目中工作的规范约定。每次开始任务前先读本文件。

---

## 一、项目概述

个人饮食运动记录工具，第一版为纯本地 Web 开发版。
React + Vite + TypeScript + Dexie(IndexedDB) + 本地 Node AI 代理。

当前阶段：第一版，纯本地，不接云同步、不做登录、不做移动端。

---

## 二、目录结构

```
src/
  db/          Dexie schema 与 repo 封装，唯一数据访问层
  services/    业务逻辑：AI 调用、语音、营养计算、报告生成
  pages/       页面组件
  components/  可复用 UI 组件
  types/       TypeScript 类型定义
server/
  index.ts     Express 入口
  deepseek.ts  DeepSeek 调用封装
  cache.ts     内存缓存 + 每日调用限流
  prompt.ts    提示词模板
docs/          设计文档，只读，不要修改
```

---

## 三、命令

```bash
npm run dev          # 同时启动 Vite(5173) 和 AI 代理(8787)
npm run dev:web      # 只启动前端
npm run dev:server   # 只启动 AI 代理
npm run build        # 构建生产版本
npm run typecheck    # TypeScript 类型检查
```

---

## 四、代码规范

- TypeScript strict mode，禁止 `any`（除非有注释说明原因）
- 组件用函数式 + Hooks，不用 class 组件
- 文件命名：组件 PascalCase，工具函数 camelCase
- 数据库操作只允许通过 `src/db/repo.ts`，不要在页面里直接调 `db.*`
- 异步操作必须处理错误，不允许空 catch
- 注释写"为什么"，不写"做了什么"

---

## 五、禁止事项

- ❌ 不要修改 `src/db/schema.ts` 的表结构，如需变更先说明理由并等我确认
- ❌ 不要把 DeepSeek API Key 写进前端代码或提交到 git
- ❌ 不要引入 Supabase、Firebase、Capacitor 等第二版才用的依赖
- ❌ 不要引入 UI 组件库（用 Tailwind 手写）
- ❌ 不要一次修改超过 5 个文件，超过就拆成多个步骤
- ❌ 不要在前端直连 DeepSeek，所有 AI 调用必须经过 `server/`
- ❌ 不要删除或重命名已有函数，除非我明确要求

---

## 六、数据模型约定

所有表必须有：
- `id`: UUID 字符串，不用自增
- `updatedAt`: ISO 时间字符串
- 逻辑删除用 `deleted: 0 | 1`，不用物理删除

日期格式统一 `YYYY-MM-DD`，时间格式 `HH:mm`。

---

## 七、AI 调用约定

- 所有 AI 调用走 `server/`，前端只调 `/api/ai/parse` 和 `/api/ai/report`
- 解析结果必须经用户确认后才入库，不允许自动保存
- 食物库匹配在前端 `src/services/nutrition.ts` 完成，AI 只负责解析
- 未命中食物库的条目必须标记 `dataSource: 'ai_estimate'`
- 相同输入的解析结果缓存 24 小时
- 每日 AI 调用上限 50 次，超过返回 429

---

## 八、任务完成标准

每个阶段完成后必须满足：

1. `npm run typecheck` 无错误
2. `npm run dev` 能正常启动，无控制台报错
3. 新功能有最小可验证路径（见下方阶段验收）
4. 关键决策和踩坑记录追加到本文件的"九、开发日志"

### 各阶段验收

- **Phase 0**：Dexie 表能创建，能写入一条测试记录并在 DevTools 的 IndexedDB 中看到
- **Phase 1**：`curl -X POST localhost:8787/api/ai/parse -d '{"text":"200克鸡胸肉"}'` 返回合法 JSON
- **Phase 2**：浏览器中完成"输入文字 → 看到确认卡片 → 点击保存 → 今日汇总更新"全流程
- **Phase 3**：Chrome 中点击麦克风按钮，语音识别结果进入解析流程
- **Phase 4**：食物库和补剂方案能增删改查，食物库匹配逻辑经测试正确
- **Phase 5**：能生成日报并正确展示 PFC 占比

---

## 九、开发日志

> 每个阶段完成后，把关键决策和踩坑追加在这里。

### 2026-09-22 Phase 0
- 决策：Dexie 表用 UUID 主键，为后续云同步预留
- 踩坑：Dexie 的 `*aliases` 多值索引需在 schema 里显式声明
- 验证命令：`npm run dev` 后打开 DevTools > Application > IndexedDB

### 2026-09-23 Phase 0（脚手架与数据层）
- 决策：目录非空（已有 `AGENTS.md`、`src/db/schema.ts`、`server/prompt.ts`、`docs/`），
  不用 `npm create vite`，手写 `package.json` / `vite.config.ts` / `tsconfig.json` / `index.html`，
  避免覆盖已有文件
- 决策：`src/db/schema.ts` 已存在且与规格逐字一致，本阶段不重写，只核对
- 决策：`server/index.ts` 用 Express 5，当前只提供 `GET /api/health` 和 JSON 化的 404 / 400 处理；
  `/api/ai/*` 留给 Phase 1，`.env.local` 里的 `DEEPSEEK_API_KEY` 目前没有任何代码读取
- 决策：repo 层统一用读-合并-写实现 patch 更新，而不是直接 `table.update`，
  这样 `updatedAt` 必定刷新，且 id 不存在时直接抛错，不会出现"静默成功"
- 决策：`deleteItemsByMealId` / `deleteFood` / `deleteSupplement` 走物理删除，
  因为这三张表没有 `deleted` 字段；只有 `Meal` 用 `deleted = 1` 走逻辑删除
- 决策：`saveReport` 按 `reportType + dateStart` 覆盖写入，重复生成不堆积；
  `addPlan` 默认 `active = 0`（有 `setActivePlan` 兜底），`addSupplement` 默认 `active = 1`（无切换入口）
- 决策：`findFoodByName` 先匹配 `name` 再匹配 `aliases`，比较前去掉全部空白并转小写；
  归一化比较走不了索引，个人食物库量级下接受全表扫描
- 踩坑：`verbatimModuleSyntax` 不能开 —— `schema.ts` 里 `import Dexie, { Table } from 'dexie'`
  是值导入纯类型，开启后会报 TS1484，而该文件按约定不改
- 踩坑：`tsconfig.json` 的 `types` 只写 `["node"]`，`vite/client` 靠 `src/vite-env.d.ts` 的三斜线引用引入
- 踩坑：沙箱内 `vite build` / `tsx` 会因 esbuild 需要 spawn 而以 EPERM 失败，需在沙箱外运行，不是配置问题
- 验证命令：`npm run typecheck` 无错误；`npm run dev` 双进程正常启动后
  `curl localhost:5173/api/health` 返回 200，证明 Vite 的 `/api` 代理已转发到 8787
- 验收：在浏览器中跑通 59/59 项断言（临时验收页 `verify.html` + `src/db/verifyRepo.ts`，跑完已删除），
  覆盖全部 27 个 repo 函数、逻辑删除与物理删除的差异、`active` 唯一性与事务回滚、
  报告覆盖写、profile 合并写、`updatedAt` 刷新规则
- 验收：用原生 IndexedDB API（绕开 Dexie 元数据）独立确认库 `diet-tracker` 有 7 个对象仓库、
  索引与 stores 定义逐条一致、`foodLibrary.aliases` 的 `multiEntry === true`，测试记录已真实落库；控制台无报错
- 踩坑：`setActivePlan` 只刷新被改动的行，本来就 `active = 0` 的方案不重写 `updatedAt`，
  写验收断言时不能假设"所有非目标方案的时间戳都会变"
