import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import type { FoodLibraryInput } from '../db/repo';
import type { FoodLibraryItem } from '../db/schema';
import { recalcKcal } from '../services/nutrition';
import MacroInputs from './MacroInputs';
import type { MacroValue } from './MacroInputs';

interface FoodLibraryFormProps {
  initialValue?: Partial<FoodLibraryItem>;
  onSubmit: (value: FoodLibraryInput) => Promise<void>;
  onCancel: () => void;
  /** 默认 "保存" */
  submitLabel?: string;
  /** 表单顶部标题，可选 */
  title?: string;
}

const INPUT_CLASS =
  'w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100';

/** 逗号分隔的文本 ↔ string[]。中英文逗号都接受，用户不必记格式 */
function parseList(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function toNumberInput(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * 食物库条目的表单，Record 页的「存为常用」和食物库管理页的新增/编辑共用同一个组件，
 * 避免两处字段、校验、kcal 派生逻辑各写一遍。
 */
export default function FoodLibraryForm({
  initialValue,
  onSubmit,
  onCancel,
  submitLabel = '保存',
  title,
}: FoodLibraryFormProps) {
  // 用 useId 而不是写死 id：同一个页面上可能同时存在多个表单实例（比如管理页 + 行内编辑），
  // 写死的话 label 会和错误的输入框关联
  const idPrefix = useId();
  const [name, setName] = useState(initialValue?.name ?? '');
  const [aliases, setAliases] = useState((initialValue?.aliases ?? []).join(', '));
  const [category, setCategory] = useState(initialValue?.category ?? '');
  const [tags, setTags] = useState((initialValue?.tags ?? []).join(', '));
  const [perAmount, setPerAmount] = useState(String(initialValue?.perAmount ?? 100));
  const [macros, setMacros] = useState<MacroValue>({
    proteinG: initialValue?.proteinG ?? 0,
    carbG: initialValue?.carbG ?? 0,
    fatG: initialValue?.fatG ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (name.trim() === '') {
      return '请填写名称';
    }
    if (toNumberInput(perAmount) <= 0) {
      return '每份量必须大于 0';
    }
    if (macros.proteinG === 0 && macros.carbG === 0 && macros.fatG === 0) {
      return '营养数据不能全为 0';
    }
    return null;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const problem = validate();
    if (problem !== null) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const value: FoodLibraryInput = {
        name: name.trim(),
        aliases: parseList(aliases),
        // 分类和标签始终写入（可能是空字符串 / 空数组）：
        // repo 的 patch 是"读-合并-写"，省略字段等于"不改"，用户清空分类保存后旧值会赖着不走
        category: category.trim(),
        tags: parseList(tags),
        perAmount: toNumberInput(perAmount),
        perUnit: 'g',
        proteinG: macros.proteinG,
        carbG: macros.carbG,
        fatG: macros.fatG,
        kcal: recalcKcal(macros.proteinG, macros.carbG, macros.fatG),
      };
      await onSubmit(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      // noValidate：浏览器原生校验会先拦下提交（比如 perAmount 的 min=1），
      // 结果是"点了保存没反应"、而我们的提示永远不出现。校验只留 handleSubmit 这一处。
      noValidate
      onSubmit={(event) => {
        // React 的 onSubmit 不接收 async 函数，包一层避免 floating promise
        void handleSubmit(event);
      }}
      className="flex flex-col gap-3 rounded-md bg-slate-50 p-3"
    >
      {title !== undefined && <p className="text-sm font-medium text-slate-700">{title}</p>}

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-name`}>
          名称
          <input
            id={`${idPrefix}-name`}
            className={`${INPUT_CLASS} w-40`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-aliases`}>
          别名（逗号分隔）
          <input
            id={`${idPrefix}-aliases`}
            className={`${INPUT_CLASS} w-48`}
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            placeholder="鸡肉, chicken breast"
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-category`}>
          分类
          <input
            id={`${idPrefix}-category`}
            className={`${INPUT_CLASS} w-28`}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-tags`}>
          标签（逗号分隔）
          <input
            id={`${idPrefix}-tags`}
            className={`${INPUT_CLASS} w-40`}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-per-amount`}>
          每份量 (g)
          <input
            id={`${idPrefix}-per-amount`}
            type="number"
            min={1}
            step="any"
            className={`${INPUT_CLASS} w-24`}
            value={perAmount}
            onChange={(event) => setPerAmount(event.target.value)}
            disabled={saving}
          />
        </label>
      </div>

      <MacroInputs value={macros} onChange={setMacros} disabled={saving} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? '保存中…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 disabled:opacity-50"
        >
          取消
        </button>
        {error !== null && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </form>
  );
}
