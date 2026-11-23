export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatScore(value) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toFixed(2);
}

export function capitalize(value) {
  return String(value || '').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
