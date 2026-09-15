import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type KnowledgeBase,
  type KnowledgeFiles,
  type KnowledgeMember,
  type KnowledgeSettings,
} from "../types.js";

import {
  DOCUMENT_EXTENSIONS,
  uploadDocuments,
  type UploadResult,
} from "./upload.js";

export interface KnowledgePageProps {
  connection: { baseUrl: string; localToken: string };
  language?: string;
  onSignIn?: () => void;
}

type ViewKey = "all" | "mine" | "sharedByMe" | "sharedWithMe";
type DetailTab = "docs" | "share";

const ROW_TONES = [
  { icon: "📘", cls: "mk-tone-teal" },
  { icon: "📝", cls: "mk-tone-violet" },
  { icon: "📦", cls: "mk-tone-sand" },
  { icon: "🗂️", cls: "mk-tone-green" },
] as const;

function toneFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ROW_TONES[hash % ROW_TONES.length] ?? ROW_TONES[0];
}

function fileExtension(name: string) {
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return (ext || "file").toUpperCase().slice(0, 4);
}

function fileStatus(status: string, zh: boolean) {
  if (/available|可用|success|completed|done/i.test(status))
    return { cls: "mk-pill-ok", label: zh ? "可用" : "Ready" };
  if (/处理中|上传中|pending|running|processing|uploading/i.test(status))
    return { cls: "mk-pill-busy", label: zh ? "处理中" : "Processing" };
  if (/fail|error|失败|无效/i.test(status))
    return { cls: "mk-pill-fail", label: zh ? "失败" : "Failed" };
  return { cls: "", label: status };
}

function Switch({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`mk-switch${on ? " mk-switch-on" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!on);
      }}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export function KnowledgePage({
  connection,
  language = "zh",
  onSignIn,
}: KnowledgePageProps) {
  const zh = language.startsWith("zh");
  const t = (cn: string, en: string) => (zh ? cn : en);
  const [settings, setSettings] = useState<KnowledgeSettings | null>(null);
  const [name, setName] = useState("");
  const [activeId, setActiveId] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [query, setQuery] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("docs");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<KnowledgeMember | null>(null);
  const [fileDeleteTarget, setFileDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<KnowledgeFiles | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadNotice, setUploadNotice] = useState<{ baseId: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [shareUserId, setShareUserId] = useState("");
  const [members, setMembers] = useState<KnowledgeMember[]>([]);
  const api = useMemo(
    () =>
      async <T,>(
        path: string,
        method = "GET",
        body?: unknown,
        signal?: AbortSignal,
      ): Promise<T> => {
        const response = await fetch(
          new URL(`/api/knowledge${path}`, connection.baseUrl),
          {
            method,
            signal,
            headers: {
              "x-memmy-local-token": connection.localToken,
              ...(body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : `HTTP ${response.status}`,
          );
        return data as T;
      },
    [connection.baseUrl, connection.localToken],
  );
  const acceptSettings = useCallback((value: KnowledgeSettings) => {
    setSettings(value);
    setActiveId((current) =>
      value.bases.some((base) => base.id === current)
        ? current
        : (value.bases[0]?.id ?? ""),
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<KnowledgeSettings>(
      "/settings",
      "GET",
      undefined,
      controller.signal,
    )
      .then(acceptSettings)
      .catch((error) => {
        if (!controller.signal.aborted) { console.error("knowledge settings request failed", error); setError(zh ? "知识库暂时无法加载，请稍后重试。" : "Knowledge bases are temporarily unavailable. Please try again later."); }
      });
    return () => controller.abort();
  }, [api, acceptSettings]);
  useEffect(() => {
    setUploadResults([]);
    setUploadNotice(null);
    setDetailTab("docs");
    setMenuOpen(false);
    setDragOver(false);
  }, [activeId]);
  useEffect(() => {
    setMembers([]);
    if (!activeId || settings?.bases.find((base) => base.id === activeId)?.shared) return;
    void api<{ members: KnowledgeMember[] }>(`/bases/${encodeURIComponent(activeId)}/members`).then((value) => setMembers(value.members ?? [])).catch(() => setMembers([]));
  }, [activeId, settings, api]);
  useEffect(() => {
    setListing(null);
    if (!activeId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = async () => {
      try {
        const value = await api<KnowledgeFiles>(
          `/bases/${encodeURIComponent(activeId)}/files?page=${page}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setListing(value);
        // Refresh processing files and freshly uploaded files without resetting the management form.
        if (
          value.files.some((file) =>
            /处理中|上传中|pending|running|processing|uploading/i.test(
              file.status,
            ),
          ) ||
          (refresh > 0 && polls++ < 6)
        )
          timer = setTimeout(() => void load(), 5000);
      } catch (error) {
        if (!controller.signal.aborted) { console.error("knowledge files request failed", error); setError(zh ? "知识库文件暂时无法加载，请稍后重试。" : "Knowledge files are temporarily unavailable. Please try again later."); }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [activeId, page, api, refresh]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (error) {
      console.error("knowledge request failed", error);
      setError(zh ? "知识库服务暂时不可用，请稍后重试。" : "Knowledge service is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }
  async function save(patch: unknown) {
    acceptSettings(await api<KnowledgeSettings>("/settings", "PUT", patch));
  }
  function startUpload(files: File[], baseId: string) {
    if (!files.length) return;
    void run(async () => {
      setUploadResults([]);
      setUploadNotice(null);
      const results = await uploadDocuments(
        files,
        (file, content) =>
          api(`/bases/${encodeURIComponent(baseId)}/files`, "POST", {
            name: file.name,
            content,
          }),
        (completed, total, name) =>
          setUploadNotice({
            baseId,
            message: t(
              `正在上传 ${completed + 1}/${total}：${name}`,
              `Uploading ${completed + 1}/${total}: ${name}`,
            ),
          }),
        zh,
      );
      setUploadResults(results);
      const succeeded = results.filter((result) => result.ok).length;
      const failed = results.length - succeeded;
      setUploadNotice({
        baseId,
        message: t(
          `上传完成：成功 ${succeeded} 个，失败 ${failed} 个。${succeeded ? "云端处理完成后即可参与召回。" : ""}`,
          `Upload complete: ${succeeded} succeeded, ${failed} failed.${succeeded ? " Documents become searchable after cloud processing." : ""}`,
        ),
      });
      if (succeeded) {
        setPage(1);
        setRefresh((value) => value + 1);
      }
    });
  }
  function toggleBaseSelected(base: KnowledgeBase, on: boolean) {
    const ids = on
      ? [...selected, base.id]
      : selected.filter((id) => id !== base.id);
    void run(async () =>
      save({
        selectedIds: ids,
        ...(on && !settings?.enabled ? { enabled: true } : {}),
        ...(!ids.length ? { enabled: false } : {}),
      }),
    );
  }
  const active = settings?.bases.find((base) => base.id === activeId);
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const ownedBases = settings?.bases.filter((base) => !base.shared) ?? [];
  const maxBases = settings?.maxBases ?? 10;
  const sharedBases = settings?.bases.filter((base) => base.shared) ?? [];
  const sharedByMeBases = settings?.bases.filter((base) => Boolean(base.sharedByMe)) ?? [];
  const keyword = query.trim().toLowerCase();
  const visibleBases = (settings?.bases.filter((base) =>
    view === "sharedWithMe" ? Boolean(base.shared) : view === "sharedByMe" ? Boolean(base.sharedByMe) : view === "mine" ? !base.shared : true,
  ) ?? []).filter((base) => !keyword || base.name.toLowerCase().includes(keyword));
  const selected =
    settings?.bases.filter((base) => base.selected).map((base) => base.id) ??
    [];
  const viewTabs: Array<[ViewKey, string, number]> = [
    ["all", t("全部", "All"), settings?.bases.length ?? 0],
    ["mine", t("我的", "Mine"), ownedBases.length],
    ["sharedByMe", t("我分享的", "Shared by me"), sharedByMeBases.length],
    ["sharedWithMe", t("与我共享", "Shared with me"), sharedBases.length],
  ];
  return (
    <section className="memmy-knowledge">
      <style>{styles}</style>
      <div className="mk-library-content">
        <header className="mk-page-header">
          <div>
            <h1>{t("知识库", "Knowledge")}</h1>
            <p className="mk-page-sub">{t("上传资料，Memmy 会在对话中自动召回相关内容", "Upload documents and Memmy will recall them in conversations")}</p>
          </div>
          <div className="mk-header-actions">
            <span className="mk-quota" title={t("当前账户可创建的知识库数量", "Knowledge bases you can create")}>
              {settings ? (
                <>
                  {t("可创建知识库", "Knowledge bases")}
                  <b>{ownedBases.length} / {maxBases}</b>
                </>
              ) : ""}
            </span>
            <button type="button" className="mk-primary" disabled={!settings || ownedBases.length >= maxBases} onClick={() => setCreateOpen(true)}>{t("＋ 新建知识库", "＋ New knowledge base")}</button>
          </div>
        </header>
        {error && (
          <div className="mk-error" role="alert">
            {error}
            <button
              type="button"
              onClick={() => {
                setError("");
                setRefresh((value) => value + 1);
                void run(async () =>
                  acceptSettings(await api<KnowledgeSettings>("/settings")),
                );
              }}
            >
              {t("重试", "Retry")}
            </button>
          </div>
        )}
        {notice && (
          <p className="mk-notice" role="status">
            {notice}
          </p>
        )}
        {!settings ? (
          <p aria-live="polite" className="mk-loading">
            {t("正在读取知识库配置…", "Loading knowledge settings…")}
          </p>
        ) : (
          <fieldset aria-busy={busy}>
            {!settings.serviceAvailable && (
              <p className="mk-notice" role="status">
                {t(
                  settings.authenticated
                    ? "知识库服务暂未就绪，请稍后重试。"
                    : "登录 Memmy 后即可使用知识库，无需配置其他服务。",
                  settings.authenticated
                    ? "Knowledge service is not ready. Please try again later."
                    : "Sign in to Memmy to use knowledge. No additional service setup is needed.",
                )}
                {!settings.authenticated && onSignIn && (
                  <button type="button" onClick={onSignIn}>
                    {t("登录 Memmy", "Sign in to Memmy")}
                  </button>
                )}
              </p>
            )}
            <div className="mk-toolbar">
              <div className="mk-seg" role="tablist" aria-label={t("知识库分类", "Knowledge base categories")}>
                {viewTabs.map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    className={view === key ? "mk-seg-active" : ""}
                    onClick={() => setView(key)}
                  >
                    {label}
                    <span>{count}</span>
                  </button>
                ))}
              </div>
              <input
                className="mk-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("搜索知识库", "Search knowledge bases")}
                aria-label={t("搜索知识库", "Search knowledge bases")}
              />
            </div>
            <div className="mk-rows">
              {!settings.bases.length && (
                <div className="mk-empty">
                  {t(
                    "创建知识库，上传你希望 Memmy 使用的资料。",
                    "Create a knowledge base and upload documents for Memmy to use.",
                  )}
                </div>
              )}
              {settings.bases.length > 0 && !visibleBases.length && (
                <div className="mk-empty">
                  {t("没有匹配的知识库。", "No matching knowledge bases.")}
                </div>
              )}
              {visibleBases.map((base) => {
                const tone = toneFor(base.name);
                const memberCount = base.memberCount ?? 0;
                return (
                  <div
                    className={`mk-row${detailOpen && base.id === activeId ? " mk-row-active" : ""}`}
                    key={base.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveId(base.id);
                      setPage(1);
                      setDetailOpen(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveId(base.id);
                        setPage(1);
                        setDetailOpen(true);
                      }
                    }}
                  >
                    <span className={`mk-row-icon ${tone.cls}`} aria-hidden="true">{tone.icon}</span>
                    <div className="mk-row-meta">
                      <div className="mk-row-name">
                        {base.name}
                        {base.sharedByMe && (
                          <span className="mk-tag mk-tag-sharing">
                            {memberCount
                              ? t(`已共享 · ${memberCount}`, `Shared · ${memberCount}`)
                              : t("已共享", "Shared")}
                          </span>
                        )}
                        {base.shared && (
                          <span className="mk-tag mk-tag-shared">{t("与我共享", "Shared with me")}</span>
                        )}
                      </div>
                      <div className="mk-row-desc">
                        {base.shared
                          ? t(`来自 ${base.ownerName || "其他用户"}`, `From ${base.ownerName || "another user"}`)
                          : t("我创建", "Created by me")}
                      </div>
                    </div>
                    <span
                      className="mk-row-recall"
                      title={t("开启后，该知识库会参与 Agent 对话召回", "When on, this base participates in Agent recall")}
                    >
                      {t("参与召回", "Recall")}
                      <Switch
                        on={base.selected}
                        label={`${t("参与召回", "Use for recall")}: ${base.name}`}
                        onChange={(on) => toggleBaseSelected(base, on)}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <main className={`mk-detail-modal ${detailOpen ? "mk-detail-open" : "mk-detail-closed"}`} role="dialog" aria-modal="true" aria-label={active?.name}>
              {!active ? (
                <div className="mk-empty">
                  {t(
                    "选择知识库后，可上传文档并查看处理状态。",
                    "Select a knowledge base to upload documents and view processing status.",
                  )}
                </div>
              ) : (
                <>
                  <div className="mk-drawer-head">
                    <div className="mk-drawer-topbar">
                      <button type="button" className="mk-icon-btn" onClick={() => setDetailOpen(false)} aria-label={t("关闭", "Close")}>✕</button>
                      <div className="mk-drawer-tools">
                        <button
                          type="button"
                          className="mk-icon-btn"
                          onClick={() => setRefresh((value) => value + 1)}
                          aria-label={t("刷新", "Refresh")}
                          title={t("刷新", "Refresh")}
                        >↻</button>
                        {!active.shared && (
                          <div className="mk-menu-wrap" ref={menuRef}>
                            <button
                              type="button"
                              className="mk-icon-btn"
                              onClick={() => setMenuOpen((open) => !open)}
                              aria-label={t("更多操作", "More actions")}
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                            >⋯</button>
                            {menuOpen && (
                              <div className="mk-menu" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="mk-menu-danger"
                                  onClick={() => {
                                    setMenuOpen(false);
                                    setDeleteOpen(true);
                                  }}
                                >
                                  {t("删除知识库", "Delete knowledge base")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <h2>{active.name}</h2>
                    <p className="mk-drawer-meta">
                      {active.shared
                        ? t(`来自 ${active.ownerName || "其他用户"} 的共享 · 仅可查看和参与召回`, `Shared by ${active.ownerName || "another user"} · View and recall only`)
                        : activeMembers.length
                          ? t(`我创建 · 已共享给 ${activeMembers.length} 位用户`, `Created by me · Shared with ${activeMembers.length} ${activeMembers.length === 1 ? "user" : "users"}`)
                          : t("我创建 · 未共享", "Created by me · Not shared")}
                    </p>
                  </div>
                  <div className="mk-dtabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailTab === "docs"}
                      className={detailTab === "docs" ? "mk-dtab-active" : ""}
                      onClick={() => setDetailTab("docs")}
                    >
                      {t("文档", "Documents")}
                    </button>
                    {!active.shared && (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={detailTab === "share"}
                        className={detailTab === "share" ? "mk-dtab-active" : ""}
                        onClick={() => setDetailTab("share")}
                      >
                        {t("共享", "Sharing")}
                        {activeMembers.length > 0 && <span>{activeMembers.length}</span>}
                      </button>
                    )}
                  </div>
                  {detailTab === "docs" && (
                    <div className="mk-dpane">
                      {!active.shared && (
                        <div
                          className={`mk-drop${dragOver ? " mk-drop-over" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-label={t("上传文档", "Upload documents")}
                          onClick={() => uploadInput.current?.click()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              uploadInput.current?.click();
                            }
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                          }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDragOver(false);
                            startUpload(Array.from(event.dataTransfer.files), active.id);
                          }}
                        >
                          <input
                            ref={uploadInput}
                            type="file"
                            hidden
                            multiple
                            accept={DOCUMENT_EXTENSIONS}
                            aria-label={t("选择上传文件", "Select documents to upload")}
                            onChange={(event) => {
                              const files = Array.from(event.target.files ?? []);
                              event.target.value = "";
                              startUpload(files, active.id);
                            }}
                          />
                          <span className="mk-drop-ic" aria-hidden="true">⬆</span>
                          <div className="mk-drop-t">
                            {t("拖拽文件到此处，或", "Drag files here, or")}{" "}
                            <b>{t("选择文件", "choose files")}</b>
                          </div>
                          <div className="mk-drop-d">
                            {t(
                              "支持 PDF / Word / Markdown 等，每个文件最多 20 MB",
                              "PDF / Word / Markdown and more, up to 20 MB each",
                            )}
                          </div>
                        </div>
                      )}
                      {uploadNotice?.baseId === active.id && (
                        <p className="mk-notice" role="status">{uploadNotice.message}</p>
                      )}
                      {uploadResults.some((result) => !result.ok) && (
                        <ul
                          className="mk-upload-failures"
                          aria-label={t("上传失败的文件", "Failed uploads")}
                        >
                          {uploadResults
                            .filter((result) => !result.ok)
                            .map((result, index) => (
                              <li key={index}>
                                {result.name}：{result.error}
                              </li>
                            ))}
                        </ul>
                      )}
                      {!listing ? (
                        <p className="mk-loading">{t("正在读取文件…", "Loading files…")}</p>
                      ) : !listing.files.length ? (
                        <p className="mk-empty">
                          {t("还没有文档。", "No documents yet.")}
                        </p>
                      ) : (
                        <ul className="mk-files">
                          {listing.files.map((file) => {
                            const status = fileStatus(file.status, zh);
                            return (
                              <li key={file.id} className="mk-file">
                                <span className="mk-fic" aria-hidden="true">{fileExtension(file.name)}</span>
                                <div className="mk-file-meta">
                                  <strong>{file.name}</strong>
                                  {file.message && <small>{file.message}</small>}
                                </div>
                                <span className={`mk-pill ${status.cls}`}>{status.label}</span>
                                {!active.shared && (
                                  <button
                                    type="button"
                                    className="mk-file-del"
                                    onClick={() => setFileDeleteTarget({ id: file.id, name: file.name })}
                                  >
                                    {t("删除", "Delete")}
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {listing && listing.total > 0 && (
                        <div className="mk-pagination">
                          <span>
                            {t(
                              `共 ${listing.total} 个文件`,
                              `${listing.total} files`,
                            )}
                          </span>
                          <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage((value) => value - 1)}
                          >
                            {t("上一页", "Previous")}
                          </button>
                          <span>{page}</span>
                          <button
                            type="button"
                            disabled={page * 20 >= listing.total}
                            onClick={() => setPage((value) => value + 1)}
                          >
                            {t("下一页", "Next")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {detailTab === "share" && !active.shared && (
                    <div className="mk-dpane">
                      <p className="mk-share-hint">
                        {t(
                          "输入对方的 Memmy 用户 ID 即可共享此知识库；对方可在「账户」页面复制自己的 ID。被共享的用户可以查看文档并参与召回。",
                          "Share by entering the other person's Memmy user ID. They can copy it from the Account page. Shared users can view documents and use recall.",
                        )}
                      </p>
                      <form
                        className="mk-share-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const userId = shareUserId.trim();
                          if (!userId) return;
                          void run(async () => {
                            await api(`/bases/${encodeURIComponent(active.id)}/members`, "POST", { userId });
                            setShareUserId("");
                            const value = await api<{ members: KnowledgeMember[] }>(`/bases/${encodeURIComponent(active.id)}/members`);
                            setMembers(value.members ?? []);
                            acceptSettings(await api<KnowledgeSettings>("/settings"));
                            setNotice(t("共享成功，对方刷新后即可看到该知识库。", "Shared. The user will see it after refreshing."));
                          });
                        }}
                      >
                        <input
                          value={shareUserId}
                          onChange={(event) => setShareUserId(event.target.value)}
                          placeholder={t("输入用户 ID", "Enter user ID")}
                          aria-label={t("Memmy 用户 ID", "Memmy user ID")}
                          required
                        />
                        <button className="mk-primary" type="submit" disabled={!shareUserId.trim()}>
                          {t("添加", "Add")}
                        </button>
                      </form>
                      {activeMembers.length ? (
                        <ul className="mk-members">
                          {activeMembers.map((member) => (
                            <li key={member.userId}>
                              <span className="mk-member-avatar" aria-hidden="true">
                                {(member.name || "?").trim().charAt(0).toUpperCase()}
                              </span>
                              <div className="mk-member-meta">
                                <strong>{member.name}</strong>
                                <small>ID {member.userId}</small>
                              </div>
                              <button className="mk-member-revoke" type="button" onClick={() => setRevokeTarget(member)}>
                                {t("移除", "Remove")}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mk-share-empty">{t("暂未共享给其他用户。", "Not shared with anyone yet.")}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </main>
          </fieldset>
        )}
      </div>
      {settings && createOpen && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true"><button className="mk-modal-close" onClick={() => setCreateOpen(false)}>×</button><h2>{t("新建知识库", "New knowledge base")}</h2><p>{t("创建一个新的个人知识库。", "Create a personal knowledge base.")}</p><form onSubmit={(event) => { event.preventDefault(); void run(async () => { acceptSettings(await api<KnowledgeSettings>("/bases", "POST", { name })); setName(""); setCreateOpen(false); }); }}><label>{t("名称", "Name")}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required autoFocus /></label><div className="mk-modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>{t("取消", "Cancel")}</button><button className="mk-primary" type="submit" disabled={!settings.serviceAvailable}>{t("创建", "Create")}</button></div></form></div></div>}
      {revokeTarget && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-revoke-title"><button className="mk-modal-close" onClick={() => setRevokeTarget(null)}>×</button><h2 id="mk-revoke-title">{t("取消分享", "Unshare knowledge base")}</h2><p>{t(`确定取消与“${revokeTarget.name}（${revokeTarget.userId}）”的共享吗？对方刷新后将无法继续访问此知识库。`, `Unshare this knowledge base from “${revokeTarget.name} (${revokeTarget.userId})”? They will lose access after refreshing.`)}</p><div className="mk-modal-actions"><button type="button" onClick={() => setRevokeTarget(null)}>{t("取消", "Cancel")}</button><button className="mk-danger" type="button" onClick={() => { const target = revokeTarget; void run(async () => { await api(`/bases/${encodeURIComponent(active.id)}/members/${encodeURIComponent(target.userId)}`, "DELETE"); setMembers((current) => current.filter((item) => item.userId !== target.userId)); setRevokeTarget(null); acceptSettings(await api<KnowledgeSettings>("/settings")); setNotice(t("已取消分享。", "Sharing cancelled.")); }); }}>{t("确认取消分享", "Unshare")}</button></div></div></div>}
      {deleteOpen && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-delete-title"><button className="mk-modal-close" onClick={() => setDeleteOpen(false)}>×</button><h2 id="mk-delete-title">{t("删除知识库", "Delete knowledge base")}</h2><p>{t("彻底删除此知识库及全部文件？这会同时删除 MemOS 中的数据，删除后无法恢复。", "Permanently delete this knowledge base and all its files? This also deletes the data in MemOS and cannot be undone.")}</p><div className="mk-modal-actions"><button type="button" onClick={() => setDeleteOpen(false)}>{t("取消", "Cancel")}</button><button className="mk-danger" type="button" onClick={() => { const id = active.id; void run(async () => { acceptSettings(await api<KnowledgeSettings>(`/bases/${encodeURIComponent(id)}`, "DELETE")); setActiveId(""); setDetailOpen(false); setDeleteOpen(false); setPage(1); }); }}>{t("确认删除", "Delete")}</button></div></div></div>}
      {fileDeleteTarget && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-file-delete-title"><button className="mk-modal-close" onClick={() => setFileDeleteTarget(null)}>×</button><h2 id="mk-file-delete-title">{t("删除文件", "Delete file")}</h2><p>{t(`从云端删除“${fileDeleteTarget.name}”？此操作也会影响该知识库的其他使用方。`, `Delete “${fileDeleteTarget.name}” from the cloud? This also affects other users of this knowledge base.`)}</p><div className="mk-modal-actions"><button type="button" onClick={() => setFileDeleteTarget(null)}>{t("取消", "Cancel")}</button><button className="mk-danger" type="button" onClick={() => { const target = fileDeleteTarget; void run(async () => { await api(`/bases/${encodeURIComponent(active.id)}/files/${encodeURIComponent(target.id)}`, "DELETE", { page }); setFileDeleteTarget(null); setRefresh((value) => value + 1); }); }}>{t("确认删除", "Delete")}</button></div></div></div>}
    </section>
  );
}
const styles = `
.memmy-knowledge{display:block;min-height:100%;position:relative;color:#202a27;font-size:14px;width:100%;box-sizing:border-box}
.memmy-knowledge fieldset{border:0;padding:0;margin:0;min-width:0}
.memmy-knowledge p{margin:6px 0;line-height:1.65}
.memmy-knowledge button{border:1px solid #e2e8e6;border-radius:8px;padding:7px 12px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;font-size:13px}
.memmy-knowledge button:hover{background:#f4f8f7}
.memmy-knowledge button:disabled,.memmy-knowledge fieldset:disabled{opacity:.55;cursor:default}
.memmy-knowledge input{border:1px solid #dfe6e3;border-radius:9px;padding:9px 12px;background:#fff;color:inherit;min-width:0;box-sizing:border-box;font-size:13px}
.memmy-knowledge input:focus-visible{outline:none;border-color:#46b6a5;box-shadow:0 0 0 3px #46b6a522}
.memmy-knowledge :focus-visible{outline:2px solid #46b6a5;outline-offset:2px}
.memmy-knowledge .mk-primary{background:#46b6a5;color:#fff;border:0;border-radius:9px;padding:8px 16px;font-weight:500}
.memmy-knowledge .mk-primary:hover:not(:disabled){background:#3aa893}
.memmy-knowledge .mk-danger{background:#c05a55;color:#fff;border:0;border-radius:9px;padding:8px 16px}
.memmy-knowledge .mk-danger:hover{background:#a94c47}
.memmy-knowledge .mk-loading{padding:26px 0;text-align:center;color:#9aa5a1;font-size:13px}
.mk-library-content{min-width:0;padding:30px 40px 40px}
.mk-empty{padding:34px 0;text-align:center;color:#9aa5a1;font-size:13px;line-height:1.8}
.mk-error{padding:12px 16px;margin-top:16px;border:1px solid #ecc3c1;border-radius:10px;color:#b74b46;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fdf6f5;font-size:13px}
.mk-notice{padding:11px 14px;background:#eef6f4;border-radius:10px;font-size:13px;color:#3d6a60;margin-top:12px}

/* ---------- 页头 ---------- */
.mk-page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px}
.mk-page-header h1{font-size:23px;font-weight:650;margin:0}
.mk-page-sub{font-size:12px;color:#9aa5a1;margin-top:5px!important}
.mk-header-actions{display:flex;align-items:center;gap:14px;flex-shrink:0}
.mk-quota{font-size:12px;color:#9aa5a1;display:flex;align-items:center;gap:6px}
.mk-quota b{color:#64716d;font-weight:600;font-variant-numeric:tabular-nums}

/* ---------- 开关 ---------- */
.memmy-knowledge .mk-switch{position:relative;width:34px;height:20px;border-radius:20px;background:#d8dfdd;border:0;padding:0;transition:background .15s ease;flex-shrink:0}
.memmy-knowledge .mk-switch:hover{background:#cdd6d3}
.memmy-knowledge .mk-switch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease}
.memmy-knowledge .mk-switch-on{background:#46b6a5}
.memmy-knowledge .mk-switch-on:hover{background:#3aa893}
.memmy-knowledge .mk-switch-on span{transform:translateX(14px)}

/* ---------- 工具栏：分段筛选 + 搜索 ---------- */
.mk-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:24px 0 14px;flex-wrap:wrap}
.mk-seg{display:inline-flex;background:#eef2f1;border-radius:10px;padding:3px;gap:2px;flex-wrap:wrap}
.memmy-knowledge .mk-seg button{border:0;padding:6px 13px;border-radius:8px;font-size:13px;color:#64716d;background:transparent}
.memmy-knowledge .mk-seg button:hover{background:#e4eae8}
.mk-seg button span{font-size:11px;color:#9aa5a1;margin-left:5px}
.memmy-knowledge .mk-seg .mk-seg-active{background:#fff;color:#202a27;font-weight:600;box-shadow:0 1px 4px rgba(24,33,43,.1)}
.memmy-knowledge .mk-seg .mk-seg-active:hover{background:#fff}
.mk-seg .mk-seg-active span{color:#2d7f72}
.mk-search{width:210px;flex-shrink:0}

/* ---------- 知识库卡片行 ---------- */
.mk-rows{display:flex;flex-direction:column;gap:10px}
.mk-row{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #e7edeb;border-radius:13px;padding:14px 16px;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}
.mk-row:hover{border-color:#cfe3de;box-shadow:0 4px 16px rgba(24,33,43,.05)}
.mk-row-active{border-color:#46b6a5;box-shadow:0 0 0 3px rgba(70,182,165,.14)}
.mk-row-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.mk-tone-teal{background:#e6f4f1}.mk-tone-violet{background:#f0eefb}.mk-tone-sand{background:#f7f2e7}.mk-tone-green{background:#edf4ec}
.mk-row-meta{flex:1;min-width:0}
.mk-row-name{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;flex-wrap:wrap}
.mk-tag{font-size:11px;font-weight:500;padding:2px 8px;border-radius:20px;white-space:nowrap}
.mk-tag-sharing{background:#e6f4f1;color:#2d7f72}
.mk-tag-shared{background:#f0eefb;color:#6c63a6}
.mk-row-desc{margin-top:4px;font-size:12px;color:#9aa5a1}
.mk-row-recall{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;color:#9aa5a1;flex-shrink:0}

/* ---------- 详情抽屉 ---------- */
.mk-detail-closed{display:none}
.mk-detail-modal{position:absolute;right:0;top:0;width:min(620px,72%);height:100%;overflow:auto;background:#fff;border-left:1px solid #e7edeb;box-shadow:-18px 0 60px rgba(24,33,43,.1);z-index:20;padding-bottom:30px}
.mk-drawer-head{padding:20px 26px 0}
.mk-drawer-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.mk-drawer-tools{display:flex;gap:4px}
.memmy-knowledge .mk-icon-btn{width:36px;height:36px;min-width:36px;min-height:36px;box-sizing:border-box;border:0;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;color:#64716d;font-size:16px;line-height:1;padding:0;flex:0 0 auto}
.memmy-knowledge .mk-icon-btn:hover{background:#f2f6f5;color:#202a27}
.mk-menu-wrap{position:relative}
.mk-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;background:#fff;border:1px solid #e7edeb;border-radius:10px;box-shadow:0 10px 32px rgba(24,33,43,.14);padding:5px;min-width:150px}
.memmy-knowledge .mk-menu button{display:block;width:100%;border:0;border-radius:7px;padding:8px 12px;text-align:left;font-size:13px}
.memmy-knowledge .mk-menu .mk-menu-danger{color:#b74b46}
.memmy-knowledge .mk-menu .mk-menu-danger:hover{background:#faf0ef}
.mk-drawer-head h2{font-size:19px;font-weight:650;margin:0}
.mk-drawer-meta{font-size:12px;color:#9aa5a1;margin-top:6px!important}
.mk-dtabs{display:flex;gap:2px;margin:20px 26px 0;border-bottom:1px solid #e7edeb}
.memmy-knowledge .mk-dtabs button{border:0;border-bottom:2px solid transparent;border-radius:0;padding:9px 14px;font-size:13px;color:#64716d;margin-bottom:-1px;background:transparent}
.memmy-knowledge .mk-dtabs button:hover{color:#202a27;background:transparent}
.mk-dtabs button span{font-size:11px;color:#9aa5a1;margin-left:5px}
.memmy-knowledge .mk-dtabs .mk-dtab-active{color:#2d7f72;font-weight:600;border-bottom-color:#46b6a5}
.mk-dpane{padding:20px 26px 0}

/* ---------- 上传区 ---------- */
.mk-drop{border:1.5px dashed #cfe0dc;border-radius:12px;background:#fafcfc;padding:24px 20px;text-align:center;cursor:pointer;transition:border-color .15s ease,background .15s ease}
.mk-drop:hover,.mk-drop-over{border-color:#46b6a5;background:#f2faf8}
.mk-drop-ic{width:36px;height:36px;border-radius:10px;background:#e6f4f1;color:#2d7f72;display:inline-flex;align-items:center;justify-content:center;font-size:16px;margin-bottom:10px}
.mk-drop-t{font-size:13px;font-weight:500}
.mk-drop-t b{color:#2d7f72;font-weight:600}
.mk-drop-d{font-size:12px;color:#9aa5a1;margin-top:4px}
.mk-upload-failures{font-size:13px;color:#b74b46;overflow-wrap:anywhere;padding-left:20px}

/* ---------- 文件列表 ---------- */
.mk-files{list-style:none;padding:0;margin:16px 0 0}
.mk-file{display:flex;align-items:center;gap:12px;padding:11px 6px;border-radius:9px}
.mk-file:hover{background:#f7faf9}
.mk-file+.mk-file{border-top:1px solid #eff4f2}
.mk-fic{width:32px;height:32px;border-radius:8px;background:#f1f4f3;color:#64716d;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.mk-file-meta{flex:1;min-width:0}
.mk-file-meta strong{display:block;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-file-meta small{display:block;font-size:11px;color:#9aa5a1;margin-top:3px}
.mk-pill{font-size:11px;padding:2px 9px;border-radius:20px;white-space:nowrap;flex-shrink:0;background:#f1f4f3;color:#64716d}
.mk-pill-ok{background:#e6f4f1;color:#2d7f72}
.mk-pill-busy{background:#faf4e4;color:#b98a2f}
.mk-pill-fail{background:#faf0ef;color:#b74b46}
.memmy-knowledge .mk-file-del{opacity:0;border:0;color:#9aa5a1;font-size:12px;padding:5px 8px;border-radius:7px;flex-shrink:0}
.mk-file:hover .mk-file-del{opacity:1}
.memmy-knowledge .mk-file-del:hover{background:#faf0ef;color:#b74b46}
.mk-pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:16px;font-size:12px;color:#9aa5a1}
.mk-pagination>span:first-child{margin-right:auto}

/* ---------- 共享面板 ---------- */
.mk-share-hint{font-size:12px;color:#93a09c;line-height:1.7;margin:0 0 14px!important}
.mk-share-form{display:flex;gap:10px}
.mk-share-form input{flex:1}
.mk-share-form .mk-primary{flex-shrink:0;padding:8px 18px}
.mk-members{list-style:none;padding:0;margin:14px 0 0}
.mk-members li{display:flex;align-items:center;gap:12px;padding:11px 6px;border-radius:9px}
.mk-members li:hover{background:#f7faf9}
.mk-members li+li{border-top:1px solid #eff4f2}
.mk-member-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#5cbfae,#46b6a5);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0}
.mk-member-meta{min-width:0;flex:1}
.mk-member-meta strong,.mk-member-meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-member-meta strong{font-size:13px;font-weight:500}
.mk-member-meta small{font-size:11px;color:#93a09c;margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.memmy-knowledge .mk-member-revoke{border:0;background:transparent;font-size:12px;color:#9aa5a1;padding:5px 8px;border-radius:7px}
.memmy-knowledge .mk-member-revoke:hover{color:#b74b46;background:#faf0ef}
.mk-share-empty{font-size:12px;color:#9aa5a1;margin:14px 0 0!important}
@media(max-width:560px){.mk-share-form{flex-wrap:wrap}.mk-share-form .mk-primary{width:100%}}

/* ---------- 弹窗 ---------- */
.mk-modal-backdrop{position:fixed;inset:0;background:rgba(20,27,35,.16);z-index:40;display:grid;place-items:center}
.mk-action-modal{position:relative;width:390px;background:#fff;border:1px solid #e2e8e6;border-radius:14px;padding:25px;box-shadow:0 14px 45px rgba(24,33,43,.14)}
.mk-action-modal h2{font-size:17px;margin:0 0 8px}
.mk-action-modal p{font-size:12px;color:#64716d;margin-bottom:20px}
.mk-action-modal form{display:grid;gap:12px}
.mk-action-modal label{display:grid;gap:7px;font-size:13px}
.memmy-knowledge .mk-modal-close{position:absolute;right:15px;top:13px;border:0;font-size:22px;padding:0 4px;color:#9aa5a1;background:transparent}
.mk-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
@media(max-width:850px){.mk-library-content{padding:22px 16px}.mk-detail-modal{width:100%}}
`;
