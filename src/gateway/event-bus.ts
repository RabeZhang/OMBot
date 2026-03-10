import type { EventBus, GatewayEvent } from "./types";

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Set<(event: GatewayEvent) => void | Promise<void>>();

  async publish(event: GatewayEvent): Promise<void> {
    // 顺序投递更利于测试和调试，后续如果吞吐成瓶颈再考虑并行分发。
    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  subscribe(handler: (event: GatewayEvent) => void | Promise<void>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
