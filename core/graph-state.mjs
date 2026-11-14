export function validGraphState(value) {
  return Boolean(value && typeof value.key === 'string' && value.key.length <= 4 * 1024 * 1024 && ['ready', 'budget-limited', 'manual'].includes(value.state)
    && Number.isFinite(value.zoom) && value.zoom >= .005 && value.zoom <= 10 && Number.isFinite(value.centerX) && Number.isFinite(value.centerY)
    && Array.isArray(value.positions) && value.positions.length <= 20000 && value.positions.every(node => node && typeof node.id === 'string' && node.id.length <= 512 && Number.isFinite(node.x) && Number.isFinite(node.y) && Math.abs(node.x) < 1e7 && Math.abs(node.y) < 1e7)
    && new Set(value.positions.map(node => node.id)).size === value.positions.length);
}