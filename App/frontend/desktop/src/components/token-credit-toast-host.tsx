/** Enqueues the token-credit notification after a campaign reward is granted. */
import { useEffect, useRef } from "react";
import { isDesktopPromptPreview } from "../app/desktop-prompt-preview.js";
import { useOptionalApiClients } from "../app/providers.js";
import { useTranslation } from "../i18n/use-translation.js";
import { formatTokenGiftAmount } from "../pages/token-gift.js";
import { appActions } from "../state/app-actions.js";
import { useAppState } from "../state/app-state.js";
import { useNotificationCenter } from "./notification-center.js";

const PREVIEW_TOKEN_AMOUNT = 500_000;

/** Pushes a manual-close credit notice; cloud unread-reward fetch is still pending. */
export function TokenCreditToastHost() {
  const { dispatch } = useAppState();
  const { clients } = useOptionalApiClients();
  const { t } = useTranslation();
  const { notify } = useNotificationCenter();
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (notifiedRef.current || !isDesktopPromptPreview("tokenCredit")) {
      return;
    }
    notifiedRef.current = true;
    showTokenCredit(PREVIEW_TOKEN_AMOUNT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refreshes the token balance after the user closes the notice. */
  function refreshBalance() {
    if (!clients) {
      return;
    }
    void clients.bootstrap
      .getBootstrap()
      .then((bootstrap) => dispatch(appActions.tokenUsageUpdated(bootstrap.tokenUsage)))
      .catch((error: unknown) => console.warn("[token-credit] failed to refresh token usage:", error));
  }

  /** Enqueues the title + amount credit notification. */
  function showTokenCredit(tokens: number) {
    notify({
      variant: "success",
      title: t("tokenCredit.title"),
      emphasis: `+${formatTokenGiftAmount(tokens)}`,
      onClose: refreshBalance
    });
  }

  return null;
}
