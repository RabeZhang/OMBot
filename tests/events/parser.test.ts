import { describe, expect, it } from "vitest";

import { parseEventFile } from "../../src/events/parser";

describe("parseEventFile", () => {
  it("parses one-shot events with default readonly profile", () => {
    const parsed = parseEventFile(
      "daily-reminder.json",
      JSON.stringify({
        type: "one-shot",
        text: "提醒检查 nginx",
        at: "2026-03-20T09:00:00+08:00",
      }),
      { defaultTimezone: "Asia/Shanghai" },
    );

    expect(parsed.eventId).toBe("evt_daily-reminder");
    expect(parsed.event.type).toBe("one-shot");
    expect(parsed.event.profile).toBe("readonly");
  });

  it("fills periodic timezone from defaults", () => {
    const parsed = parseEventFile(
      "periodic-check.json",
      JSON.stringify({
        type: "periodic",
        text: "每小时巡检一次",
        schedule: "0 * * * *",
      }),
      { defaultTimezone: "Asia/Shanghai" },
    );

    expect(parsed.event.type).toBe("periodic");
    if (parsed.event.type !== "periodic") {
      throw new Error("expected periodic event");
    }
    expect(parsed.event.timezone).toBe("Asia/Shanghai");
    expect(parsed.event.profile).toBe("readonly");
  });

  it("rejects invalid cron expressions", () => {
    expect(() =>
      parseEventFile(
        "broken.json",
        JSON.stringify({
          type: "periodic",
          text: "bad cron",
          schedule: "not-a-cron",
        }),
        { defaultTimezone: "Asia/Shanghai" },
      ),
    ).toThrow("周期事件 cron 非法");
  });
});
