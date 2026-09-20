import { afterEach, describe, expect, it, vi } from "vitest";
import type { LotteryStatus } from "@memmy/local-api-contracts";
import {
  CAMPAIGN_PROMPT_MAX_SHOWS,
  CAMPAIGN_PROMPT_STORAGE_KEY,
  isCampaignPromptSurfaceReady,
  markCampaignPromptActioned,
  markCampaignPromptDismissed,
  markCampaignPromptShown,
  readCampaignPromptState,
  shouldOfferCampaignPrompt,
  type CampaignPromptPersistedState
} from "../campaign-prompt-state.js";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const duringCampaign = 1790456789000;

function remoteStatus(overrides: Partial<LotteryStatus> = {}): LotteryStatus {
  return {
    shouldShow: true,
    startAt: 1790121600000,
    endAt: 1790812800000,
    serverNow: duringCampaign,
    landingUrl: "https://memmy.cn/activity/mid-autumn",
    ...overrides
  };
}

function emptyState(): CampaignPromptPersistedState {
  return { showCount: 0, dismissedAt: null, actioned: false };
}

describe("campaign prompt eligibility", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("offers the prompt during the campaign window", () => {
    expect(shouldOfferCampaignPrompt(emptyState(), remoteStatus())).toBe(true);
  });

  it("fails closed when the remote switch is off or unavailable", () => {
    expect(shouldOfferCampaignPrompt(emptyState(), remoteStatus({ shouldShow: false }))).toBe(false);
    expect(shouldOfferCampaignPrompt(emptyState(), undefined)).toBe(false);
  });

  it("uses server time to enforce the remote campaign window", () => {
    expect(shouldOfferCampaignPrompt(emptyState(), remoteStatus({ serverNow: 1790121599999 }))).toBe(false);
    expect(shouldOfferCampaignPrompt(emptyState(), remoteStatus({ serverNow: 1790812800000 }))).toBe(false);
  });

  it("is ready on welcome, login, and signed-in routes after boot", () => {
    for (const currentPath of ["/welcome", "/login", "/main", "/onboarding", "/settings"]) {
      expect(isCampaignPromptSurfaceReady({ startupStatus: "ready", currentPath })).toBe(true);
    }
  });

  it("waits for boot and skips the pet window", () => {
    expect(isCampaignPromptSurfaceReady({ startupStatus: "loading", currentPath: "/welcome" })).toBe(false);
    expect(isCampaignPromptSurfaceReady({ startupStatus: "ready", currentPath: "/pet" })).toBe(false);
  });

  it("stops after one show or a site visit", () => {
    expect(CAMPAIGN_PROMPT_MAX_SHOWS).toBe(1);
    expect(shouldOfferCampaignPrompt({
      showCount: CAMPAIGN_PROMPT_MAX_SHOWS,
      dismissedAt: null,
      actioned: false
    }, remoteStatus())).toBe(false);
    expect(shouldOfferCampaignPrompt({
      showCount: 0,
      dismissedAt: null,
      actioned: true
    }, remoteStatus())).toBe(false);
  });

  it("persists shown, dismissed, and actioned states", () => {
    const storage = new MemoryStorage();
    expect(readCampaignPromptState(storage)).toEqual(emptyState());

    expect(markCampaignPromptShown(storage)).toMatchObject({ showCount: 1, dismissedAt: null });
    expect(JSON.parse(storage.getItem(CAMPAIGN_PROMPT_STORAGE_KEY) ?? "{}")).toMatchObject({ showCount: 1 });
    expect(shouldOfferCampaignPrompt(readCampaignPromptState(storage), remoteStatus())).toBe(false);

    expect(markCampaignPromptDismissed(storage, duringCampaign).dismissedAt).toBe(duringCampaign);
    expect(markCampaignPromptActioned(storage)).toMatchObject({ actioned: true, dismissedAt: null });
    expect(shouldOfferCampaignPrompt(readCampaignPromptState(storage), remoteStatus())).toBe(false);
  });
});
