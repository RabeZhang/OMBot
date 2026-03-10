export function nowIsoString(date: Date = new Date()): string {
  // 统一用 ISO 时间串，后面写入 JSONL、日志和数据库时都能直接复用。
  return date.toISOString();
}
