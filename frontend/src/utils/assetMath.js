export const CATEGORY_SUGGESTIONS = ['Electronics', 'Furniture', 'Office Equipment', 'Other'];
export const TYPE_SUGGESTIONS = [
  'Laptop', 'Desktop', 'Monitor', 'Phone', 'Printer', 'Headset', 'Keyboard',
  'Desk', 'Chair', 'Cabinet',
  'Kettle', 'Coffee machine',
];

export function computeBookValue(asset) {
  if (asset.purchaseValue == null || asset.depreciationPercentPerYear == null || !asset.purchaseDate) return null;
  const purchaseDate = new Date(asset.purchaseDate);
  if (Number.isNaN(purchaseDate.getTime())) return null;
  const yearsElapsed = (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const remainingFraction = Math.max(0, 1 - (yearsElapsed * asset.depreciationPercentPerYear) / 100);
  return asset.purchaseValue * remainingFraction;
}

export function computeReplacementInfo(asset) {
  if (!asset.purchaseDate || !asset.usefulLifeYears) return null;
  const purchaseDate = new Date(asset.purchaseDate);
  if (Number.isNaN(purchaseDate.getTime())) return null;
  const replaceDate = new Date(purchaseDate);
  replaceDate.setFullYear(replaceDate.getFullYear() + asset.usefulLifeYears);
  const msInDay = 86400000;
  const daysRemaining = Math.round((replaceDate.getTime() - Date.now()) / msInDay);
  return { replaceDate, daysRemaining };
}

export function formatMoney(n) {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });
}

export function formatRelative(days) {
  if (days < 0) return `Overdue by ${-days} day${-days === 1 ? '' : 's'}`;
  if (days === 0) return 'Replace today';
  if (days < 30) return `Replace in ${days} day${days === 1 ? '' : 's'}`;
  if (days < 365) return `Replace in ${Math.round(days / 30)} month${Math.round(days / 30) === 1 ? '' : 's'}`;
  return `Replace in ${(days / 365).toFixed(1)} years`;
}

export function getAssetStatus(asset) {
  if (asset.isInRepairs) return 'repairs';
  if (asset.assignedEmployeeId) return 'allocated';
  return 'storage';
}
