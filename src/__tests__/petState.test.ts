import { describe, expect, it } from "vitest";

import {
  DEFAULT_PET_THEME_ID,
  INK_AI,
  INK_YOU,
  PET_THEMES,
  decidePetState,
  resolveTheme,
  visualForState,
} from "../lib/petState";
import type { PetStateInput, PetVisual } from "../lib/petState";

const base: PetStateInput = {
  attributionFailed: false,
  daemonUnhealthy: false,
  hookMissing: false,
  attributing: false,
  lowAiShare: false,
  idle: false,
};

describe("decidePetState", () => {
  it("全部正常 → ok", () => {
    expect(decidePetState(base)).toBe("ok");
  });

  it("打标失败压倒一切(最高优先级)", () => {
    expect(
      decidePetState({
        attributionFailed: true,
        daemonUnhealthy: true,
        hookMissing: true,
        attributing: true,
        lowAiShare: true,
        idle: true,
      }),
    ).toBe("attribution_failed");
  });

  it("优先级逐级仲裁:daemon > hook > 打标中 > 低 AI > 睡眠", () => {
    expect(decidePetState({ ...base, daemonUnhealthy: true, hookMissing: true })).toBe(
      "daemon_unhealthy",
    );
    expect(decidePetState({ ...base, hookMissing: true, attributing: true })).toBe("hook_missing");
    expect(decidePetState({ ...base, attributing: true, lowAiShare: true })).toBe("attributing");
    expect(decidePetState({ ...base, lowAiShare: true, idle: true })).toBe("low_ai_share");
    expect(decidePetState({ ...base, idle: true })).toBe("sleeping");
  });
});

describe("resolveTheme", () => {
  it("已知 id 返回对应主题", () => {
    expect(resolveTheme("robotflat").id).toBe("robotflat");
  });

  it("未知 / null 退回默认(第一个),绝不崩", () => {
    expect(resolveTheme(null).id).toBe(DEFAULT_PET_THEME_ID);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_PET_THEME_ID);
    expect(resolveTheme("nonexistent").id).toBe(PET_THEMES[0].id);
  });

  it("内置三套形象主题都有 4 态图 + 合法 gauge 位置", () => {
    const visuals: PetVisual[] = ["idle", "happy", "sleep", "alert"];
    expect(PET_THEMES).toHaveLength(3);
    for (const theme of PET_THEMES) {
      for (const v of visuals) {
        expect(theme.images[v]).toBeTruthy();
      }
      expect(theme.gauge.cx).toBeGreaterThanOrEqual(0);
      expect(theme.gauge.cx).toBeLessThanOrEqual(1);
      expect(theme.gauge.cy).toBeGreaterThanOrEqual(0);
      expect(theme.gauge.cy).toBeLessThanOrEqual(1);
      expect(theme.gauge.r).toBeGreaterThan(0);
    }
  });

  it("信息层语义色是合法 hex(全局锁死,主题不可改写)", () => {
    expect(INK_AI).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(INK_YOU).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("visualForState", () => {
  it("异常三态(打标失败 / daemon / hook)都 urgent + 用 alert 图 + 有染色", () => {
    for (const kind of ["attribution_failed", "daemon_unhealthy", "hook_missing"] as const) {
      const v = visualForState(kind, 50);
      expect(v.urgent).toBe(true);
      expect(v.visual).toBe("alert");
      expect(v.tint).not.toBeNull();
    }
  });

  it("打标失败染红、daemon 抖动(明显提醒)", () => {
    expect(visualForState("attribution_failed", null).tint).toContain("220,38,38");
    expect(visualForState("daemon_unhealthy", null).shake).toBe(true);
  });

  it("打标中脉冲、不 urgent(瞬态工作动效)", () => {
    const v = visualForState("attributing", null);
    expect(v.pulse).toBe(true);
    expect(v.urgent).toBe(false);
  });

  it("正常态:高 AI 率露 happy,低 / 无数据用 idle", () => {
    expect(visualForState("ok", 80).visual).toBe("happy");
    expect(visualForState("ok", 10).visual).toBe("idle");
    expect(visualForState("ok", null).visual).toBe("idle");
  });

  it("睡眠态:用 sleep 图、无染色、不打扰", () => {
    const v = visualForState("sleeping", null);
    expect(v.visual).toBe("sleep");
    expect(v.tint).toBeNull();
    expect(v.urgent).toBe(false);
  });

  it("unknown(数据未加载):中性 idle、无染色、不打扰(不粉饰为正常)", () => {
    const v = visualForState("unknown", null);
    expect(v.visual).toBe("idle");
    expect(v.tint).toBeNull();
    expect(v.urgent).toBe(false);
  });
});
