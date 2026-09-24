import { useState } from 'react';
import type { FormEvent } from 'react';

import { addFood } from '../db/repo';
import type { FoodLibraryItem } from '../db/schema';

interface SaveAsFoodFormProps {
  defaultName: string;
  /** 每 100g 的营养值，作为表单默认值 */
  defaultPer100g: { proteinG: number; carbG: number; fatG: number; kcal: number };
  onSaved: (food: FoodLibraryItem) => void;
  onCancel: () => void;
}

/** 输入框用字符串存值，提交时再解析：否则用户清空输入框会被迫看到 0 */
function toNumber(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const INPUT_CLASS =
  'w-20 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500';

export default function SaveAsFoodForm({ defaultName, defaultPer100g, onSaved, onCancel }: SaveAsFoodFormProps) {
  const [name, setName] = useState(defaultName);
  const [aliases, setAliases] = useState('');
  const [proteinG, setProteinG] = useState(String(defaultPer100g.proteinG));
  const [carbG, setCarbG] = useState(String(defaultPer100g.carbG));
  const [fatG, setFatG] = useState(String(defaultPer100g.fatG));
  const [kcal, setKcal] = useState(String(defaultPer100g.kcal));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('请填写名称');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const food = await addFood({
        name: trimmedName,
        // 中英文逗号都接受，用户不必记格式
        aliases: aliases
          .split(/[,，]/)
          .map((alias) => alias.trim())
          .filter((alias) => alias !== ''),
        perAmount: 100,
        perUnit: 'g',
        proteinG: toNumber(proteinG),
        carbG: toNumber(carbG),
        fatG: toNumber(fatG),
        kcal: toNumber(kcal),
      });
      onSaved(food);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        // React 的 onSubmit 不接收 async 函数，包一层避免 floating promise
        void handleSubmit(event);
      }}
      className="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-3"
    >
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        名称
        <input
          className={`${INPUT_CLASS} w-40`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="食物名称"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-600">
        别名（逗号分隔）
        <input
          className={`${INPUT_CLASS} w-48`}
          value={aliases}
          onChange={(event) => setAliases(event.target.value)}
          placeholder="鸡肉, chicken breast"
          aria-label="别名"
        />
      </label>

      {(
        [
          ['蛋白质', proteinG, setProteinG],
          ['碳水', carbG, setCarbG],
          ['脂肪', fatG, setFatG],
          ['热量', kcal, setKcal],
        ] as const
      ).map(([label, value, setter]) => (
        <label key={label} className="flex flex-col gap-1 text-xs text-slate-600">
          {label}/100g
          <input
            className={INPUT_CLASS}
            value={value}
            onChange={(event) => setter(event.target.value)}
            aria-label={`每100g ${label}`}
          />
        </label>
      ))}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? '保存中…' : '存入食物库'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600"
        >
          取消
        </button>
      </div>

      {error !== null && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
