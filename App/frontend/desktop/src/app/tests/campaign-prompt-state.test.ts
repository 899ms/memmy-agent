import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMPAIGN_PROMPT_END_MS,
  CAMPAIGN_PROMPT_MAX_SHOWS,
  CAMPAIGN_PROMPT_START_MS,
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

const duringCampaign = CAMPAIGN_PROMPT_START_MS + 24 * 60 * 60 * 1000;

function emptyState(): CampaignPromptPersistedState {
  return { showCount: 0, dismissedAt: null, actioned: false };
}

describe("campaign prompt eligibility", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("offers the prompt during the campaign window", () => {
    expect(shouldOfferCampaignPrompt(emptyState(), duringCampaign)).toBe(true);
  });

  it("hides the prompt before start and after 9/30", () => {
    expect(shouldOfferCampaignPrompt(emptyState(), CAMPAIGN_PROMPT_START_MS - 1)).toBe(false);
    expect(shouldOfferCampaignPrompt(emptyState(), CAMPAIGN_PROMPT_END_MS)).toBe(false);
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
    }, duringCampaign)).toBe(false);
    expect(shouldOfferCampaignPrompt({
      showCount: 0,
      dismissedAt: null,
      actioned: true
    }, duringCampaign)).toBe(false);
  });

  it("persists shown, dismissed, and actioned states", () => {
    const storage = new MemoryStorage();
    expect(readCampaignPromptState(storage)).toEqual(emptyState());

    expect(markCampaignPromptShown(storage)).toMatchObject({ showCount: 1, dismissedAt: null });
    expect(JSON.parse(storage.getItem(CAMPAIGN_PROMPT_STORAGE_KEY) ?? "{}")).toMatchObject({ showCount: 1 });
    expect(shouldOfferCampaignPrompt(readCampaignPromptState(storage), duringCampaign)).toBe(false);

    expect(markCampaignPromptDismissed(storage, duringCampaign).dismissedAt).toBe(duringCampaign);
    expect(markCampaignPromptActioned(storage)).toMatchObject({ actioned: true, dismissedAt: null });
    expect(shouldOfferCampaignPrompt(readCampaignPromptState(storage), duringCampaign)).toBe(false);
  });
});
