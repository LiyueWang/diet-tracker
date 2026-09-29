import { useId, useState } from 'react';

import { recalcKcal } from '../services/nutrition';

export interface MacroValue {
  proteinG: number;
  carbG: number;
  fatG: number;
}

interface MacroInputsProps {
  value: MacroValue;
  onChange: (next: MacroValue) => void;
  disabled?: boolean;
}

type MacroField = keyof MacroValue;

const FIELDS: ReadonlyArray<{ field: MacroField; label: string }> = [
  { field: 'proteinG', label: '蛋白质 (g)' },
  { field: 'carbG', label: '碳水 (g)' },
  { field: 'fatG', label: '脂肪 (g)' },
];

const INPUT_CLASS =
  'w-20 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100';

/** 空值 / 非法输入一律按 0 处理（规格要求"输入为空时按 0 处理，不报错"） */
function toNumber(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toText(value: MacroValue): Record<MacroField, string> {
  return {
    proteinG: String(value.proteinG),
    carbG: String(value.carbG),
    fatG: String(value.fatG),
  };
}

function toValue(text: Record<MacroField, string>): MacroValue {
  return {
    proteinG: toNumber(text.proteinG),
    carbG: toNumber(text.carbG),
    fatG: toNumber(text.fatG),
  };
}

/**
 * P/F/C 三个输入 + 只读热量。
 * 输入框内部用字符串存文本而不是直接受控于数字：`type="number"` 下用户敲到 "2." 这一瞬间
 * 浏览器会把 value 报成空串，若直接按 0 回写，小数点就永远打不出来。
 */
export default function MacroInputs({ value, onChange, disabled = false }: MacroInputsProps) {
  const idPrefix = useId();
  const [text, setText] = useState<Record<MacroField, string>>(() => toText(value));

  const parsed = toValue(text);
  // 外部值变了（比如管理页从"新增"切到"编辑某条"）才跟着调整内部文本。
  // 自己输入引起的回流不会命中：那时外部值就等于内部解析值，"2." 这种中间态得以保留。
  if (parsed.proteinG !== value.proteinG || parsed.carbG !== value.carbG || parsed.fatG !== value.fatG) {
    setText(toText(value));
  }

  function handleChange(field: MacroField, raw: string): void {
    const nextText = { ...text, [field]: raw };
    setText(nextText);
    onChange(toValue(nextText));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {FIELDS.map(({ field, label }) => (
        <label key={field} className="flex flex-col gap-1 text-xs text-slate-600" htmlFor={`${idPrefix}-${field}`}>
          {label}
          <input
            id={`${idPrefix}-${field}`}
            type="number"
            min={0}
            step="any"
            className={INPUT_CLASS}
            value={text[field]}
            onChange={(event) => handleChange(field, event.target.value)}
            disabled={disabled}
          />
        </label>
      ))}

      <div className="flex flex-col gap-1 text-xs text-slate-600">
        热量 (kcal)
        {/* 热量是 P/F/C 的派生值，只读展示（方案 2：kcal 不独立存储） */}
        <span className="px-2 py-1 text-sm text-slate-700">{recalcKcal(value.proteinG, value.carbG, value.fatG)}</span>
      </div>
    </div>
  );
}
