export const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  HR: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  Engineering: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  Finance: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  Product: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  Security: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
};

export const DEFAULT_CATEGORY_COLOR = { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };

export function categoryColor(category?: string | null) {
  if (!category) return DEFAULT_CATEGORY_COLOR;
  return CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;
}
