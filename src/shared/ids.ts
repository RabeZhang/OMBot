import { randomBytes, randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  // 带前缀的 ID 在日志和 transcript 里更容易肉眼区分对象类型。
  return `${prefix}_${randomUUID()}`;
}

export function createShortRef(prefix: string, bytes = 1): string {
  return `${prefix}${randomBytes(bytes).toString("hex")}`;
}
