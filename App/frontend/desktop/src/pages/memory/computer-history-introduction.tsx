import { ChevronLeft, ChevronRight, History, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ComputerHistorySnapshot, MemmyAgentClient } from "../../api/memmy-agent-client.js";
import { useTranslation } from "../../i18n/use-translation.js";
import "./computer-history-introduction.css";

export const HISTORY_INTRO_SEEN_KEY = "memmy.computerHistoryIntroduction.v2";

export function shouldIntroduceComputerHistory(): boolean {
  try { return window.localStorage.getItem(HISTORY_INTRO_SEEN_KEY) !== "seen"; } catch { return false; }
}

export function markComputerHistoryIntroduced(): void {
  try { window.localStorage.setItem(HISTORY_INTRO_SEEN_KEY, "seen"); } catch { /* Storage is optional. */ }
}

/** Reuse the upstream lifecycle API. Running acknowledges the start request;
 * the upstream page remains responsible for reporting later process errors. */
export async function applyHistoryIntroductionSettings(
  client: MemmyAgentClient,
  recording: boolean | undefined,
): Promise<ComputerHistorySnapshot> {
  let history = await client.getComputerHistory();
  if (recording === undefined) return history;
  const desired = recording ? "running" : "stopped";
  if (history.observation.state !== desired) {
    try {
      history = recording
        ? history.observation.state === "paused"
          ? await client.resumeComputerHistoryObservation()
          : await client.startComputerHistoryObservation()
        : await client.stopComputerHistoryObservation();
    } catch (cause) {
      history = await client.getComputerHistory();
      if (history.observation.state !== desired) throw cause;
    }
  }
  const confirmed = await client.getComputerHistory();
  if (confirmed.observation.state !== desired) {
    throw new Error(confirmed.observation.error || "Recording state did not match the requested setting.");
  }
  return confirmed;
}

export function ComputerHistoryIntroduction(props: {
  client: MemmyAgentClient;
  onClose(): void;
  onApplied(snapshot: ComputerHistorySnapshot): void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [initial, setInitial] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const close = useCallback(() => { if (!busyRef.current) onCloseRef.current(); }, []);
  const explainError = useCallback((cause: unknown) => {
    const value = cause instanceof Error ? cause.message : String(cause);
    if (value === "Recording state did not match the requested setting.") return t("historyIntro.stateMismatch");
    return /status (401|403)|Failed to fetch|NetworkError|fetch failed|network request failed/i.test(value)
      ? t("historyIntro.connectionUnavailable") : value;
  }, [t]);

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      alive.current = false;
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [close]);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(null);
    void props.client.getComputerHistory().then((history) => {
      if (!active) return;
      const enabled = history.observation.state === "running";
      setRecording(enabled);
      setInitial(enabled);
      setState(history.observation.state);
      setLoaded(true);
      if (history.observation.state === "failed") setError(history.observation.error || t("historyIntro.recordingFailed"));
    }).catch((cause: unknown) => { if (active) setError(explainError(cause)); });
    return () => { active = false; };
  }, [props.client, reload, t, explainError]);

  const apply = async () => {
    if (!loaded || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await applyHistoryIntroductionSettings(props.client, initial === recording ? undefined : recording);
      if (alive.current) props.onApplied(next);
    } catch (cause) {
      if (alive.current) setError(explainError(cause));
      try {
        const actual = await props.client.getComputerHistory();
        if (alive.current) { setInitial(actual.observation.state === "running"); setState(actual.observation.state); }
      } catch { /* Keep the selected setting and the original error for a later retry. */ }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const cta = busy ? "historyIntro.applying" : !loaded ? error ? "historyIntro.unavailable" : "historyIntro.loading"
    : initial === recording ? "historyIntro.understood" : recording ? "historyIntro.begin" : "historyIntro.save";

  return createPortal(
    <div className="chi-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialog} className="chi-dialog" role="dialog" aria-modal="true" aria-labelledby="chi-title" aria-describedby="chi-description" tabIndex={-1} onKeyDown={trapFocus}>
        <button className="chi-close" type="button" aria-label={t("historyIntro.close")} disabled={busy} onClick={close}><X size={21} /></button>
        <div className="chi-copy">
          <h2 id="chi-title">{t("historyIntro.title")}</h2>
          <p id="chi-description" className="chi-description">{t("historyIntro.description")}</p>
          <div className="chi-controls">
            <div className="chi-control">
              <span className="chi-control__icon chi-control__icon--history"><History size={18} /></span>
              <span><strong>{t("historyIntro.record")}</strong><small>{t(state === "paused" ? "historyIntro.recordPaused" : "historyIntro.recordDetail")}</small></span>
              <button className="chi-switch" role="switch" type="button" aria-checked={recording} aria-label={t("historyIntro.record")} disabled={!loaded || busy}
                onClick={() => setRecording((value) => !value)}><span /></button>
            </div>
          </div>
          {error ? <p className="chi-error" role="alert">{error}{!loaded ? <button type="button" onClick={() => setReload((value) => value + 1)}>{t("historyIntro.retryLoad")}</button> : null}</p> : null}
          <button className="chi-primary" type="button" disabled={!loaded || busy} onClick={() => void apply()}>{t(cta)}</button>
        </div>
        <div className="chi-visual" aria-label={t("historyIntro.diagramLabel")}>
          <div className="chi-orb chi-orb--one" /><div className="chi-orb chi-orb--two" />
          <HistoryExamples />
        </div>
      </section>
    </div>, document.body,
  );
}

const historyExamples = [
  { title: "historyIntro.publishTitle", question: "historyIntro.examplePublish", source: "historyIntro.publishSource", answer: "historyIntro.publishAnswer" },
  { title: "historyIntro.todosTitle", question: "historyIntro.exampleTodos", source: "historyIntro.todosSource", answer: "historyIntro.todosAnswer" },
  { title: "historyIntro.documentTitle", question: "historyIntro.exampleDocument", source: "historyIntro.documentSource", answer: "historyIntro.documentAnswer" },
] as const;

/** Illustrative content only. Browsing examples never queries activity or applies settings. */
function HistoryExamples() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const example = historyExamples[index] ?? historyExamples[0];
  const move = (direction: number) => setIndex((current) => (current + direction + historyExamples.length) % historyExamples.length);

  return (
    <div className="chi-examples" role="group" aria-label={t("historyIntro.diagramLabel")} onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>
      <div className="chi-demo" aria-live="polite" aria-atomic="true">
        <div className="chi-demo__header"><strong>{t(example.title)}</strong><span>{t("historyIntro.demo")}</span></div>
        <div className="chi-demo__conversation" key={index}>
          <p className="chi-demo__question">{t(example.question)}</p>
          <div className="chi-demo__lookup">
            <div><History size={14} aria-hidden="true" /><span>{t("historyIntro.lookup")}</span></div>
            <small>{t(example.source)}</small>
          </div>
          <p className="chi-demo__answer">{t(example.answer)}</p>
        </div>
        <div className="chi-demo__composer" role="img" aria-label={t("historyIntro.composerPreview")}>
          <div aria-hidden="true">
            <p>{t("home.input")}</p>
            <div className="chi-demo__toolbar">
              <span className="chi-demo__send"><Send size={13} /></span>
            </div>
          </div>
        </div>
      </div>
      <div className="chi-pagination">
        <button className="chi-pagination__arrow" type="button" aria-label={t("historyIntro.previousExample")} onClick={() => move(-1)}><ChevronLeft size={17} aria-hidden="true" /></button>
        <div className="chi-pagination__dots">
          {historyExamples.map((item, position) => (
            <button className="chi-pagination__dot" type="button" key={item.title} aria-label={t(item.title)} aria-current={index === position ? "true" : undefined} onClick={() => setIndex(position)}><span /></button>
          ))}
        </div>
        <button className="chi-pagination__arrow" type="button" aria-label={t("historyIntro.nextExample")} onClick={() => move(1)}><ChevronRight size={17} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, input:not(:disabled), [tabindex="0"]'));
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
}
