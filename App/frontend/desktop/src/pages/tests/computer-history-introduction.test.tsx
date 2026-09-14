// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComputerHistorySnapshot, MemmyAgentClient } from "../../api/memmy-agent-client.js";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { applyHistoryIntroductionSettings, ComputerHistoryIntroduction } from "../memory/computer-history-introduction.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snapshot(state: ComputerHistorySnapshot["observation"]["state"] = "stopped", error: string | null = null): ComputerHistorySnapshot {
  return { observation: { state, startedAt: null, segmentId: null, segmentStartedAt: null, error, narrationError: null },
    histories: [], workflows: [], privacy: { screenshots: false, audio: false, rawRetentionHours: 48, markdownDirectory: "/tmp/history", eventStreamDirectory: "/tmp/events" } };
}

describe("passive Computer History introduction", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function client(initial = snapshot()) {
    let current = initial;
    const api = {
      getComputerHistory: vi.fn(async () => current),
      startComputerHistoryObservation: vi.fn(async () => { current = snapshot("running"); return current; }),
      resumeComputerHistoryObservation: vi.fn(async () => { current = snapshot("running"); return current; }),
      stopComputerHistoryObservation: vi.fn(async () => { current = snapshot("stopped"); return current; }),
    };
    return { api, value: api as unknown as MemmyAgentClient, set: (value: ComputerHistorySnapshot) => { current = value; } };
  }

  async function render(value: MemmyAgentClient) {
    const onApplied = vi.fn();
    const onClose = vi.fn();
    await act(async () => root.render(<I18nProvider language="zh-CN"><ComputerHistoryIntroduction client={value} onClose={onClose} onApplied={onApplied} /></I18nProvider>));
    return { onApplied, onClose };
  }
  function button(label: string) {
    const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
    expect(target, label).toBeDefined();
    return target!;
  }

  it("reads the upstream state and keeps draft changes local until confirmation", async () => {
    const state = client(snapshot("running"));
    const { onClose } = await render(state.value);
    const switches = document.querySelectorAll('[role="switch"]');
    expect(switches).toHaveLength(1);
    expect(switches[0].getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).not.toContain("主动提醒");
    expect(document.body.textContent).not.toContain("提醒事项");
    await act(async () => button("开启计算机使用记录").click());
    expect(state.api.stopComputerHistoryObservation).not.toHaveBeenCalled();
    await act(async () => button("稍后再看").click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(state.api.stopComputerHistoryObservation).not.toHaveBeenCalled();
  });

  it("defaults the draft to on and starts only after confirmation", async () => {
    const state = client();
    const { onApplied } = await render(state.value);
    expect(button("开启计算机使用记录").getAttribute("aria-checked")).toBe("true");
    expect(state.api.startComputerHistoryObservation).not.toHaveBeenCalled();
    await act(async () => button("开始体验").click());
    expect(state.api.startComputerHistoryObservation).toHaveBeenCalledOnce();
    expect(onApplied).toHaveBeenCalledWith(snapshot("running"));
  });

  it("does not start recording when the default-on introduction is dismissed", async () => {
    const state = client();
    const { onApplied, onClose } = await render(state.value);
    await act(async () => button("稍后再看").click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onApplied).not.toHaveBeenCalled();
    expect(state.api.startComputerHistoryObservation).not.toHaveBeenCalled();
    expect(state.api.resumeComputerHistoryObservation).not.toHaveBeenCalled();
    expect(state.api.stopComputerHistoryObservation).not.toHaveBeenCalled();
  });

  it("browses all three history examples without applying settings or losing navigation focus", async () => {
    const state = client();
    const { onApplied, onClose } = await render(state.value);
    const next = button("下一个示例");
    const content = () => document.querySelector('[aria-live="polite"]')?.textContent;
    expect(content()).toContain("终端与浏览器中的操作");
    expect(content()).not.toContain("今天的待办");
    next.focus();
    await act(async () => next.click());
    expect(content()).toContain("你在电脑上看过的聊天");
    expect(document.activeElement).toBe(next);
    await act(async () => next.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(content()).toContain("聊天与浏览器中的访问记录");
    await act(async () => next.click());
    expect(content()).toContain("可以按这段操作整理成可复用的技能");
    await act(async () => button("上一个示例").click());
    expect(content()).toContain("产品规划");
    await act(async () => button("找出聊过的待办").click());
    expect(content()).toContain("整理出了两项待办");
    expect(button("找出聊过的待办").getAttribute("aria-current")).toBe("true");
    expect(state.api.getComputerHistory).toHaveBeenCalledOnce();
    expect(state.api.startComputerHistoryObservation).not.toHaveBeenCalled();
    expect(state.api.stopComputerHistoryObservation).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("preserves a paused session when the default-on suggestion is turned off", async () => {
    const state = client(snapshot("paused"));
    const { onApplied } = await render(state.value);
    await act(async () => button("开启计算机使用记录").click());
    await act(async () => button("知道了").click());
    expect(state.api.stopComputerHistoryObservation).not.toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalledWith(snapshot("paused"));
  });

  it("resumes paused recording and stops only when the user confirms off", async () => {
    const state = client(snapshot("paused"));
    await expect(applyHistoryIntroductionSettings(state.value, true)).resolves.toMatchObject({ observation: { state: "running" } });
    expect(state.api.resumeComputerHistoryObservation).toHaveBeenCalledOnce();
    await expect(applyHistoryIntroductionSettings(state.value, false)).resolves.toMatchObject({ observation: { state: "stopped" } });
    expect(state.api.stopComputerHistoryObservation).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open on capture failure and can retry from actual state", async () => {
    const state = client();
    state.api.startComputerHistoryObservation.mockImplementationOnce(async () => {
      state.set(snapshot("failed", "请先授予辅助功能权限"));
      throw new Error("请先授予辅助功能权限");
    });
    const { onApplied } = await render(state.value);
    await act(async () => button("开始体验").click());
    expect(onApplied).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("辅助功能权限");
    await act(async () => button("开始体验").click());
    expect(onApplied).toHaveBeenCalledWith(snapshot("running"));
  });

  it("handles a concurrent start that already achieved the requested state", async () => {
    const state = client();
    state.api.startComputerHistoryObservation.mockImplementationOnce(async () => {
      state.set(snapshot("running"));
      throw new Error("already running");
    });
    await expect(applyHistoryIntroductionSettings(state.value, true)).resolves.toEqual(snapshot("running"));
  });

  it("explains connection failures without a never-ending loading label", async () => {
    const state = client();
    state.api.getComputerHistory.mockRejectedValueOnce(new Error("memmy-agent request failed with status 401"));
    await render(state.value);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("连接暂不可用");
    expect(button("暂不可用").disabled).toBe(true);
    await act(async () => button("重新读取").click());
    expect(button("开始体验").disabled).toBe(false);
  });
});
