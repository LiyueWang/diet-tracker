import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import type { SupplementPlanInput } from '../db/repo';
import type { SupplementPlan } from '../db/schema';
import { recalcKcal } from '../services/nutrition';
import MacroInputs from './MacroInputs';
import type { MacroValue } from './MacroInputs';

interface SupplementFormProps {
  initialValue?: Partial<SupplementPlan>;
  onSubmit: (value: SupplementPlanInput) => Promise<void>;
  onCancel: () => void;
  /** 默认 "保存" */
  submitLabel?: string;
  /** 表单顶部标题，可选 */
  title?: string;
}

const INPUT_CLASS =
  'w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100';

function toNumberInput(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function SupplementForm({
  initialValue,
  onSubmit,
  onCancel,
  submitLabel = '保存',
  title,
}: SupplementFormProps) {
  const idPrefix = useId();
  const [name, setName] = useState(initialValue?.name ?? '');
  const [timing, setTiming] = useState(initialValue?.timing ?? '');
  const [defaultAmountG, setDefaultAmountG] = useState(String(initialValue?.defaultAmountG ?? 30));
  const [macros, setMacros] = useState<MacroValue>({
    proteinG: initialValue?.proteinG ?? 0,
    carbG: initialValue?.carbG ?? 0,
    fatG: initialValue?.fatG ?? 0,
  });
  const [note, setNote] = useState(initialValue?.note ?? '');
  const [active, setActive] = useState((initialValue?.active ?? 1) === 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (name.trim() === '') {
      return '请填写名称';
    }
    if (toNumberInput(defaultAmountG) <= 0) {
      return '默认份量必须大于 0';
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
      const value: SupplementPlanInput = {
        name: name.trim(),
        defaultAmountG: toNumberInput(defaultAmountG),
        proteinG: macros.proteinG,
        carbG: macros.carbG,
        fatG: macros.fatG,
        // 方案 2：kcal 一律由 P/F/C 派生，不单独填
        kcal: recalcKcal(macros.proteinG, macros.carbG, macros.fatG),
        active: active ? 1 : 0,
        // timing / note 是可选字段，但始终写入（可能是空串）：patch 是"读-合并-写"，
        // 省略字段等于"不改"，用户清空后旧值会赖着不走
        timing: timing.trim(),
        note: note.trim(),
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
      // noValidate：浏览器原生校验会先拦下提交，让我们的提示永远不出现（详见 FoodLibraryForm）
      noValidate
      onSubmit={(event) => {
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
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-timing`}>
          服用时机
          <input
            id={`${idPrefix}-timing`}
            className={`${INPUT_CLASS} w-32`}
            value={timing}
            onChange={(event) => setTiming(event.target.value)}
            placeholder="训练后"
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-amount`}>
          默认份量 (g)
          <input
            id={`${idPrefix}-amount`}
            type="number"
            min={1}
            step="any"
            className={`${INPUT_CLASS} w-24`}
            value={defaultAmountG}
            onChange={(event) => setDefaultAmountG(event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-note`}>
          备注
          <input
            id={`${idPrefix}-note`}
            className={`${INPUT_CLASS} w-40`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={saving}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600" htmlFor={`${idPrefix}-active`}>
          <input
            id={`${idPrefix}-active`}
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={saving}
          />
          启用
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-slate-500">下面的营养值对应上面这一份（{toNumberInput(defaultAmountG)}g）</p>
        <MacroInputs value={macros} onChange={setMacros} disabled={saving} />
      </div>

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
