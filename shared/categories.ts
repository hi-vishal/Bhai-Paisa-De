export const CATEGORIES = {
  food: { emoji: '🍛', en: 'Food', hi: 'Khaana' },
  drinks: { emoji: '🍻', en: 'Drinks', hi: 'Daaru-paani' },
  chai: { emoji: '☕', en: 'Chai & coffee', hi: 'Chai-sutta' },
  travel: { emoji: '🛺', en: 'Travel', hi: 'Safar' },
  stay: { emoji: '🏨', en: 'Stay', hi: 'Rehna' },
  groceries: { emoji: '🛒', en: 'Groceries', hi: 'Ration' },
  rent: { emoji: '🏠', en: 'Rent', hi: 'Kiraya' },
  bills: { emoji: '💡', en: 'Bills', hi: 'Bills' },
  fun: { emoji: '🎳', en: 'Fun', hi: 'Masti' },
  shopping: { emoji: '🛍️', en: 'Shopping', hi: 'Shopping' },
  gifts: { emoji: '🎁', en: 'Gifts', hi: 'Gift' },
  other: { emoji: '🧾', en: 'Other', hi: 'Baaki' },
} as const

export type Category = keyof typeof CATEGORIES
export const isCategory = (c: unknown): c is Category => typeof c === 'string' && c in CATEGORIES
