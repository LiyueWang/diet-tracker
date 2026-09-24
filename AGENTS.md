
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
  - ❌ 不要引入 antd / mui / shadcn 等 UI 组件库
  - ✅ 样式统一用 Tailwind CSS v4，通过 @tailwindcss/vite 插件集成
  - ❌ 不要安装 postcss、autoprefixer，不要创建 tailwind.config.js
  - ❌ 不要使用 @tailwind base / components / utilities 旧指令
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
- **Phase 1**：`curl -X POST localhost:8787/api/ai/parse -H "Content-Type: application/json" -d '{"text":"200克鸡胸肉"}'` 返回合法 JSON
  （`Content-Type` 必须显式指定：curl 的 `-d` 默认发 `application/x-www-form-urlencoded`，
  那样 `express.json()` 不会解析 body，接口会返回 `400 {"error":"text is required"}`）
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

### 2026-09-23 Phase 1（AI 本地代理）
- 决策：DeepSeek 走 `openai` SDK + `baseURL=https://api.deepseek.com`；客户端惰性创建，
  因为 ESM 的 import 会被提升，模块顶层读 `process.env` 会拿到 dotenv 注入之前的值
- 决策：`/api/ai/parse`、`/api/ai/report` 对外返回 camelCase（`weightG` / `itemType` / `proteinG`），
  把模型的 snake_case 在 `server/deepseek.ts` 里一次性转换，Phase 2 可直接映射成 `FoodItem`
- 决策：响应头带 `X-Cache: HIT|MISS`，用于确认缓存命中，不改 body 结构
- 决策：`incrementCall()` 只在调用成功后执行 —— 缓存命中和失败的请求都不消耗额度；
  查缓存发生在 `canCall()` 之前，所以额度用完时缓存命中依然返回 200
- 决策：`server/cache.ts` 除规定的 5 个函数外还导出 `hashString` / `getCacheTtlHours` / `getDailyLimit`；
  hash 结果拼接输入长度，降低 32 位 hash 的碰撞风险
- 决策：每日计数按**本地日期**（YYYY-MM-DD）重置，不用 UTC，否则时区东八区会在早上 8 点才跨天
- 决策：保留 Phase 0 的 `GET /api/health`；启动日志固定为 `AI proxy on http://localhost:PORT`
- 踩坑：curl 的 `-d` 默认 Content-Type 是 `application/x-www-form-urlencoded`，不加
  `-H "Content-Type: application/json"` 时 `express.json()` 不解析 body，接口返回
  `400 {"error":"text is required"}` —— 原 Phase 1 验收命令漏了这个头，已修正
- 踩坑：Node 的 fetch/undici 报错可能只有一句 `terminated`，真实原因在 `error.cause` 里
  （例如 `code=UND_ERR_SOCKET`）；`deepseek.ts` 现在会把 cause 链摊平打印。
  曾出现过一次无规律的 `terminated`，重试 6 次未复现，判定为瞬时 socket 失败
- 决策：传输层故障额外重试一次、延迟 1500ms。判据是套接字错误码
  （`ECONNRESET` / `UND_ERR_SOCKET` / 各类 timeout 等）、`APIConnection*` 异常，
  或没有 HTTP 状态的连接类报错；带 status 的响应错误一律不重试
- 踩坑：openai SDK 自带 `maxRetries=2`，它那 3 次尝试都挤在 1-2 秒内，
  所以网络抖动持续几秒时会被整体吞掉 —— 额外这次延迟就是为了覆盖更晚的时间窗口，
  不是简单叠加。若将来要改，注意别把总尝试次数叠成 6 次以上
- 验证：把 `DEEPSEEK_BASE_URL` 指向死端口，请求耗时 4.22s、日志恰好出现 1 次重试告警、
  最终报错为 `Connection error. <- fetch failed <- bad port`；
  指向返回 404 的本地服务时耗时 0.13s 且无重试告警，证明状态码错误不会被重试
- 踩坑：曾误判 `deepseek-flash` 不是有效模型名，实际是 DeepSeek-V4.1-Flash。
  判断模型是否可用要查 `GET https://api.deepseek.com/models`，不要靠记忆
- 踩坑：PowerShell 命令行里的中文有被转坏的风险，需要传中文 body 时用
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` 写无 BOM 文件 +
  `curl.exe --data-binary "@file"`，否则 `express.json()` 可能直接 400
- 验证命令：`npm run dev:server` 后
  `curl -X POST localhost:8787/api/ai/parse -H "Content-Type: application/json" -d '{"text":"中午吃了200克鸡胸肉和150克米饭"}'`
  正确拆出「鸡胸肉 200g」「米饭 150g」两条 items；同一文本第二次请求返回 `X-Cache: HIT`；
  把 `AI_DAILY_LIMIT` 临时设为 2 后，第 3 条不同文本返回 `429 {"error":"Daily AI call limit reached"}`，
  而重复已缓存文本仍返回 200

### 2026-09-24 Phase 2（Record 页 + Today 汇总页）
- 决策：Tailwind CSS v4 走 `@tailwindcss/vite` 插件，不装 postcss/autoprefixer、不建 `tailwind.config.js`；
  样式入口 `src/index.css` 只有一行 `@import 'tailwindcss'`
- 决策：`src/types/ai.ts` 用 camelCase（`weightG` / `itemType` / `estimated.proteinG`），
  与 `/api/ai/parse` 的实际响应一致。规格里写的是 snake_case，照抄会让类型与网络不符：
  TS 检查能过，运行时字段全是 `undefined`
- 决策：命中食物库但缺克数时，`dataSource` 仍标 `food_library` 并保留 `foodLibraryId`，
  数值暂用 AI 估算占位；用户在卡片上补克数后按食物库重算（否则"库"这个标签是假的）
- 决策：确认卡片的行用本地 key（`crypto.randomUUID`）而不是数组下标 —— 删掉中间一行会让
  React 复用错输入框（焦点乱跳）、"已存入"状态也会串到别的行
- 决策：`src/services/date.ts` 收拢 `todayIso` / `nowHhMm` / `describeDay`，避免各页面各拼一份
- 踩坑：Playwright 的 `fill()` 对 `<input type="time">` 不触发 React 的 `onChange`：
  DOM 值看起来改了，但 state 没变，一旦重渲染就被拉回旧值（表现为"时间改了没保存"）。
  用真实按键（click + `pressSequentially`）才行。这不是应用的问题
- 验证：浏览器里跑通"输入 → 解析 → 确认卡片 → 保存 → 今日汇总"，
  卡片数值与总览一致（394 kcal = P49.9/C38.9/F4.1）；保存后跳转 Today 并提示「已保存」

### 2026-09-24 Phase 2.5（编辑与删除入口）
- 决策：`replaceMealItems` 用 Dexie 事务包住"先删后插"，避免中途失败留下空餐次；
  事务作用域必须同时声明 `db.meals` —— `addFoodItems` 会读它校验餐次是否存在，
  而 Dexie 对事务未声明表的访问会抛 `NotFound: Table meals not part of transaction`
- 决策：Today 从"按餐次类型合并"改成"一条记录一个卡片"。合并后一个分区里可能有多个
  `meal.id`，编辑/删除按钮无法定位；空餐次类型仍显示一个「暂无记录」占位卡
- 决策：删除顺序固定为 `deleteItemsByMealId` → `softDeleteMeal`（先清条目再软删餐次），
  反过来会留下"餐次已标记删除、条目还挂在上面"的残骸
- 决策：Toast 显示后立刻 `navigate(pathname, { replace: true, state: null })` 清掉 router state，
  否则刷新会重放；`replace: true` 是必须的，不然返回键会回到带 toast 的那一页
- 踩坑：清 state 会让读 state 的 effect 重入一次、执行上一次的 cleanup —— 如果自动隐藏的
  定时器挂在那里，刚设好就会被取消，提示永远不消失。必须把定时器拆成独立的 effect（依赖 `notice`）
- 踩坑：`getItemsByMealId` 原本 `sortBy('createdAt')`，而 `addFoodItems` 给同批写入的行
  **同一个时间戳**，同键顺序会跟着主键（UUID）走；`replaceMealItems` 重插后 UUID 全新，
  条目顺序就乱跳（表现为"编辑保存后条目顺序变"）。修法：主修 = 写入时按序号递增 1ms，
  兜底 = 读取时按 `(createdAt, id)` 内存排序
- 踩坑：Dexie 的 `sortBy` 只接受单个排序键，`(createdAt, id)` 这种复合顺序只能取回后在内存里排；
  建复合索引等于改 `schema.ts` 表结构，按约定不做
- 踩坑：软删除的 meal 不会连带清理它的 items（本阶段按要求保持原样），
  所以**删除流程必须自己先清条目**；将来若有代码不经过 meals 直接聚合 items，要注意这些孤儿行
- 踩坑：内置浏览器的 `playwright.evaluate` 是只读沙盒，取不到 modules / `crypto` / `indexedDB` /
  `history`，所以数据库层面的验证（`deleted` 字段、物理删除）只能在真实 DevTools 里人工做一次
- 验证：A1–A12 全部通过（新建链路、食物库匹配与等比换算、needsWeight 拦截、改克数/餐次/时间、
  内联删除确认、不存在的 id、新建回归、同类型多卡片互不影响、编辑往返顺序稳定、toast 刷新不重放）；
  数据库层面 B1/B2 由人工在 DevTools 确认
