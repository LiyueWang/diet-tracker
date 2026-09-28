import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import SaveAsFoodForm from '../components/SaveAsFoodForm';
import {
  addFoodItems,
  createMeal,
  getItemsByMealId,
  getMealById,
  listFoodLibrary,
  replaceMealItems,
  updateMeal,
} from '../db/repo';
import type { FoodItemInput } from '../db/repo';
import type { FoodItem, FoodLibraryItem } from '../db/schema';
import { parseText } from '../services/ai';
import { nowHhMm, todayIso } from '../services/date';
import { clearDraft, loadDraft, makeEditDraftKey, makeNewDraftKey, saveDraft } from '../services/draft';
import { applyFoodLibrary, recalcKcal, round1, scaleNutrition, validateItems } from '../services/nutrition';
import type { AppliedItem } from '../services/nutrition';
import { getErrorMessage, isSpeechSupported, startRecognition } from '../services/speech';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * 确认卡片里的每一行。
 * 带本地 key 而不是用数组下标：删除中间一行时下标会整体前移，
 * 既会让 React 复用错输入框（焦点乱跳），也会让"已存入"状态串到别的行。
 */
interface EditableRow {
  key: string;
  item: AppliedItem;
}

const MEAL_TYPES: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
];

const CELL_INPUT = 'rounded border border-slate-300 px-1 py-0.5 text-sm outline-none focus:border-blue-500';

/** 麦克风图标。内联 SVG：项目不引图标库，更不该为两个图标引一个 */
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}

/** 录音中用它替换麦克风，配合 animate-pulse 表达"正在录音"（可见文案是"停止"） */
function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** 来源标签：手改过营养值的行标成"手动"，和库/AI 区分开 */
const SOURCE_BADGE: Record<AppliedItem['dataSource'], { text: string; className: string }> = {
  food_library: { text: '库', className: 'bg-green-100 text-green-700' },
  ai_estimate: { text: 'AI', className: 'bg-amber-100 text-amber-700' },
  manual: { text: '手动', className: 'bg-slate-200 text-slate-700' },
};

/** 按当前时间猜默认餐次：<10 早餐，<15 午餐，<21 晚餐，其余加餐 */
function guessMealType(now: Date): MealType {
  const hour = now.getHours();
  if (hour < 10) {
    return 'breakfast';
  }
  if (hour < 15) {
    return 'lunch';
  }
  if (hour < 21) {
    return 'dinner';
  }
  return 'snack';
}

/** 返回 undefined 表示"输入非法，忽略这次改动"，避免把 NaN 写进 state */
function parseWeightInput(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNutritionInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function toFoodItemInput(item: AppliedItem): FoodItemInput {
  const input: FoodItemInput = {
    name: item.name.trim(),
    weightG: item.weightG,
    proteinG: item.proteinG,
    carbG: item.carbG,
    fatG: item.fatG,
    kcal: item.kcal,
    dataSource: item.dataSource,
    itemType: item.itemType,
  };
  // 只在有意义时写这两个可选字段，省得 IndexedDB 里躺一堆 undefined
  if (item.foodLibraryId) {
    input.foodLibraryId = item.foodLibraryId;
  }
  if (item.dataSource === 'ai_estimate') {
    input.aiConfidence = item.confidence;
  }
  return input;
}

/**
 * 已保存的 FoodItem → 确认卡片用的 AppliedItem。
 * estimated 只能拿存下来的数值充当：库里没有保留当初 AI 的原始估算，
 * 这个字段只在"库行失去匹配后退回估算"时才被读到。
 * dataSource 三态（food_library / ai_estimate / manual）原样带回，
 * 用户手改过的行不能被重新编辑时又降级成 AI 估算。
 */
function toAppliedItem(item: FoodItem): AppliedItem {
  return {
    name: item.name,
    weightG: item.weightG,
    quantityDesc: '',
    itemType: item.itemType,
    estimated: {
      proteinG: item.proteinG,
      carbG: item.carbG,
      fatG: item.fatG,
      kcal: item.kcal,
    },
    confidence: item.aiConfidence ?? 0,
    proteinG: item.proteinG,
    carbG: item.carbG,
    fatG: item.fatG,
    kcal: item.kcal,
    dataSource: item.dataSource,
    ...(item.foodLibraryId ? { foodLibraryId: item.foodLibraryId } : {}),
    needsWeight: item.weightG === null,
  };
}

/** 「存为常用」表单要的是每 100g 的值，而卡片上的数值是当前克数的合计，这里换算回去 */
function toPer100g(item: AppliedItem): { proteinG: number; carbG: number; fatG: number } {
  if (item.weightG !== null && item.weightG > 0) {
    const factor = 100 / item.weightG;
    return {
      proteinG: round1(item.proteinG * factor),
      carbG: round1(item.carbG * factor),
      fatG: round1(item.fatG * factor),
    };
  }
  // 没有克数就没法换算，原样带入让用户自己核对
  return { proteinG: item.proteinG, carbG: item.carbG, fatG: item.fatG };
}

export default function Record() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = editId !== null;

  const [mealType, setMealType] = useState<MealType>(() => guessMealType(new Date()));
  const [time, setTime] = useState<string>(() => nowHhMm());
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [library, setLibrary] = useState<FoodLibraryItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFormKey, setOpenFormKey] = useState<string | null>(null);
  const [savedRowKeys, setSavedRowKeys] = useState<Record<string, boolean>>({});
  const [parsed, setParsed] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  // 能力检测是同步的、且一次会话内不会变，所以只在首次渲染算一次
  const [speechSupported] = useState(() => isSpeechSupported());
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  // 语音回调是在事件里触发的，闭包里的 parsed 会是旧值，所以用 ref 同步一份
  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;

  const draftKey = isEditMode && editId !== null ? makeEditDraftKey(editId) : makeNewDraftKey();
  const previousEditIdRef = useRef<string | null>(editId);
  /**
   * 模式切换那一轮要跳过草稿写入：清空表单是"模式切换"造成的，
   * 不是用户改内容，写下去会覆盖用户切到编辑页之前留下的草稿。
   */
  const skipNextDraftWriteRef = useRef(false);
  /**
   * 本组件实例是否"拥有"当前这份新建草稿（写过或恢复过）。
   * 只有拥有者才有资格在表单被清空时删草稿 —— 否则从编辑模式切回来时会误删
   * 用户之前存下的 draft:record:new。
   */
  const ownsDraftRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listFoodLibrary()
      .then((foods) => {
        if (!cancelled) {
          setLibrary(foods);
        }
      })
      .catch((cause: unknown) => {
        // 组件卸载后 setState 会被 React 忽略，但错误信息仍要落到界面上
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 编辑模式：把已保存的餐次和条目读回确认卡片
  useEffect(() => {
    if (editId === null) {
      return;
    }
    // 收窄后的副本：嵌套的 async 函数里 TS 不会沿用外层的 null 检查
    const mealId = editId;
    let cancelled = false;

    async function loadMeal(): Promise<void> {
      setLoadingEdit(true);
      setNotFound(false);
      try {
        const meal = await getMealById(mealId);
        if (cancelled) {
          return;
        }
        // 逻辑删除过的记录等于不存在，不能让用户编辑出一个"复活"的幽灵记录
        if (!meal || meal.deleted === 1) {
          setNotFound(true);
          return;
        }

        const items = await getItemsByMealId(mealId);
        if (cancelled) {
          return;
        }
        setMealType(meal.mealType);
        setTime(meal.time);
        setRows(items.map((item) => ({ key: crypto.randomUUID(), item: toAppliedItem(item) })));
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) {
          setLoadingEdit(false);
        }
      }
    }

    void loadMeal();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  /** 恢复/丢弃草稿和"取消"都要回到初始状态，集中在一处免得漏字段 */
  function resetForm(): void {
    setText('');
    setRows([]);
    setMealType(guessMealType(new Date()));
    setTime(nowHhMm());
    setParsed(false);
    setError(null);
    setOpenFormKey(null);
    setSavedRowKeys({});
  }

  /**
   * 从编辑模式切到新建模式时清空表单。
   * 这两种模式共用同一个组件实例（只是 search params 不同），不清的话
   * 上一条记录的数据会留在"新建"表单里，一点保存就多出一条重复记录。
   * 初次挂载不触发：previous 初值就是当前 editId。
   */
  useEffect(() => {
    const previousEditId = previousEditIdRef.current;
    previousEditIdRef.current = editId;
    if (previousEditId !== null && editId === null) {
      // 这次清空是模式切换造成的：既不写草稿，也不删草稿，把用户原来的草稿原样留着
      skipNextDraftWriteRef.current = true;
      ownsDraftRef.current = false;
      resetForm();
      setDraftRestored(false);

      // 静默恢复，不弹提示条：从编辑页切回来的用户刚从上下文里出来，
      // 表单里原样出现自己刚才写的东西是自然预期；提示条是给"从外部进入、
      // 不知道有草稿"的用户看的。编辑模式挂载时已清掉编辑草稿，
      // 所以这里读到的只可能是新建模式那一份。
      const draft = loadDraft(makeNewDraftKey());
      if (draft) {
        setText(draft.rawText);
        setRows(draft.items.map((item) => ({ key: crypto.randomUUID(), item })));
        setMealType(draft.mealType);
        setTime(draft.time);
        setParsed(draft.parsed);
        // 恢复之后这份草稿归本次表单所有，用户再清空表单时应该连草稿一起清掉
        ownsDraftRef.current = true;
      }
    }
  }, [editId]);

  /**
   * 挂载时恢复草稿。
   * 编辑模式故意不读草稿：那种情况下数据库才是唯一事实来源，
   * 但要把可能残留的编辑草稿清掉，免得以后版本误读到旧内容。
   */
  useEffect(() => {
    if (editId !== null) {
      clearDraft(makeEditDraftKey(editId));
      return;
    }
    const draft = loadDraft(makeNewDraftKey());
    if (!draft) {
      return;
    }
    setText(draft.rawText);
    setRows(draft.items.map((item) => ({ key: crypto.randomUUID(), item })));
    setMealType(draft.mealType);
    setTime(draft.time);
    setParsed(draft.parsed);
    // 恢复之后这份草稿就归本次表单所有：用户清空表单时应该连草稿一起清掉
    ownsDraftRef.current = true;
    setDraftRestored(true);
    // 只在挂载时跑一次：这是"进入页面时恢复一次"的语义，后续变化由写入 effect 负责
  }, []);

  /**
   * 草稿落盘（防抖 500ms）。
   * 用 effect 的 cleanup 当防抖：每次内容变化都取消上一个定时器，
   * 组件卸载时也会清掉未触发的定时器，不会写入过期数据。
   * 本阶段只做新建模式草稿（编辑模式草稿优先级低，见 AGENTS.md 开发日志）。
   */
  useEffect(() => {
    if (isEditMode) {
      return;
    }
    if (skipNextDraftWriteRef.current) {
      // 模式切换那一轮直接跳过：保住用户切到编辑页之前的草稿
      skipNextDraftWriteRef.current = false;
      return;
    }
    const hasContent = text.trim() !== '' || rows.length > 0;
    if (!hasContent) {
      // 空表单不写草稿，否则光是打开页面再回来就会弹"已恢复上次未保存的内容"
      // 但只有"自己写过/恢复过"的草稿才清，避免把别人的草稿删掉
      if (ownsDraftRef.current) {
        clearDraft(makeNewDraftKey());
        ownsDraftRef.current = false;
      }
      return;
    }
    const timer = window.setTimeout(() => {
      saveDraft(makeNewDraftKey(), {
        rawText: text,
        items: rows.map((row) => row.item),
        mealType,
        time,
        parsed,
        savedAt: new Date().toISOString(),
      });
      ownsDraftRef.current = true;
    }, 500);
    return () => window.clearTimeout(timer);
  }, [isEditMode, text, rows, mealType, time, parsed]);

  const items = useMemo(() => rows.map((row) => row.item), [rows]);

  /**
   * 语音输入（只在新建模式渲染按钮，这里的状态机对所有情况都要收得住）。
   * 退出的唯一出口是 onEnd —— 成功、失败、用户主动停止、卸载清理都会汇到它。
   */
  useEffect(
    () => () => {
      // 录着音切走页面时释放麦克风，避免后台继续占用
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (speechNotice === null) {
      return;
    }
    const timer = window.setTimeout(() => setSpeechNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [speechNotice]);

  /** onEnd 与主动 stop 都会走到这里，重复调用无害 */
  function finishListening(): void {
    recognitionRef.current = null;
    setListening(false);
  }

  function handleMicClick(): void {
    if (listening) {
      // 再点一次＝中止；随后的 onend 会走 finishListening
      recognitionRef.current?.stop();
      return;
    }

    setSpeechNotice(null);
    setListening(true);
    recognitionRef.current = startRecognition({
      onResult: (text) => {
        // 追加而不是覆盖：用户可能先手打了一段再补一段语音
        setText((prev) => (prev.trim() === '' ? text : `${prev.trimEnd()} ${text}`));
        if (parsedRef.current) {
          // 已有卡片时不自动重新解析，保持"用户确认后才入库"的原则
          setSpeechNotice('文本已更新，可重新解析');
        }
      },
      onError: (error) => {
        setSpeechNotice(getErrorMessage(error));
      },
      onEnd: () => {
        finishListening();
      },
    });
  }

  const errors = useMemo(() => {
    // validateItems 只认克数和营养值，空名字要靠页面自己挡：否则会存进一条没有名字的记录
    const unnamed = items.some((item) => item.name.trim() === '') ? ['有未命名的条目，请填写名称'] : [];
    return [...unnamed, ...validateItems(items)];
  }, [items]);

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => ({
          proteinG: round1(acc.proteinG + item.proteinG),
          carbG: round1(acc.carbG + item.carbG),
          fatG: round1(acc.fatG + item.fatG),
          kcal: round1(acc.kcal + item.kcal),
        }),
        { proteinG: 0, carbG: 0, fatG: 0, kcal: 0 },
      ),
    [items],
  );

  function toRow(item: AppliedItem): EditableRow {
    return { key: crypto.randomUUID(), item };
  }

  function patchRow(key: string, patch: Partial<AppliedItem>): void {
    setRows((prev) => prev.map((row) => (row.key === key ? { key, item: { ...row.item, ...patch } } : row)));
  }

  /**
   * 克数变化分三条路径：
   * A1 原本就有克数、改成新克数 —— 以当前 P/F/C 等比缩放，dataSource 不变
   * A2 原本没有克数、补上克数 —— 命中食物库的按库里每 100g 重算；未命中的只更新克数
   * A3 清空克数 —— 不缩放，克数置空后由校验拦截（保存按钮禁用）
   * 三条路径的 kcal 都由 recalcKcal 从 P/F/C 派生，不单独缩放热量。
   */
  function handleWeightChange(row: EditableRow, raw: string): void {
    const next = parseWeightInput(raw);
    if (next === undefined) {
      return;
    }

    if (row.item.weightG === null && next !== null && row.item.foodLibraryId) {
      const [recomputed] = applyFoodLibrary([{ ...row.item, weightG: next }], library);
      if (recomputed) {
        patchRow(row.key, recomputed);
        return;
      }
    }

    const scaled = scaleNutrition(row.item, row.item.weightG, next);
    patchRow(row.key, { weightG: next, ...scaled });
  }

  /**
   * 改 P/F/C（规则 B）：只动被改的那个字段，热量由三者重算，
   * 来源标成 manual —— 数值已经不再是食物库或 AI 给的原始值了。
   */
  function handleNutritionChange(row: EditableRow, field: 'proteinG' | 'carbG' | 'fatG', raw: string): void {
    const parsed = parseNutritionInput(raw);
    if (parsed === undefined) {
      return;
    }
    const next = { ...row.item, [field]: parsed };
    patchRow(row.key, {
      [field]: parsed,
      kcal: recalcKcal(next.proteinG, next.carbG, next.fatG),
      dataSource: 'manual',
    });
  }

  async function handleParse(): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') {
      setError('请输入饮食描述');
      return;
    }

    setParsing(true);
    setError(null);
    setOpenFormKey(null);
    setSavedRowKeys({});
    try {
      const result = await parseText(trimmed);
      if (result.items.length === 0) {
        setRows([]);
        setParsed(false);
        setError('没有识别到任何食物，换个说法再试');
        return;
      }
      setRows(applyFoodLibrary(result.items, library).map(toRow));
      setParsed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setParsing(false);
    }
  }

  function handleAddRow(): void {
    setRows((prev) => [
      ...prev,
      toRow({
        name: '',
        weightG: null,
        quantityDesc: '',
        itemType: 'food',
        estimated: { proteinG: 0, carbG: 0, fatG: 0, kcal: 0 },
        confidence: 0,
        proteinG: 0,
        carbG: 0,
        fatG: 0,
        kcal: 0,
        dataSource: 'ai_estimate',
        needsWeight: true,
      }),
    ]);
  }

  function handleRemoveRow(key: string): void {
    setRows((prev) => prev.filter((row) => row.key !== key));
    setOpenFormKey((current) => (current === key ? null : current));
  }

  function handleCancel(): void {
    clearDraft(draftKey);
    ownsDraftRef.current = false;
    // 编辑模式直接离开，不要留下"看起来取消了其实没保存"的中间状态
    if (isEditMode) {
      navigate('/');
      return;
    }
    resetForm();
  }

  /** 提示条上的「丢弃草稿」：清掉暂存并把表单恢复到初始状态 */
  function handleDiscardDraft(): void {
    clearDraft(draftKey);
    ownsDraftRef.current = false;
    resetForm();
    setDraftRestored(false);
  }

  function handleFoodSaved(row: EditableRow, food: FoodLibraryItem): void {
    patchRow(row.key, { foodLibraryId: food.id });
    // 新食物立刻并入内存里的食物库，这样同一句里再出现它就能直接命中，不必刷新页面
    setLibrary((prev) => [...prev, food]);
    setSavedRowKeys((prev) => ({ ...prev, [row.key]: true }));
    setOpenFormKey(null);
  }

  async function handleSave(): Promise<void> {
    if (errors.length > 0) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isEditMode && editId !== null) {
        // date 不传：本阶段不支持跨天移动记录
        await updateMeal(editId, { mealType, time });
        await replaceMealItems(editId, items.map(toFoodItemInput));
        clearDraft(draftKey);
        ownsDraftRef.current = false;
        navigate('/', { state: { savedAt: Date.now(), kind: 'updated' } });
        return;
      }

      const meal = await createMeal({
        date: todayIso(),
        mealType,
        time,
        source: 'text',
        rawText: text.trim(),
      });
      await addFoodItems(meal.id, items.map(toFoodItemInput));

      setRows([]);
      setText('');
      setSavedRowKeys({});
      setParsed(false);
      clearDraft(draftKey);
      ownsDraftRef.current = false;
      // 跳回今日汇总；带上 state 让 Today 能提示"已保存"
      navigate('/', { state: { savedAt: Date.now(), kind: 'created' } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  if (notFound) {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">编辑记录</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">记录不存在（可能已被删除）。</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-3 rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white"
          >
            返回今日汇总
          </button>
        </div>
      </section>
    );
  }

  const mealControls = (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">餐次</p>
        <div className="flex flex-wrap gap-2">
          {MEAL_TYPES.map((meal) => (
            <button
              key={meal.value}
              type="button"
              onClick={() => setMealType(meal.value)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                mealType === meal.value
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {meal.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        时间
        <input
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal outline-none focus:border-blue-500"
          aria-label="时间"
        />
      </label>
    </div>
  );

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{isEditMode ? '编辑记录' : '记录饮食'}</h1>

      {draftRestored && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <span>已恢复上次未保存的内容</span>
          <button
            type="button"
            onClick={() => setDraftRestored(false)}
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800"
          >
            继续编辑
          </button>
          <button
            type="button"
            onClick={handleDiscardDraft}
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800"
          >
            丢弃草稿
          </button>
        </div>
      )}

      {isEditMode ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          {mealControls}
          {loadingEdit && <p className="mt-3 text-sm text-slate-500">正在读取记录…</p>}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">{mealControls}</div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="record-text">
              吃了什么
            </label>
            <textarea
              id="record-text"
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="例如：中午吃了200克鸡胸肉和150克米饭"
              className="w-full rounded-md border border-slate-300 bg-white p-3 text-sm outline-none focus:border-blue-500"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleParse();
                }}
                disabled={parsing}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {parsing ? '正在解析…' : '解析'}
              </button>
              {speechSupported ? (
                <button
                  type="button"
                  onClick={handleMicClick}
                  // 可访问名描述"点下去会发生什么"（开始/停止），而不是复述可见文案：
                  // 读屏用户听到"停止语音输入，已选中"比听到"未选中"更能推出当前状态
                  aria-label={listening ? '停止语音输入' : '开始语音输入'}
                  aria-pressed={listening}
                  className={`flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium ${
                    listening
                      ? 'animate-pulse border-red-300 bg-red-50 text-red-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {listening ? <StopIcon /> : <MicIcon />}
                  {/* 可见文案用"停止"，被可访问名"停止语音输入"包含：语音控制用户
                      照着屏幕上写的字念得出来（WCAG 2.5.3 Label in Name）。
                      "正在录音"这层信息由脉冲动画 + 红色 + 方形停止图标承担 */}
                  {listening ? '停止' : '语音输入'}
                </button>
              ) : (
                // Chrome 里 disabled 的按钮不接收鼠标事件、也就不会显示 title，
                // 所以把 title 挂到外层 span 上，"禁用"和"悬停提示"两个要求才能同时成立
                <span title="当前浏览器不支持语音输入，请使用 Chrome 或 Edge">
                  {/* 禁用的按钮不带 aria-pressed：同时说"不可用"和"未选中/已选中"只会让读屏混乱 */}
                  <button
                    type="button"
                    disabled
                    className="flex cursor-not-allowed items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-400 opacity-60"
                  >
                    <MicIcon />
                    语音输入
                  </button>
                </span>
              )}
              {parsing && <span className="text-sm text-slate-500">正在解析…</span>}
            </div>

            {speechNotice !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <span>{speechNotice}</span>
                <button
                  type="button"
                  onClick={() => setSpeechNotice(null)}
                  aria-label="关闭提示"
                  className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800"
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">食物名</th>
                <th className="pb-2 font-medium">克数</th>
                <th className="pb-2 font-medium">蛋白质</th>
                <th className="pb-2 font-medium">碳水</th>
                <th className="pb-2 font-medium">脂肪</th>
                <th className="pb-2 font-medium">热量</th>
                <th className="pb-2 font-medium">来源</th>
                <th className="pb-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { item } = row;
                const weightMissing = item.weightG === null || item.weightG <= 0;
                return (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="py-2 pr-2">
                      <input
                        className={`${CELL_INPUT} w-28`}
                        value={item.name}
                        onChange={(event) => patchRow(row.key, { name: event.target.value })}
                        aria-label="食物名"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        min={1}
                        step="any"
                        className={`${CELL_INPUT} w-16 ${weightMissing ? 'border-red-500 bg-red-50' : ''}`}
                        value={item.weightG ?? ''}
                        onChange={(event) => handleWeightChange(row, event.target.value)}
                        aria-label="克数"
                      />
                      {weightMissing && <p className="mt-1 text-xs text-red-600">请补充克数</p>}
                    </td>
                    {(
                      [
                        ['蛋白质', item.proteinG, 'proteinG'],
                        ['碳水', item.carbG, 'carbG'],
                        ['脂肪', item.fatG, 'fatG'],
                      ] as const
                    ).map(([label, value, field]) => (
                      <td key={field} className="py-2 pr-2">
                        <input
                          className={`${CELL_INPUT} w-16`}
                          value={value}
                          onChange={(event) => handleNutritionChange(row, field, event.target.value)}
                          aria-label={label}
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-2">
                      {/* 热量是 P/F/C 的派生值，只读展示：给它输入框只会和营养值互相打架 */}
                      <span className="text-sm text-slate-700">{item.kcal}</span>
                      <span className="ml-1 text-xs text-slate-400">kcal</span>
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_BADGE[item.dataSource].className}`}
                      >
                        {SOURCE_BADGE[item.dataSource].text}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setOpenFormKey((current) => (current === row.key ? null : row.key))}
                          disabled={savedRowKeys[row.key] === true}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 disabled:opacity-60"
                        >
                          {savedRowKeys[row.key] === true ? '已存入' : '存为常用'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.key)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-600"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {openFormKey !== null &&
                (() => {
                  const row = rows.find((candidate) => candidate.key === openFormKey);
                  if (!row) {
                    return null;
                  }
                  return (
                    <tr>
                      <td colSpan={8} className="pt-1">
                        <SaveAsFoodForm
                          defaultName={row.item.name}
                          defaultPer100g={toPer100g(row.item)}
                          onSaved={(food) => handleFoodSaved(row, food)}
                          onCancel={() => setOpenFormKey(null)}
                        />
                      </td>
                    </tr>
                  );
                })()}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-700">
              合计：热量 <span className="font-semibold">{totals.kcal} kcal</span>
              <span className="ml-3">蛋白质 {totals.proteinG}g</span>
              <span className="ml-2">碳水 {totals.carbG}g</span>
              <span className="ml-2">脂肪 {totals.fatG}g</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddRow}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                添加一条
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSave();
                }}
                disabled={errors.length > 0 || saving}
                className="rounded-md bg-blue-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-600">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
