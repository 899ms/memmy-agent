/** Local persistence and eligibility for the Mid-Autumn campaign prompt. */

/** Kill switch — set false to disable the prompt for everyone without a backend UI. */
export const CAMPAIGN_PROMPT_ENABLED = true;

export const CAMPAIGN_PROMPT_STORAGE_KEY = "memmy.campaignPrompt.v1";
export const CAMPAIGN_PROMPT_MAX_SHOWS = 1;

/** 2026-09-23 00:00 Asia/Shanghai */
export const CAMPAIGN_PROMPT_START_MS = Date.UTC(2026, 8, 22, 16, 0, 0);
/** 2026-10-01 00:00 Asia/Shanghai — after 9/30, never show again. */
export const CAMPAIGN_PROMPT_END_MS = Date.UTC(2026, 8, 30, 16, 0, 0);

export interface CampaignPromptPersistedState {
  showCount: number;
  dismissedAt: number | null;
  actioned: boolean;
}

const EMPTY_STATE: CampaignPromptPersistedState = {
  showCount: 0,
  dismissedAt: null,
  actioned: false
};

let campaignPromptOpen = false;

/** Whether the campaign prompt is currently on screen (hides the GitHub star card). */
export function isCampaignPromptOpen(): boolean {
  return campaignPromptOpen;
}

/** Records whether the campaign prompt is currently rendered. */
export function setCampaignPromptOpen(open: boolean): void {
  campaignPromptOpen = open;
}

/** Reads persisted campaign prompt state from storage. */
export function readCampaignPromptState(storage: Storage | undefined): CampaignPromptPersistedState {
  if (!storage) {
    return { ...EMPTY_STATE };
  }
  try {
    const raw = storage.getItem(CAMPAIGN_PROMPT_STORAGE_KEY);
    if (!raw) {
      return { ...EMPTY_STATE };
    }
    const parsed = JSON.parse(raw) as Partial<CampaignPromptPersistedState>;
    return {
      showCount: typeof parsed.showCount === "number" && parsed.showCount >= 0 ? Math.floor(parsed.showCount) : 0,
      dismissedAt: typeof parsed.dismissedAt === "number" ? parsed.dismissedAt : null,
      actioned: parsed.actioned === true
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Writes persisted campaign prompt state to storage. */
export function writeCampaignPromptState(
  storage: Storage | undefined,
  state: CampaignPromptPersistedState
): void {
  if (!storage) {
    return;
  }
  storage.setItem(CAMPAIGN_PROMPT_STORAGE_KEY, JSON.stringify(state));
}

/** Whether the campaign prompt may be offered on this app open. Login is not required. */
export function shouldOfferCampaignPrompt(
  state: CampaignPromptPersistedState,
  nowMs: number = Date.now()
): boolean {
  if (!CAMPAIGN_PROMPT_ENABLED) {
    return false;
  }
  if (nowMs < CAMPAIGN_PROMPT_START_MS || nowMs >= CAMPAIGN_PROMPT_END_MS) {
    return false;
  }
  if (state.actioned) {
    return false;
  }
  if (state.showCount >= CAMPAIGN_PROMPT_MAX_SHOWS) {
    return false;
  }
  return true;
}

/** Surfaces that can show the campaign prompt after boot. Login is not required. */
export function isCampaignPromptSurfaceReady(input: {
  startupStatus: string;
  currentPath: string;
}): boolean {
  if (input.startupStatus !== "ready") {
    return false;
  }
  return input.currentPath !== "/pet";
}

/** Records that the prompt was shown (counts toward the max of 1). */
export function markCampaignPromptShown(storage: Storage | undefined): CampaignPromptPersistedState {
  const current = readCampaignPromptState(storage);
  const next: CampaignPromptPersistedState = {
    ...current,
    showCount: current.showCount + 1,
    dismissedAt: null
  };
  writeCampaignPromptState(storage, next);
  return next;
}

/** Records "maybe later". With a one-show cap, this does not reopen later. */
export function markCampaignPromptDismissed(
  storage: Storage | undefined,
  nowMs: number = Date.now()
): CampaignPromptPersistedState {
  const current = readCampaignPromptState(storage);
  const next: CampaignPromptPersistedState = {
    ...current,
    dismissedAt: nowMs
  };
  writeCampaignPromptState(storage, next);
  return next;
}

/** Records that the user opened the activity site — never show again. */
export function markCampaignPromptActioned(storage: Storage | undefined): CampaignPromptPersistedState {
  const current = readCampaignPromptState(storage);
  const next: CampaignPromptPersistedState = {
    ...current,
    actioned: true,
    dismissedAt: null
  };
  writeCampaignPromptState(storage, next);
  return next;
}
