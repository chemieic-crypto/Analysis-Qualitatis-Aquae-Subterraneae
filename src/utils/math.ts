export interface StatsResult {
  min: number;
  max: number;
  avg: number;
  std: number;
}

export function getStats(arr: number[]): StatsResult {
  if (!arr.length) return { min: 0, max: 0, avg: 0, std: 0 };
  const n = arr.length;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const avg = arr.reduce((a, b) => a + b, 0) / n;
  
  // Calculate standard deviation
  const variance = arr.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(variance);
  
  return { min, max, avg, std };
}
