export const CATEGORIES = ['HR', 'Engineering', 'Finance', 'Product', 'Security'] as const;

export type Category = (typeof CATEGORIES)[number];
