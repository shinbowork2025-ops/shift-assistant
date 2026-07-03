// 分単位の時間区間ユーティリティ。
// break-rules.jsとshift-metrics.jsの双方から使うため、循環importを避けて独立させている。
export function mergedIntervalMinutes(intervals = []) {
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval?.start) && Number.isFinite(interval?.end) && interval.end > interval.start)
    .map((interval) => ({ start: interval.start, end: interval.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!sorted.length) return 0;
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;

  for (const interval of sorted.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      total += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  return total + currentEnd - currentStart;
}
