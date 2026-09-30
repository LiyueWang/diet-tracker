
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
- **Phase 5**：能生成日报/周报并正确展示 PFC 占比；`/analysis` 的达标统计与两张趋势图
  和报告页对同一区间算出的数值一致，且不消耗 AI 额度

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

### 2026-09-28 Phase 2.6（kcal 一律派生 + 克数联动修正 + 草稿持久化）
- 决策：全系统采用方案 2 —— **kcal 不独立存储，一律由 P/F/C 按 4/4/9 派生**。
  `nutrition.ts` 新增 `recalcKcal`，`applyFoodLibrary` 的**三个分支**（命中且带克数 /
  命中但缺克数 / 未命中）全部改成派生，不再采用食物库标的 kcal 或模型返回的 `estimated.kcal`
- 决策：`calcKcalFromPFC` 保留为 `recalcKcal` 的薄封装。规格里让"没有就补"的 `recalcKcal`
  其实已存在（叫 `calcKcalFromPFC`），而 AGENTS 禁止重命名已有函数，所以两个名字共用一份实现
- 决策：`scaleNutrition` 里 kcal 用 `recalcKcal(缩放后的 P/F/C)` 重算，而不是 `base.kcal * factor`；
  数学上等价，但保证全系统只有一条派生路径
- 决策：克数变化分三条路径 —— A1 已有重量改重量（等比缩放 + `dataSource` 不变）、
  A2 无重量补克数（命中食物库按 `perAmount` 重算，未命中只更新克数保留 AI 估算）、
  A3 清空克数（不缩放，置 null 交给校验拦截）。规格里原本写"needsWeight 不允许改重量"是错的，
  那样永远补不上克数、也永远存不了
- 决策：`AppliedItem.dataSource` 从两态放宽为三态（新增 `'manual'`），用户手改 P/F/C 后标记；
  确认卡片的来源标签相应变成 库 / AI / 手动
- 决策：热量在确认卡片和「存为常用」表单里都改成**只读派生**；`SaveAsFoodForm` 的
  `defaultPer100g` 去掉 `kcal` 字段（不再接受外部传入的独立热量）
- 决策：草稿存 `sessionStorage`（不是 localStorage）——草稿只在当前标签页会话里有意义；
  key 为 `draft:record:new` / `draft:record:edit:<mealId>`，结构含 `savedAt` 用于 24 小时过期判断
- 决策：草稿写入用 500ms 防抖，**借用 effect 的 cleanup 实现**（每次变化取消上一个定时器，
  卸载时也不会写入过期数据）；空表单不写草稿，否则光是打开页面再回来就会弹"已恢复"
- 决策：挂载恢复分两种待遇 —— 新建模式读草稿并弹提示条；编辑模式**不读**草稿（数据库才是事实来源），
  但会清掉可能残留的编辑草稿
- 决策：从 edit 切回 new 时既要**清空表单**又要**静默恢复草稿（不弹提示条）**。
  清空是必须的：两种模式共用同一个组件实例，不清空就会把上一条记录的数据留在"新建"表单里，
  一点保存就多出一条重复记录；静默是因为从编辑页切回来的用户刚从上下文里出来，
  看到表单里原样出现自己刚写的内容是自然预期
- 决策：`skipNextDraftWriteRef` + `ownsDraftRef` 两个标记配合 ——
  前者让"模式切换那一轮"跳过草稿写入，后者保证只有"自己写过或恢复过"的草稿，
  才允许在表单被清空时删掉
- 决策：本阶段只写新建模式草稿。编辑模式草稿只写不读会变成死数据，收益为零；
  `makeEditDraftKey` 仍然实现，供将来使用
- 踩坑：验收清单 1.2 写的预期热量 366.6 是算错的，`80*4 + 0*4 + 5.4*9 = 368.6`；
  用户已确认按实现为准
- 踩坑：食物库里的 kcal 和它的 P/F/C 本来就可能对不上（Phase 0 写的鸡胸肉 23/1.8/110，
  而 `recalcKcal(23,0,1.8)=108.2`）。方案 2 生效后，库行第一次被动改克数时 kcal 会跳到派生值
  （200g 从 220 变 216.4）—— 这是预期行为，不是 bug
- 踩坑：**编辑模式切回新建模式会残留上一条记录的数据**（标题已是"记录饮食"但卡片还是上一条），
  此时保存会新建一条重复记录。这是本次实测发现的真实缺陷，修法是切换时 `resetForm()`
- 踩坑：模式切换引起的清空会让草稿 effect 跑一轮 —— 会排一个写入定时器（好在下一轮 cleanup
  就取消了），更麻烦的是会走进"空表单清草稿"分支，把用户切到编辑页之前的 `draft:record:new` 删掉。
  只加"跳过写入"挡不住，必须同时给"清草稿"加归属判断
- 踩坑：规格说的"空值不触发 onChange"在 React 里做不到（受控输入被清空一定会触发）。
  实现成：不缩放 + `weightG` 置 null，由保存校验拦截，效果与规格的预期一致
- 踩坑：沙箱里的 `playwright.evaluate` 是只读沙盒，取不到 modules / `crypto` / `indexedDB` /
  `sessionStorage` / `history`。所以夹具注入和 7.1 的数据库检查只能靠**临时页面**跑真代码
  （和 Phase 0 的验收页同一手法，跑完即删）
- 踩坑：写自动化脚本时按固定下标连点"删除"会误删 —— 删掉一张卡片后后面的索引整体前移
- 验证：用验收清单指定的固定夹具（鸡胸肉 P23/C0/F1.8/110、鸡蛋 P13/C0/F9/133，
  夹具 kcal 本身也按 4/4/9 派生）跑完清单。**必过项全部通过**：
  1.1（200g→P46/F3.6/216.4，300g→P69/F5.4/324.6，来源保持"库"）、
  1.2（改 P 只重算 kcal 并转"手动"，实测 368.6）、
  2.1（鸡蛋补 50g → P6.5/F4.5/66.5，来源"库"）、
  2.2（未命中的奇异果补 100g，P/F 保持 AI 估算不变、来源"AI"）、
  3.1 / 3.4（草稿恢复与保存后清除）、
  4.2（切回 new 恢复卡片，餐次/时间保持切走前的值、无提示条）、
  4.3（切回后保存是新建：编辑目标 `updatedAt` 保持 `2026-09-28T01:59:11.300Z` 未变，
  同时新增一条记录）
- 验证：回归项五/六/七通过 —— toast 刷新不重放、`edit=fake-id` 显示"记录不存在"、
  同类型多卡片互不影响、某餐次清空后退回占位卡、编辑往返条目顺序稳定、删除后刷新仍不在；
  数据库层面 13 条软删记录的 `items` 全为 0、所有 meal 的 items `createdAt` 唯一、孤儿 items 0 条
- 验证：3.8 / 4.4 / 5.1 / 5.2 四条"要直接读写 `sessionStorage`"的项也验证掉了。
  做法是再加一个临时页：用 `Object.defineProperty` 把 `sessionStorage` 换成内存实现，
  然后调**真实的** `draft.ts` 函数。结果：非法 JSON / 结构不符 / 超过 24 小时三种输入
  都返回 null 且 key 被清掉，三条 `console.warn` 的原因文字与预期一一对应；
  另外加了阳性对照（合法草稿必须能读出，防止"永远返回 null"冒充通过）与 23 小时的边界
  （仍在有效期内、可恢复）。跑完临时页已删除
- 待人工：只剩 3.6 / 7.2 两条"在 DevTools 里肉眼确认 key"的项，且已被行为证据间接覆盖
  （挂载时能恢复说明 key 存在，保存后不恢复说明已清除）
- 说明：4.4 的行为（切回 new 时空表单、不弹提示条）由 `loadDraft` 返回 null 推出，
  与挂载路径调的是同一个函数；没有在真实 App 的 tab 里塞过期草稿走一遍切换路径，
  因为那个 tab 的 `sessionStorage` 沙箱工具够不到

### 2026-09-28 Phase 3（语音输入）
> 本阶段进行中，先记第一步（`src/services/speech.ts`）的实现补充，其余随进度追加。

- 实现补充：`SpeechRecognition` 的类型用**最小结构类型 + `as unknown as SpeechWindow` 收窄**，
  不引第三方 `@types/dom-speech-recognition` 之类的包 —— 那个包会把整个 API 表面全带进来，
  而实际只用到 `start` / `stop` / `onresult` / `onerror` / `onend` 五个成员。
  这些类型声明留在 `speech.ts` **内部不导出**：对外只暴露业务接口
  （`startRecognition` / `SpeechError` / `isSpeechSupported` / `getErrorMessage`），
  调用方不需要接触底层类型
- 实现补充：`speech.ts` 内部的 `finish()` **必须幂等**（`finished` 标志），保证 `onEnd` 只触发一次。
  触发路径有三条：`onend` 事件、`stop()` 抛错的 catch、`start()` 抛错的 catch；
  如果 `finish()` 不幂等，调用方会收到重复的 `onEnd`，一旦 onEnd 里有副作用（清 ref、写日志）就会重复执行。
  另外 `start()` 抛错时必须**先 `onError` 再 `onEnd`** —— 反过来的话，调用方是"先退出录音状态、
  再弹错误提示"，用户视觉上会错位
- 实现补充：`onResult` 只在 `transcript.trim() !== ''` 时触发，防止空格污染输入框。
  Chrome 在"没听到声音"时一般走 `onerror('no-speech')`，空 transcript 比较罕见，
  但可能出现在低置信度、实现差异、服务返回空值等情况 —— 罕见不等于不写，
  输入框里莫名多一个空格是那种最难查的 bug
- 决策：**用户主动取消不算错误**。用户在识别过程中点停止时，浏览器通常也会派发 `aborted`，
  但 `onError` 是留给"用户需要知道、可能需要采取行动"的情况（权限被拒、网络异常、
  没听清），主动取消只该安静结束。所以 `speech.ts` 内部记一个 `userStopped` 标志：
  `stop()` 置位，`onerror` 收到 `aborted` 且该标志为真时**不报错**、直接收尾走 `onEnd`，
  `finish()` 里复位。这样"这次 aborted 是不是我点的"这个判断留在语音层，
  Record 页不需要维护额外标志位，也不用去纠结"用户点了停止但 aborted 晚到两秒"该怎么算
- 决策：麦克风按钮的可访问性处理 ——
  ① 用 `aria-pressed` 表达 toggle 语义（点一次开始、再点一次停止），
  ② `aria-label` 描述**动作**而不是复述可见文案：未录音时"开始语音输入"、录音中"停止语音输入"
  （读屏用户听到"停止语音输入，已选中"才推得出当前状态，听到"未选中"推不出来），
  ③ 录音中的**可见文案用"停止"**，让它被可访问名包含 —— 语音控制用户照着屏幕上的字念得出来
  （WCAG 2.5.3 Label in Name）；"正在录音"这层信息由脉冲动画 + 红色 + 方形停止图标承担，
  ④ 禁用（浏览器不支持）时**不带 `aria-pressed`**：同时说"不可用"和"未选中/已选中"只会让读屏混乱
- 验证：**场景 B**（临时在 `index.html` 注入 `delete window.SpeechRecognition` 模拟不支持）
  由我在内置浏览器里跑通 —— 麦克风按钮存在且 `disabled`、`aria-pressed` 为 null（角色回到普通 button）、
  外层 span 带 `title="当前浏览器不支持语音输入，请使用 Chrome 或 Edge"`、
  文字输入 / 餐次按钮 / 解析按钮均正常、控制台 0 报错；测完那行注入已删除，
  删掉后按钮立即恢复成可点的"开始语音输入"（走支持分支）
- 验证：**场景 C**（编辑模式）无麦克风按钮、也无解析按钮 ✅
- 验证：**场景 F 的可观察部分** —— 点麦克风进入录音状态后切到 Today（组件卸载触发 cleanup 调 `stop()`），
  再切回 `/record` 时按钮已是初始态、无残留的"停止"状态、控制台 0 报错。
  但"麦克风是否真的被释放"要看浏览器标签页的麦克风图标，那个我观察不到
- 验证：**方案 C（主动取消不算错误）在真实浏览器里成立** —— 录音中点停止后按钮回到"开始语音输入"，
  输入区下方没有出现任何提示条
- 验证：场景 A（Firefox 天然不支持）与场景 D / E / G（真实语音识别、权限被拒、
  追加到已有文字）由用户在真实浏览器里人工验证通过。至此 **Phase 3 的 A–G 七个场景全部通过**，
  分工是：C 我在内置浏览器验的；B 我靠临时改 `index.html` 注入验的；F 我验了可观察部分
  （状态干净、无报错），"麦克风是否真的释放"归人工；A / D / E / G 由人工在 Chrome / Firefox 验
- 说明：3.3 的三条已知限制（局域网 IP 不是安全上下文、Safari 支持不保证、
  Chrome 识别依赖 Google 服务）属于环境限制，不需要验证，已在阶段验收说明里交代
- 修：AI 调用的错误文案按"**用户下一步该做什么**"分了四种，而不是一律抛底层信息 ——
  fetch 本身抛错（Vite 都没起）→「无法连接本地 AI 代理，请确认 npm run dev 已启动」；
  HTTP 502/503（代理在跑但后端没起或崩了）→「AI 代理未就绪，请确认 server 已启动」；
  HTTP 504（代理连上了但上游超时）→「AI 代理响应超时，请重试」；
  其他 4xx/5xx 保持原样（服务端给了 `{error}` 就用它，否则「AI 代理返回 HTTP xxx」）。
  触发背景是 Phase 3 验证时点"解析"（8787 没起）只看到"AI 代理返回 HTTP 502"，
  不知道该启哪个服务。注意 502/504 走的是 `response.status` 判断，
  和 fetch 抛错不是同一条代码路径
- 验证：上述四种文案用一个临时页把 `window.fetch` 替换成伪造响应、调**真实的** `ai.ts` 逐条断言：
  502 / 503 / 504 / 429 / 500 / 400 / fetch 抛错共 7 条全部 PASS（跑完临时页已删除）
- 验证：**真实 502 也实测到了** —— 只起 Vite 不起 8787，点"解析"页面显示
  「AI 代理未就绪，请确认 server 已启动」（改之前是「AI 代理返回 HTTP 502」）；
  反过来 8787 在跑时解析照常出卡片、无错误提示、控制台无报错，说明新分支没碰坏正常路径。
  只有 504 的真实触发（代理连上了但上游挂起）没造出来 —— 要造得改代理配置或起一个故意不响应的服务，
  代价大于收益，由上面那条同层分支的断言覆盖

### 2026-09-29 Phase 4（食物库管理页 + 补剂方案页）
- 说明：本阶段第一步（AI 代理错误文案分类）在 Phase 3 收尾时已完成并提交（`53e6812`），
  日志记在 Phase 3 那节，这里不重复
- 决策：`MacroInputs` 的 props 是数字，但输入框内部用**字符串**存文本。
  原因：`type="number"` 下用户敲到 "2." 的瞬间浏览器会把 `value` 报成空串，
  若直接按 0 回写，小数点就永远打不出来。配套用"渲染期按 props 调整 state"的写法
  （仅当外部值与内部解析值不等时才同步），保证自己输入引起的回流不会打断中间态
- 决策：`FoodLibraryForm` 被 Record 的「存为常用」和食物库管理页的新增/编辑共用，
  一次写好字段、校验、kcal 派生。`category` / `tags` **始终写入**（可为空串 / 空数组）——
  repo 的 patch 是读-合并-写，省略字段等于"不改"，用户清空分类保存后旧值会赖着不走
- 决策：两个表单都加 `noValidate`，校验只留 `handleSubmit` 一处（理由见下方踩坑）
- 决策：食物库列表**显示派生的 kcal**（`recalcKcal`），不显示 `food_library` 表里可能过时的存量值，
  与表单里 MacroInputs 的显示保持一致（方案 2）
- 决策：新增 `src/services/sort.ts`，两个列表统一用 `localeCompare`（中文按拼音，用户直觉）；
  但**食物库只在页面层排序，`repo.listFoodLibrary()` 的 `orderBy('name')` 一行没动** ——
  那个顺序同时决定 `matchFood` 命中哪一条，改它等于偷偷改匹配优先级。
  两处代码都加了 ⚠️ 注释互相指名，并写明"要按拼音展示请去页面层排"
- 决策：补剂列表排序 = **active 优先 + 名称升序**。停用的沉底但不消失（用户能找回），
  也不用 `updatedAt` 倒序（那样刚点过启停的会跳到最前，顺序随操作乱跳）
- 决策：`AppliedItem` 增加 `supplementPlanId`，并在 `toFoodItemInput` / `toAppliedItem` 两处传递，
  这样编辑一条补剂记录时链接不会丢
- 决策：Record 的「快捷添加补剂」只在**加餐**模式出现；数据来自 `listSupplements()` 里
  `active === 1` 的条目；点击后按方案那一份直接生成条目（不换算、不调 AI），
  `dataSource` 复用 `'food_library'` 表示"来自已存储的条目"，不新增枚举值；
  点一下即把 `parsed` 置 true（相当于已经解析出结果）
- 踩坑：**`<form>` 的原生校验会静默拦下提交**。`perAmount` 带 `min={1}`，用户改成 0 时浏览器在
  `onSubmit` 之前就拒绝了提交 —— 表现是"点了保存没反应"，而代码里那条"每份量必须大于 0"永远不显示。
  加 `noValidate` 后校验只剩一处，提示正常出现。这类问题只有真点一次才会暴露
- 踩坑：管理页编辑时**表单渲染了两份**（顶部一份 + 行内一份），因为顶部表单的条件写成了
  `editor !== null` —— 它对"编辑"也成立。改成 `editor.mode === 'new'` 才只留行内那份。
  教训：一个状态驱动两处渲染时，两处条件必须互斥
- 踩坑：验收清单第 4 条的 kcal 算错了（写成 106.3，漏了蛋白质项；实际 `2.6×4+25.9×4+0.3×9 = 116.7`）；
  第 5 条与"按 name 和 aliases 模糊匹配"冲突（搜"鸡"必然同时命中"鸡蛋"）；
  第 10→11 条互斥（先停用、又期望它出现在快捷添加里，而 4.4 明确只列 active 的）。
  三处都按规格里的规则实现，文字部分已由用户确认
- 踩坑（验证方法本身）：读页面文字时用 `split("加餐")[1]` 这类切片，**只截到第一张卡片**，
  导致我两次误判成缺陷（"Today 里历史鸡胸肉没了" —— 其实那些条目属于昨天；
  "点 30g 存成 60g" —— 其实三张卡片都在）。以后读页面要么读全文、要么用可访问性树按元素定位
- 踩坑（验证方法本身）：Playwright 的 `.last()` 会点错元素 ——
  我本想关"存为常用"表单，却点到卡片自己的"取消"，把整张卡片清掉了，表现成"保存按钮找不到"
- 验证：Phase 4 清单 1–18 全部通过（AI 错误文案两种、食物库 CRUD/搜索/分类筛选、
  补剂 CRUD/启停/排序、Record 快捷添加全链路、`FoodLibraryForm` 复用、两条回归）。
  另补两条规格外实证：①删掉**真正被引用过**的食物库条目后，4 条历史 `foodItems`
  营养快照原样保留（`foodLibraryId` 变悬空）；②补剂条目写库后直接读 `foodItems` 确认
  `itemType=supplement` / `supplementPlanId` / `dataSource=food_library` / `weightG` / 派生 kcal 都对
- 说明：清单第 2 条（"完全停掉 npm run dev 再打开浏览器"）字面上跑不了 —— Vite 停了页面就加载不出来。
  正确顺序是**先打开页面再停服务**，此时点解析会在 fetch 层直接 reject，实测显示
  「无法连接本地 AI 代理，请确认 npm run dev 已启动」
- 说明（历史数据语义，用户提问确认过）：改或删食物库条目**都不会**回改已记录的餐次 ——
  `foodItems` 存的是写入当时的营养快照，`foodLibraryId` 只是裸 id（无外键、无级联）。
  唯一会"回头查库"的路径是：编辑一条"缺克数且带 foodLibraryId"的条目、给它补上克数时按库重算

### 2026-09-30 Phase 5（日报/周报 + 营养分析与可视化）
- 决策：新增 `src/services/report.ts`，把**所有聚合、达标判断、PFC 占比**收在这一层，
  页面只负责画。`aggregateDaily(date)` 是唯一的日聚合入口，`aggregateWeekly(start, end)`
  内部就是 `dates.map(aggregateDaily)` —— 虽然名字带 Weekly，参数却是任意起止日期
- 决策：PFC 占比一律用 **kcal 口径**（P×4 / C×4 / F×9），不是克数占比。
  100g 蛋白和 100g 脂肪克数相同、热量差 2.25 倍，按克数算会严重失真
- 决策：热量**达标 = 目标 ±10%**；**分母是"有记录的天数"而不是区间天数** ——
  "7 天里记了 3 天、其中 2 天达标"应该是 66.7%，除以 7 会显示 28.6%，看着像系统坏了。
  一天都没记录时 `daysOnTargetPercent = null`，页面显示「—」而不是 0%
- 决策：周报的 `average` 除以**有记录的天数**，不是 7。把没记录的日子当 0 算进平均没有意义
- 决策：**蛋白质达标只看下限（≥ 目标的 90%）**，规则放在 `report.ts` 里和 `isKcalOnTarget` 作伴。
  热量吃超了要提醒，蛋白质吃超了不是问题，用 ±10% 会把"练得多吃得也多"判成不达标
- 决策：报告**不自动生成**，必须用户点按钮。AI 有成本，而且用户可能只想看历史报告
- 决策：报告过期提示用"快照 vs 实时聚合"比对，**不比时间戳** ——
  删除记录不会产生更新的时间戳，但总量和条目数会变。日报比 `intake` + `supplementIntake` +
  各餐次条目数；周报比 `daysLogged` + 七天 `intake` 合计（两种 aggregate 形状不同，
  所以是两个函数而不是一个联合类型，将来加月报也是同样路径）
- 决策：`generateDailyReport` / `generateWeeklyReport` 的 `force = true` 表示「重新生成」，
  语义是**换一段文案**（用户对上一段不满意才点的），所以两层缓存都要跳过：
  本地已存报告（Dexie）+ 服务端响应缓存（`skipCache`）。见下方 Phase 5 补丁
- 决策：AI payload 精简 —— 只带汇总（intake / target / supplementIntake /
  supplementsTaken / 各餐次 totals + itemCount），**不带逐条食物**。控制 token，
  也避免模型编造"你吃了什么"。`reportPrompt` 里加了"输入没有逐条明细，不要编造"和
  "`hasRecords=false` 时 suggestions 必须返回空数组"
- 决策：`/analysis` 复用 `aggregateWeekly` 而不是在页面里再循环一遍 `aggregateDaily` ——
  后者要把 average / daysLogged / daysOnTarget 重算一遍，将来改口径两边必然不一致。
  函数名与用途错位，但 AGENTS.md 禁止重命名已有函数，所以保留原名
- 决策：`PFC_COLORS` 抽到 `src/components/pfcColors.ts`。饼图和堆叠柱状图必须是同一套色，
  两个页面各写一份的话，同一种营养素在两页颜色不一样，读图的人会以为自己看错了
- 决策：把 Today 里的目标进度条抽成 `src/components/TargetBar.tsx`（Today 和报告页共用），
  并加 `compact` 变体给报告页的三列窄布局 —— 窄列里 CJK 会把「目标」拆成两行，
  而且同一列里数值会出现两次（标题行一次、进度条一次）
- 踩坑：**`ReferenceLine` 的默认 `ifOverflow` 是 `discard`**，目标 2200、实际摄入 600 时
  Y 轴只按数据自适应到 1200，目标线被直接扔到画布外**根本看不见** —— 而且不报错、不留空位，
  只是"少了一根线"。必须显式写 `ifOverflow="extendDomain"` 才会把 Y 轴撑到目标值。
  全项目 3 处 `ReferenceLine`（分析页折线、分析页堆叠柱、周报折线）都已加；
  没有 `ReferenceArea` / `ReferenceDot`，也没有显式 `domain=` 覆盖
- 踩坑：**recharts v3 的 `<Legend>` 类型里没有 `payload`**（被 `Omit` 掉了），
  想固定图例顺序不能传 payload；自动排序出来还是倒的（碳水/脂肪/蛋白质）。
  最后和饼图一样手写图例，用 flex 排
- 踩坑：饼图在总热量为 0 时不能画 —— 三个扇区都是 0，recharts 会算出 NaN 角度。
  兜底显示"没有营养数据，画不出占比"
- 踩坑：折线图的"没记录的一天"要给 `null` 而不是 0，配 `connectNulls={false}` 让线断开；
  填 0 会画成一条掉到底的实线，看不出中间断过记录。但**堆叠柱状图相反**，
  没记录给 0 即可 —— 柱子没有"把两天连起来"的歧义，0 高度还能保住 X 轴上的档位
- 踩坑（验证方法本身，第二次遇到）：Playwright 的 `fill()` / `pressSequentially()`
  对 `<input type="date">` **不触发 React 的 onChange**，DOM 值看着变了但 state 没变
  （表现为"改了日期区间和图表都没动"）。上一阶段在 `<input type="time">` 上遇到过同一个问题。
  可用的替代是内置浏览器无障碍层的 `setValue(elementIndex, value)`，走的是真实输入路径
- 踩坑：用 `console.log` 探针 + `tab.dev.logs()` 数函数调用次数，验证"`aggregateWeekly`
  是不是每次 render 都跑" —— 结果是只有"进周报 tab / 换周"才跑一次
  （`loadWeekly` 是 `useCallback([], ...)`、`weekEnd` 是 `useMemo`，effect 依赖稳定）。
  探针验完已删。**这类"某函数是不是被调太多次"的问题，日志探针比读代码靠谱**
- 踩坑：内置浏览器的标签页会**整个崩掉**（`This page crashed`），症状是页面永远停在
  「正在汇总…」、CDP 命令超时。看起来像是应用的死循环或 IndexedDB 卡住，其实换个标签页就好。
  遇到"页面莫名不动"先换标签页重开，再怀疑代码

#### 2026-09-30 Phase 5 补丁（`force` 穿透服务端缓存）
- 背景：点「重新生成」时 `generatedAt` 变了、报告确实重写了，但 `used` 没涨、
  AI 文案一字未改。查下来是服务端响应缓存 key = `'report:' + type + ':' + hash(payload)`，
  数据没变 → payload 逐字相同 → 命中缓存 → 不调 AI 也不计额度（Phase 1 的原设计）
- 决策：`force` 的语义定为**"换一段文案"**（用户点它是因为对上一段不满意），
  不是"再走一遍流程"。所以前端 `generateReport` 加 `options.skipCache`，
  `/api/ai/report` 读 `skipCache` 时**跳过读、照旧写、照旧计额度**
- 决策：跳过读但**仍然写缓存**（新结果覆盖旧的），这样之后被动请求
  （组件重挂载、切 Tab 切回来）拿到的是新那份，不会又变回最初的分析
- 决策：`skipCache` **不能绕过限流** —— 额度满时它返回 429，
  而普通请求命中缓存依然返回 200（Phase 1 那条"缓存命中不消耗额度"没有被破坏）
- 决策：响应头多一个 `X-Cache: BYPASS`，区分"因为没缓存才调 AI"和"因为调用方要求穿透"
- 踩坑：`tsx server/index.ts` **不监听文件变化**，改 `server/` 下的代码必须重启 `dev:server`
  才生效，否则 curl 打到的还是旧逻辑（表现为"改了没反应"）
- 验证：同一 payload 连打 5 次 —— 不带 skipCache 得 `MISS(used 1)` → `HIT(used 1)`；
  带 skipCache 得 `BYPASS(used 2)` → `BYPASS(used 3)`，且文案确实变了；
  最后不带 skipCache 读回是 `HIT(used 3)` 且内容是**穿透后那份新的**。
  边界（临时把 `AI_DAILY_LIMIT` 设成 2）：used 满时带 skipCache 返回
  `429 {"error":"Daily AI call limit reached"}`，不带 skipCache 读缓存仍 200 HIT

#### 2026-09-30 Phase 5 验收
- 规格里 14 条验证清单**全部在内置 Chromium 里跑过**（报告生成/重生成/缓存命中、
  过期提示条 + 内联重生成、AI 代理挂掉时的错误态与重试、周报生成、分析页 7/30/自定义区间、
  无记录日生成日报、AI 调用对账、Phase 2.6 等比缩放回归、Record→Today 回归、跨页一致性）
- 关键对账：`/api/ai/status` 在"重新生成（数据未变）"、"反复进出分析页"、
  "刷新看缓存报告"这几种操作下**计数不动**；只有真正调 AI 才 +1
- 关键数字：改重量 200g→300g，鸡胸肉 P46→69 / F3.6→5.4 / kcal216.4→324.6（都精确 ×1.5），
  餐次合计 404.9→513.1；还原后 Today 回到 404.9。日报总热量与 Today 当天总热量逐项一致
- 说明：验证全部跑在**内置浏览器的独立 profile** 上（IndexedDB 与用户自己的 Chrome 不共享），
  上面的数字来自造的测试数据。DevTools 的 Application 面板在只读沙盒里拿不到，
  库层面的确认仍需要人工在 DevTools 里做
