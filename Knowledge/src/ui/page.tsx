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

/* ---------- 图标（线性，currentColor） ---------- */
function I({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
const IC = {
  plus: "M12 5v14M5 12h14",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM21 21l-4.8-4.8",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  recall:
    "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  upload:
    "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  folder:
    "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  note: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4",
  trash:
    "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  sort: "M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 5v14",
  close: "M18 6 6 18M6 6l12 12",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2zM12 7v6M9 10h6",
} as const;

/** 统一默认封面：浅青底 + 深青线性书本。 */
function Cover({ large }: { large?: boolean }) {
  return (
    <span className={large ? "mk-cover mk-cover-lg" : "mk-cover"} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          d="M5 3.5h9a2 2 0 0 1 2 2V18a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 18V3.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M5 15.5h11" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    </span>
  );
}

function fileExtension(name: string) {
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return (ext || "file").toUpperCase().slice(0, 4);
}

function fileStatus(status: string, zh: boolean) {
  if (/available|可用|success|completed|done/i.test(status))
    return { cls: "mk-dot-ok", label: zh ? "可召回" : "Ready" };
  if (/处理中|上传中|pending|running|processing|uploading/i.test(status))
    return { cls: "mk-dot-busy", label: zh ? "处理中" : "Processing" };
  if (/fail|error|失败|无效/i.test(status))
    return { cls: "mk-dot-fail", label: zh ? "失败" : "Failed" };
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
  const [kbQuery, setKbQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [sortByName, setSortByName] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
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
  const folderInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
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
    setMenuOpen(false);
    setAddMenuOpen(false);
    setDragOver(false);
    setFileQuery("");
    setSortByName(false);
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
    if (!menuOpen && !addMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuOpen && !menuRef.current?.contains(target)) setMenuOpen(false);
      if (addMenuOpen && !addMenuRef.current?.contains(target))
        setAddMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen, addMenuOpen]);
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (error) {
      console.error("knowledge request failed", error);
      // 服务端返回的是可读文案（如“不支持的文档格式…”），优先展示；网络类错误回退到通用提示
      const serverMessage =
        error instanceof Error &&
        error.message &&
        !/failed to fetch|network ?error|load failed|abort/i.test(error.message)
          ? error.message
          : "";
      setError(serverMessage || (zh ? "知识库服务暂时不可用，请稍后重试。" : "Knowledge service is temporarily unavailable. Please try again later."));
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
  const keyword = kbQuery.trim().toLowerCase();
  const matchKeyword = (base: KnowledgeBase) =>
    !keyword || base.name.toLowerCase().includes(keyword);
  const visibleOwned = ownedBases.filter(matchKeyword);
  const visibleShared = sharedBases.filter(matchKeyword);
  const selected =
    settings?.bases.filter((base) => base.selected).map((base) => base.id) ??
    [];
  const fileKeyword = fileQuery.trim().toLowerCase();
  const visibleFiles = (listing?.files ?? [])
    .filter((file) => !fileKeyword || file.name.toLowerCase().includes(fileKeyword))
    .slice()
    .sort((a, b) => (sortByName ? a.name.localeCompare(b.name, zh ? "zh" : "en") : 0));
  const quotaReached = ownedBases.length >= maxBases;

  function kbItem(base: KnowledgeBase) {
    return (
      <div
        className={`mk-kb${base.id === activeId ? " mk-kb-active" : ""}`}
        key={base.id}
        role="button"
        tabIndex={0}
        onClick={() => {
          setActiveId(base.id);
          setPage(1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setActiveId(base.id);
            setPage(1);
          }
        }}
      >
        <Cover />
        <div className="mk-kb-meta">
          <div className="mk-kb-name">{base.name}</div>
          {base.shared ? (
            <div className="mk-kb-sub">{t(`来自 ${base.ownerName || "其他用户"}`, `From ${base.ownerName || "another user"}`)}</div>
          ) : base.sharedByMe ? (
            <div className="mk-kb-sub">{t("已共享", "Shared")}</div>
          ) : null}
        </div>
        {base.selected && <span className="mk-recall-dot" title={t("已参与召回", "Used for recall")} />}
      </div>
    );
  }

  return (
    <section className="memmy-knowledge">
      <style>{styles}</style>

      {/* ============ 二级侧边栏 ============ */}
      <aside className="mk-side">
        <div className="mk-side-head">
          <h2>{t("知识库", "Knowledge")}</h2>
        </div>
        <button
          type="button"
          className="mk-new-btn"
          disabled={!settings || quotaReached}
          title={
            quotaReached
              ? t(`已达可创建上限（${ownedBases.length}/${maxBases}）`, `Limit reached (${ownedBases.length}/${maxBases})`)
              : t("新建知识库", "New knowledge base")
          }
          onClick={() => setCreateOpen(true)}
        >
          <I d={IC.plus} size={14} />
          {t("新建知识库", "New knowledge base")}
        </button>
        {settings && settings.bases.length > 3 && (
          <div className="mk-side-search">
            <I d={IC.search} size={13} />
            <input
              value={kbQuery}
              onChange={(event) => setKbQuery(event.target.value)}
              placeholder={t("搜索知识库", "Search bases")}
              aria-label={t("搜索知识库", "Search knowledge bases")}
            />
          </div>
        )}
        <div className="mk-side-scroll">
          {!settings ? (
            <p className="mk-side-loading" aria-live="polite">{t("加载中…", "Loading…")}</p>
          ) : (
            <>
              <div className="mk-group">
                <div className="mk-group-title">{t("个人知识库", "Personal")}</div>
                {visibleOwned.map(kbItem)}
                {!visibleOwned.length && (
                  <p className="mk-group-empty">{ownedBases.length ? t("没有匹配的知识库", "No matching bases") : t("还没有知识库", "No knowledge bases yet")}</p>
                )}
              </div>
              {visibleShared.length > 0 && (
                <div className="mk-group">
                  <div className="mk-group-title">{t("共享知识库", "Shared with me")}</div>
                  {visibleShared.map(kbItem)}
                </div>
              )}
            </>
          )}
        </div>
        {settings && (
          <footer className="mk-side-foot">
            <div className="mk-recall-row">
              <span className="mk-recall-label">
                <I d={IC.recall} size={13} />
                {t("知识库召回", "Knowledge recall")}
              </span>
              <Switch
                on={settings.enabled}
                disabled={!settings.serviceAvailable}
                label={t("知识库召回总开关", "Knowledge recall master switch")}
                onChange={(on) => void run(async () => save({ enabled: on }))}
              />
            </div>
            <div className="mk-recall-hint">
              {settings.enabled
                ? selected.length
                  ? t(`已选 ${selected.length} 个库 · 对话时 Agent 将检索并引用这些资料`, `${selected.length} selected · Agent will search and cite them in chats`)
                  : t("尚未选择知识库，进入知识库后开启「参与召回」", "No base selected. Turn on “Recall” inside a base")
                : t("开启后，Agent 将在对话中检索选中的知识库", "When on, Agent searches selected bases in chats")}
            </div>
          </footer>
        )}
      </aside>

      {/* ============ 主内容区 ============ */}
      <main className="mk-main">
        <fieldset aria-busy={busy}>
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
          ) : !settings.serviceAvailable ? (
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
          ) : !active ? (
            <div className="mk-empty-state">
              <div className="mk-illust">
                <I d={IC.book} size={44} />
              </div>
              <h3>{t("创建你的第一个知识库", "Create your first knowledge base")}</h3>
              <p>{t("上传资料后，Memmy 会在对话中检索并引用这些内容", "Upload documents and Memmy will search and cite them in chats")}</p>
              <button type="button" className="mk-primary" onClick={() => setCreateOpen(true)}>
                <I d={IC.plus} size={13} />
                {t("新建知识库", "New knowledge base")}
              </button>
            </div>
          ) : (
            <>
              {/* ---------- 知识库头部 ---------- */}
              <header className="mk-kbheader">
                <Cover large />
                <div className="mk-titleblock">
                  <h1>{active.name}</h1>
                  <div className="mk-meta">
                    {active.shared ? (
                      <>
                        <span>{t("共享知识库", "Shared knowledge base")}</span>
                        <span className="mk-meta-dot" />
                        <span>{t(`来自 ${active.ownerName || "其他用户"} · 仅可查看和参与召回`, `From ${active.ownerName || "another user"} · View and recall only`)}</span>
                      </>
                    ) : (
                      <>
                        <span>{t("个人知识库", "Personal knowledge base")}</span>
                        <span className="mk-meta-dot" />
                        <span>
                          {listing
                            ? t(`${listing.total} 个文件`, `${listing.total} files`)
                            : t("读取中…", "Loading…")}
                        </span>
                        {activeMembers.length > 0 && (
                          <>
                            <span className="mk-meta-dot" />
                            <span>{t(`已共享给 ${activeMembers.length} 位用户`, `Shared with ${activeMembers.length}`)}</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="mk-hactions">
                  <span className="mk-recall-inline" title={t("开启后，该知识库会参与 Agent 对话召回", "When on, this base participates in Agent recall")}>
                    {t("参与召回", "Recall")}
                    <Switch
                      on={active.selected}
                      disabled={!settings.serviceAvailable}
                      label={`${t("参与召回", "Use for recall")}: ${active.name}`}
                      onChange={(on) => toggleBaseSelected(active, on)}
                    />
                  </span>
                  {!active.shared && (
                    <div className="mk-menu-wrap" ref={menuRef}>
                      <button
                        type="button"
                        className="mk-icon-btn mk-icon-lg"
                        onClick={() => setMenuOpen((open) => !open)}
                        aria-label={t("更多操作", "More actions")}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <I d={IC.dots} size={17} />
                      </button>
                      {menuOpen && (
                        <div className="mk-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              setRenameName(active.name);
                              setRenameOpen(true);
                            }}
                          >
                            {t("重命名知识库", "Rename")}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpen(false);
                              setShareOpen(true);
                            }}
                          >
                            {t("共享管理", "Sharing")}
                            {activeMembers.length > 0 && <span className="mk-menu-count">{activeMembers.length}</span>}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="mk-menu-danger"
                            onClick={() => {
                              setMenuOpen(false);
                              setDeleteOpen(true);
                            }}
                          >
                            {t("删除知识库", "Delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {!active.shared && (
                    <div className="mk-menu-wrap" ref={addMenuRef}>
                      <button
                        type="button"
                        className="mk-primary"
                        onClick={() => setAddMenuOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={addMenuOpen}
                      >
                        <I d={IC.plus} size={13} />
                        {t("添加内容", "Add content")}
                      </button>
                      {addMenuOpen && (
                        <div className="mk-menu mk-addmenu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="mk-am-item"
                            onClick={() => {
                              setAddMenuOpen(false);
                              uploadInput.current?.click();
                            }}
                          >
                            <span className="mk-am-icon"><I d={IC.file} /></span>
                            <span>
                              <span className="mk-am-name">{t("本地文件", "Local files")}</span>
                              <span className="mk-am-sub">PDF / Word / Markdown {t("等", "etc.")}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="mk-am-item"
                            onClick={() => {
                              setAddMenuOpen(false);
                              folderInput.current?.click();
                            }}
                          >
                            <span className="mk-am-icon"><I d={IC.folder} /></span>
                            <span>
                              <span className="mk-am-name">{t("本地文件夹", "Folder")}</span>
                              <span className="mk-am-sub">{t("批量导入整个目录", "Import a whole folder")}</span>
                            </span>
                          </button>
                          <div className="mk-am-divider" />
                          {[
                            { icon: IC.link, label: t("网页链接", "Web link") },
                            { icon: IC.note, label: t("笔记", "Note") },
                            { icon: IC.mic, label: t("录音纪要", "Recording") },
                          ].map((item) => (
                            <div className="mk-am-item mk-am-disabled" aria-disabled="true" key={item.label}>
                              <span className="mk-am-icon"><I d={item.icon} /></span>
                              <span>
                                <span className="mk-am-name">{item.label}</span>
                              </span>
                              <span className="mk-am-soon">{t("后续", "Soon")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </header>
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
              <input
                ref={folderInput}
                type="file"
                hidden
                multiple
                aria-label={t("选择上传文件夹", "Select a folder to upload")}
                {...{ webkitdirectory: "" }}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  startUpload(files, active.id);
                }}
              />

              {/* ---------- 工具条 ---------- */}
              <div className="mk-toolbar">
                <div className="mk-count">
                  {t("内容", "Documents")}{" "}
                  <em>{listing ? `(${listing.total})` : ""}</em>
                </div>
                <div className="mk-spacer" />
                {uploadNotice?.baseId === active.id && (
                  <span className="mk-uploading" role="status">{uploadNotice.message}</span>
                )}
                <div className="mk-fsearch">
                  <I d={IC.search} size={13} />
                  <input
                    value={fileQuery}
                    onChange={(event) => setFileQuery(event.target.value)}
                    placeholder={t("搜索文件", "Search files")}
                    aria-label={t("搜索文件", "Search files")}
                  />
                </div>
                <button
                  type="button"
                  className={`mk-tool-btn${sortByName ? " mk-tool-on" : ""}`}
                  onClick={() => setSortByName((value) => !value)}
                  title={t("切换排序方式", "Toggle sort order")}
                >
                  <I d={IC.sort} size={13} />
                  {sortByName ? t("按名称", "By name") : t("默认排序", "Default")}
                </button>
              </div>
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

              {/* ---------- 文件区 ---------- */}
              <div
                className={`mk-body${dragOver ? " mk-body-drag" : ""}`}
                onDragOver={(event) => {
                  if (active.shared) return;
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  if (active.shared) return;
                  event.preventDefault();
                  setDragOver(false);
                  startUpload(Array.from(event.dataTransfer.files), active.id);
                }}
              >
                {!listing ? (
                  <p className="mk-loading">{t("正在读取文件…", "Loading files…")}</p>
                ) : !listing.files.length ? (
                  <div className="mk-empty-state">
                    <div className="mk-illust">
                      <I d={IC.book} size={44} />
                    </div>
                    <h3>{t("知识库还是空的", "This knowledge base is empty")}</h3>
                    <p>{t("添加文件后，Agent 即可在对话中检索并引用这些资料", "Add documents and Agent can search and cite them in chats")}</p>
                    {!active.shared && (
                      <button type="button" className="mk-primary mk-empty-cta" onClick={() => uploadInput.current?.click()}>
                        <I d={IC.upload} size={13} />
                        {t("上传文件", "Upload files")}
                      </button>
                    )}
                    <div className="mk-fmts">
                      <span>PDF</span><span>Word</span><span>Markdown</span><span>TXT</span><span>JSON</span><span>XML</span>
                    </div>
                    {!active.shared && (
                      <p className="mk-empty-limit">{t("可拖拽文件到此处上传，每个文件最多 20 MB", "Drag files here to upload, up to 20 MB each")}</p>
                    )}
                  </div>
                ) : visibleFiles.length === 0 ? (
                  <p className="mk-loading">{t("没有匹配的文件。", "No matching files.")}</p>
                ) : (
                  <ul className="mk-flist">
                    {visibleFiles.map((file) => {
                      const status = fileStatus(file.status, zh);
                      return (
                        <li key={file.id} className="mk-frow">
                          <span className="mk-fic" aria-hidden="true">{fileExtension(file.name)}</span>
                          <div className="mk-fmeta">
                            <div className="mk-fname">{file.name}</div>
                            {file.message && <div className="mk-fsub">{file.message}</div>}
                          </div>
                          <span className={`mk-fstatus ${status.cls}`}>
                            <span className="mk-sdot" />
                            {status.label}
                          </span>
                          {!active.shared && (
                            <button
                              type="button"
                              className="mk-icon-btn mk-fdel"
                              aria-label={t(`删除 ${file.name}`, `Delete ${file.name}`)}
                              onClick={() => setFileDeleteTarget({ id: file.id, name: file.name })}
                            >
                              <I d={IC.trash} size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {listing && listing.total > 20 && (
                  <div className="mk-pagination">
                    <span>
                      {t(`共 ${listing.total} 个文件`, `${listing.total} files`)}
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
            </>
          )}
        </fieldset>
      </main>

      {/* ============ 创建知识库（仅名称） ============ */}
      {settings && createOpen && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-create-title"><button className="mk-modal-close" aria-label={t("关闭", "Close")} onClick={() => setCreateOpen(false)}><I d={IC.close} size={14} /></button><h2 id="mk-create-title">{t("创建个人知识库", "New knowledge base")}</h2><form onSubmit={(event) => { event.preventDefault(); const value = name.trim(); if (!value) return; void run(async () => { const before = new Set((settings?.bases ?? []).map((base) => base.id)); const next = await api<KnowledgeSettings>("/bases", "POST", { name: value }); acceptSettings(next); const created = next.bases.find((base) => !before.has(base.id)); if (created) setActiveId(created.id); setName(""); setCreateOpen(false); }); }}><label>{t("名称", "Name")}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required autoFocus placeholder={t("请输入知识库名称", "Knowledge base name")} /></label><div className="mk-modal-actions"><button type="button" onClick={() => setCreateOpen(false)}>{t("取消", "Cancel")}</button><button className="mk-primary" type="submit" disabled={!name.trim() || !settings.serviceAvailable}>{t("确认创建", "Create")}</button></div></form></div></div>}
      {settings && renameOpen && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-rename-title"><button className="mk-modal-close" aria-label={t("关闭", "Close")} onClick={() => setRenameOpen(false)}><I d={IC.close} size={14} /></button><h2 id="mk-rename-title">{t("重命名知识库", "Rename knowledge base")}</h2><p>{t("新名称会同步给所有已共享的用户，对方刷新后即可看到。", "The new name syncs to everyone this base is shared with once they refresh.")}</p><form onSubmit={(event) => { event.preventDefault(); const value = renameName.trim(); if (!value || value === active.name) { setRenameOpen(false); return; } void run(async () => { acceptSettings(await api<KnowledgeSettings>(`/bases/${encodeURIComponent(active.id)}`, "PATCH", { name: value })); setRenameName(""); setRenameOpen(false); setNotice(t("已重命名，共享用户刷新后即可看到新名称。", "Renamed. Shared users will see the new name after refreshing.")); }); }}><label>{t("名称", "Name")}<input value={renameName} onChange={(event) => setRenameName(event.target.value)} maxLength={200} required autoFocus /></label><div className="mk-modal-actions"><button type="button" onClick={() => setRenameOpen(false)}>{t("取消", "Cancel")}</button><button className="mk-primary" type="submit" disabled={!renameName.trim() || renameName.trim() === active.name}>{t("保存", "Save")}</button></div></form></div></div>}
      {settings && shareOpen && active && !active.shared && <div className="mk-modal-backdrop"><div className="mk-action-modal mk-share-modal" role="dialog" aria-modal="true" aria-labelledby="mk-share-title"><button className="mk-modal-close" aria-label={t("关闭", "Close")} onClick={() => setShareOpen(false)}><I d={IC.close} size={14} /></button><h2 id="mk-share-title">{t("共享管理", "Sharing")}</h2><p className="mk-share-hint">{t("输入对方的 Memmy 用户 ID 即可共享此知识库；对方可在「账户」页面复制自己的 ID。被共享的用户可以查看文档并参与召回。", "Share by entering the other person's Memmy user ID. They can copy it from the Account page. Shared users can view documents and use recall.")}</p><form className="mk-share-form" onSubmit={(event) => { event.preventDefault(); const userId = shareUserId.trim(); if (!userId) return; void run(async () => { await api(`/bases/${encodeURIComponent(active.id)}/members`, "POST", { userId }); setShareUserId(""); const value = await api<{ members: KnowledgeMember[] }>(`/bases/${encodeURIComponent(active.id)}/members`); setMembers(value.members ?? []); acceptSettings(await api<KnowledgeSettings>("/settings")); setNotice(t("共享成功，对方刷新后即可看到该知识库。", "Shared. The user will see it after refreshing.")); }); }}><input value={shareUserId} onChange={(event) => setShareUserId(event.target.value)} placeholder={t("输入用户 ID", "Enter user ID")} aria-label={t("Memmy 用户 ID", "Memmy user ID")} required /><button className="mk-primary" type="submit" disabled={!shareUserId.trim()}>{t("添加", "Add")}</button></form>{activeMembers.length ? (<ul className="mk-members">{activeMembers.map((member) => (<li key={member.userId}><span className="mk-member-avatar" aria-hidden="true">{(member.name || "?").trim().charAt(0).toUpperCase()}</span><div className="mk-member-meta"><strong>{member.name}</strong><small>ID {member.userId}</small></div><button className="mk-member-revoke" type="button" onClick={() => setRevokeTarget(member)}>{t("移除", "Remove")}</button></li>))}</ul>) : (<p className="mk-share-empty">{t("暂未共享给其他用户。", "Not shared with anyone yet.")}</p>)}</div></div>}
      {revokeTarget && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-revoke-title"><button className="mk-modal-close" aria-label={t("关闭", "Close")} onClick={() => setRevokeTarget(null)}><I d={IC.close} size={14} /></button><h2 id="mk-revoke-title">{t("取消分享", "Unshare knowledge base")}</h2><p>{t(`确定取消与“${revokeTarget.name}（${revokeTarget.userId}）”的共享吗？对方刷新后将无法继续访问此知识库。`, `Unshare this knowledge base from “${revokeTarget.name} (${revokeTarget.userId})”? They will lose access after refreshing.`)}</p><div className="mk-modal-actions"><button type="button" onClick={() => setRevokeTarget(null)}>{t("取消", "Cancel")}</button><button className="mk-danger" type="button" onClick={() => { const target = revokeTarget; void run(async () => { await api(`/bases/${encodeURIComponent(active.id)}/members/${encodeURIComponent(target.userId)}`, "DELETE"); setMembers((current) => current.filter((item) => item.userId !== target.userId)); setRevokeTarget(null); acceptSettings(await api<KnowledgeSettings>("/settings")); setNotice(t("已取消分享。", "Sharing cancelled.")); }); }}>{t("确认取消分享", "Unshare")}</button></div></div></div>}
      {deleteOpen && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-delete-title"><button className="mk-modal-close" aria-label={t("关闭", "Close")} onClick={() => setDeleteOpen(false)}><I d={IC.close} size={14} /></button><h2 id="mk-delete-title">{t("删除知识库", "Delete knowledge base")}</h2><p>{t("彻底删除此知识库及全部文件？这会同时删除 MemOS 中的数据，删除后无法恢复。", "Permanently delete this knowledge base and all its files? This also deletes the data in MemOS and cannot be undone.")}</p><div className="mk-modal-actions"><button type="button" onClick={() => setDeleteOpen(false)}>{t("取消", "Cancel")}</button><button className="mk-danger" type="button" onClick={() => { const id = active.id; void run(async () => { acceptSettings(await api<KnowledgeSettings>(`/bases/${encodeURIComponent(id)}`, "DELETE")); setDeleteOpen(false); setPage(1); }); }}>{t("确认删除", "Delete")}</button></div></div></div>}
      {fileDeleteTarget && active && <div className="mk-modal-backdrop"><div className="mk-action-modal" role="dialog" aria-modal="true" aria-labelledby="mk-file-delete-title"><button className="mk-modal-close" aria-label={t("关闭", "Close")} onClick={() => setFileDeleteTarget(null)}><I d={IC.close} size={14} /></button><h2 id="mk-file-delete-title">{t("删除文件", "Delete file")}</h2><p>{t(`从云端删除“${fileDeleteTarget.name}”？此操作也会影响该知识库的其他使用方。`, `Delete “${fileDeleteTarget.name}” from the cloud? This also affects other users of this knowledge base.`)}</p><div className="mk-modal-actions"><button type="button" onClick={() => setFileDeleteTarget(null)}>{t("取消", "Cancel")}</button><button className="mk-danger" type="button" onClick={() => { const target = fileDeleteTarget; void run(async () => { await api(`/bases/${encodeURIComponent(active.id)}/files/${encodeURIComponent(target.id)}`, "DELETE", { page }); setFileDeleteTarget(null); setRefresh((value) => value + 1); }); }}>{t("确认删除", "Delete")}</button></div></div></div>}
    </section>
  );
}
const styles = `
/* ===== 简约主题：中性灰白 + 单一青绿主色 ===== */
.memmy-knowledge{--mk-accent:#2fb393;--mk-accent-hover:#25a082;--mk-accent-tint:#e6f4f0;--mk-accent-deep:#3d8570;--mk-side:#f7f9f8;--mk-line:#e9efed;--mk-line-strong:#dfe7e4;--mk-ink:#1b2a27;--mk-sub:#5f716d;--mk-ter:#9aa8a4;--mk-warn:#dfa04a;--mk-err:#e1707e;display:flex;height:100%;min-height:0;position:relative;color:var(--mk-ink);font-size:14px;width:100%;box-sizing:border-box;background:#fff}
.memmy-knowledge fieldset{border:0;padding:0;margin:0;min-width:0;display:contents}
.memmy-knowledge p{margin:6px 0;line-height:1.65}
.memmy-knowledge button{border:1px solid var(--mk-line-strong);border-radius:8px;padding:7px 12px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;font-size:13px;font-family:inherit}
.memmy-knowledge button:hover{background:#f4f7f6}
.memmy-knowledge button:disabled,.memmy-knowledge fieldset:disabled{opacity:.55;cursor:default}
.memmy-knowledge input{border:1px solid var(--mk-line-strong);border-radius:8px;padding:8px 12px;background:#fff;color:inherit;min-width:0;box-sizing:border-box;font-size:13px;font-family:inherit}
.memmy-knowledge input:focus-visible{outline:none;border-color:var(--mk-accent);box-shadow:0 0 0 3px rgba(47,179,147,.14)}
.memmy-knowledge :focus-visible{outline:2px solid var(--mk-accent);outline-offset:2px}
.memmy-knowledge .mk-primary{display:inline-flex;align-items:center;gap:6px;background:var(--mk-accent);color:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:700}
.memmy-knowledge .mk-primary:hover:not(:disabled){background:var(--mk-accent-hover)}
.memmy-knowledge .mk-danger{background:#c05a55;color:#fff;border:0;border-radius:8px;padding:8px 16px}
.memmy-knowledge .mk-danger:hover{background:#a94c47}
.memmy-knowledge .mk-loading{padding:40px 0;text-align:center;color:var(--mk-ter);font-size:13px}
.mk-error{padding:12px 16px;margin:16px 32px 0;border:1px solid #ecc3c1;border-radius:10px;color:#b74b46;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fdf6f5;font-size:13px}
.mk-notice{padding:11px 14px;background:var(--mk-accent-tint);border-radius:10px;font-size:13px;color:var(--mk-accent-deep);margin:16px 32px 0}

/* ---------- 开关 ---------- */
.memmy-knowledge .mk-switch{position:relative;width:32px;height:19px;border-radius:20px;background:#d5dfdc;border:0;padding:0;transition:background .15s ease;flex-shrink:0}
.memmy-knowledge .mk-switch:hover{background:#c8d4d0}
.memmy-knowledge .mk-switch span{position:absolute;top:2.5px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .15s ease}
.memmy-knowledge .mk-switch-on{background:var(--mk-accent)}
.memmy-knowledge .mk-switch-on:hover{background:var(--mk-accent-hover)}
.memmy-knowledge .mk-switch-on span{transform:translateX(12px)}

/* ---------- 图标按钮 / 封面 ---------- */
.memmy-knowledge .mk-icon-btn{width:26px;height:26px;min-width:26px;min-height:26px;box-sizing:border-box;border:0;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:var(--mk-ter);padding:0;flex:0 0 auto;background:transparent}
.memmy-knowledge .mk-icon-btn:hover{background:rgba(27,42,39,.05);color:var(--mk-ink)}
.memmy-knowledge .mk-icon-lg{width:30px;height:30px;min-width:30px;min-height:30px}
.mk-cover{border-radius:8px;background:var(--mk-accent-tint);color:var(--mk-accent-deep);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:26px;height:26px}
.mk-cover svg{width:15px;height:15px}
.mk-cover-lg{width:56px;height:56px;border-radius:14px}
.mk-cover-lg svg{width:28px;height:28px}

/* ---------- 二级侧边栏 ---------- */
.mk-side{width:244px;flex-shrink:0;background:var(--mk-side);border-right:1px solid var(--mk-line);display:flex;flex-direction:column;min-height:0;padding-top:var(--codex-toolbar-height,46px)}
.mk-side-head{display:flex;align-items:center;justify-content:space-between;padding:6px 14px 8px}
.mk-side-head h2{font-size:15px;font-weight:800;margin:0}
.memmy-knowledge .mk-new-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:calc(100% - 24px);margin:2px 12px 10px;padding:8px 12px;border:1px solid var(--mk-line-strong);border-radius:8px;background:#fff;font-size:13px;font-weight:700;color:var(--mk-sub)}
.memmy-knowledge .mk-new-btn:hover:not(:disabled){border-color:var(--mk-accent);color:var(--mk-accent-deep);background:var(--mk-accent-tint)}
.mk-side-search{display:flex;align-items:center;gap:6px;margin:2px 12px 8px;padding:5px 9px;background:#fff;border:1px solid var(--mk-line);border-radius:8px;color:var(--mk-ter)}
.mk-side-search input{border:0;padding:2px 0;font-size:12px;background:transparent}
.mk-side-search input:focus-visible{outline:none;box-shadow:none;border:0}
.mk-side-scroll{flex:1;overflow-y:auto;padding:0 8px 12px;min-height:0}
.mk-side-loading{padding:20px 10px;font-size:12px;color:var(--mk-ter)}
.mk-group{margin-top:6px}
.mk-group-title{padding:6px 10px;font-size:11.5px;font-weight:700;color:var(--mk-ter)}
.mk-group-empty{padding:8px 10px;font-size:12px;color:var(--mk-ter)}
.mk-kb{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;cursor:pointer;transition:background .15s ease}
.mk-kb:hover{background:rgba(27,42,39,.04)}
.mk-kb-active{background:var(--mk-accent-tint)}
.mk-kb-active .mk-kb-name{color:var(--mk-accent-deep)}
.mk-kb-meta{flex:1;min-width:0}
.mk-kb-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-kb-sub{font-size:11px;color:var(--mk-ter);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-recall-dot{width:5px;height:5px;border-radius:50%;background:var(--mk-accent);flex-shrink:0}
.mk-side-foot{padding:12px 16px 14px;border-top:1px solid var(--mk-line)}
.mk-recall-row{display:flex;align-items:center;justify-content:space-between}
.mk-recall-label{font-size:12.5px;font-weight:700;display:inline-flex;align-items:center;gap:7px;color:var(--mk-ink)}
.mk-recall-label svg{color:var(--mk-accent-deep)}
.mk-recall-hint{font-size:11px;color:var(--mk-ter);margin-top:5px;line-height:1.5}

/* ---------- 主内容区 ---------- */
.mk-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow-y:auto;padding-top:var(--codex-toolbar-height,46px)}
.mk-kbheader{display:flex;align-items:flex-start;gap:16px;padding:10px 32px 0;flex-wrap:wrap}
.mk-titleblock{flex:1;min-width:0}
.mk-titleblock h1{font-size:20px;font-weight:800;margin:0;letter-spacing:.01em}
.mk-meta{display:flex;align-items:center;gap:10px;margin-top:6px;font-size:12px;color:var(--mk-ter);font-weight:600;flex-wrap:wrap;row-gap:3px}
.mk-meta-dot{width:3px;height:3px;border-radius:50%;background:var(--mk-line-strong)}
.mk-hactions{display:flex;align-items:center;gap:12px;padding-top:6px}
.mk-recall-inline{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:var(--mk-sub)}
.mk-menu-wrap{position:relative}
.mk-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;background:#fff;border:1px solid var(--mk-line);border-radius:12px;box-shadow:0 16px 48px rgba(27,42,39,.14);padding:6px;min-width:170px}
.memmy-knowledge .mk-menu button{display:flex;align-items:center;width:100%;border:0;border-radius:8px;padding:8px 10px;text-align:left;font-size:13px;background:transparent}
.memmy-knowledge .mk-menu button:hover{background:#f4f7f6}
.mk-menu-count{margin-left:auto;font-size:11px;color:var(--mk-ter)}
.memmy-knowledge .mk-menu .mk-menu-danger{color:#c05a55}
.memmy-knowledge .mk-menu .mk-menu-danger:hover{background:#faf0ef}
.mk-addmenu{width:216px}
.memmy-knowledge .mk-am-item{gap:11px}
.mk-am-item .mk-am-icon{width:28px;height:28px;border-radius:7px;background:#f2f5f4;color:var(--mk-sub);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.mk-am-name{display:block;font-size:13px;font-weight:700}
.mk-am-sub{display:block;font-size:10.5px;color:var(--mk-ter);margin-top:1px}
.mk-am-soon{margin-left:auto;font-size:10px;font-weight:700;color:var(--mk-ter);background:rgba(27,42,39,.06);padding:2px 7px;border-radius:999px}
.mk-am-disabled{opacity:.55;cursor:default;display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:8px}
.mk-am-divider{height:1px;background:var(--mk-line);margin:5px 10px}

/* ---------- 工具条 ---------- */
.mk-toolbar{display:flex;align-items:center;gap:10px;padding:22px 32px 14px}
.mk-count{font-size:13px;font-weight:800}
.mk-count em{font-style:normal;color:var(--mk-ter);font-weight:700;margin-left:2px}
.mk-spacer{flex:1}
.mk-uploading{font-size:12px;color:var(--mk-accent-deep);font-weight:600}
.mk-fsearch{display:flex;align-items:center;gap:7px;background:#f6f8f8;border:1px solid transparent;border-radius:8px;padding:5px 11px;width:180px;color:var(--mk-ter)}
.mk-fsearch:focus-within{background:#fff;border-color:var(--mk-accent)}
.mk-fsearch input{border:0;background:transparent;padding:1px 0;font-size:12.5px;width:100%}
.mk-fsearch input:focus-visible{outline:none;box-shadow:none;border:0}
.memmy-knowledge .mk-tool-btn{display:inline-flex;align-items:center;gap:5px;border:0;padding:6px 9px;font-size:12px;font-weight:700;color:var(--mk-sub);background:transparent}
.memmy-knowledge .mk-tool-btn:hover{color:var(--mk-ink);background:rgba(27,42,39,.05)}
.memmy-knowledge .mk-tool-on{color:var(--mk-accent-deep);background:var(--mk-accent-tint)}
.mk-upload-failures{font-size:13px;color:#c05a55;overflow-wrap:anywhere;padding:0 32px 0 52px;margin:0}

/* ---------- 文件区 ---------- */
.mk-body{flex:1;padding:0 32px 28px;min-height:0}
.mk-body-drag .mk-flist,.mk-body-drag .mk-empty-state{outline:1.5px dashed var(--mk-accent);outline-offset:8px;border-radius:12px}
.mk-flist{list-style:none;padding:0;margin:0}
.mk-frow{display:flex;align-items:center;gap:13px;border:1px solid var(--mk-line);border-radius:10px;padding:12px 16px;margin-bottom:8px;transition:border-color .15s ease,box-shadow .15s ease}
.mk-frow:hover{border-color:var(--mk-line-strong);box-shadow:0 6px 20px rgba(27,42,39,.06)}
.mk-fic{width:36px;height:36px;border-radius:9px;background:#f2f5f4;color:#7d8d88;display:inline-flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;letter-spacing:.02em;flex-shrink:0}
.mk-fmeta{flex:1;min-width:0}
.mk-fname{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-fsub{font-size:11.5px;color:var(--mk-ter);font-weight:600;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-fstatus{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--mk-sub);flex-shrink:0}
.mk-sdot{width:6px;height:6px;border-radius:50%;background:var(--mk-line-strong)}
.mk-dot-ok .mk-sdot{background:var(--mk-accent)}
.mk-dot-busy .mk-sdot{background:var(--mk-warn);animation:mk-pulse 1.2s infinite}
.mk-dot-fail{color:var(--mk-err)}
.mk-dot-fail .mk-sdot{background:var(--mk-err)}
@keyframes mk-pulse{50%{opacity:.35}}
.memmy-knowledge .mk-fdel{opacity:0;transition:opacity .15s ease}
.mk-frow:hover .mk-fdel{opacity:1}
.memmy-knowledge .mk-fdel:hover{background:#faf0ef;color:#c05a55}
.mk-pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px;font-size:12px;color:var(--mk-ter)}
.mk-pagination>span:first-child{margin-right:auto}

/* ---------- 空状态 ---------- */
.mk-empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 32px;text-align:center}
.mk-illust{width:112px;height:112px;border-radius:26px;background:var(--mk-accent-tint);color:var(--mk-accent-deep);display:flex;align-items:center;justify-content:center;margin-bottom:22px;position:relative}
.mk-illust::after{content:"";position:absolute;inset:-11px;border-radius:34px;border:1.5px dashed rgba(47,179,147,.35)}
.mk-empty-state h3{font-size:16px;font-weight:800;margin:0 0 8px}
.mk-empty-state p{font-size:13px;color:var(--mk-ter);margin:0 0 20px}
.mk-empty-cta{margin-bottom:4px}
.mk-fmts{display:flex;gap:8px;margin-top:18px}
.mk-fmts span{font-size:11px;font-weight:700;color:var(--mk-sub);background:#f4f7f6;padding:4px 11px;border-radius:999px}
.mk-empty-limit{font-size:11.5px;color:var(--mk-ter);margin-top:14px!important}

/* ---------- 共享弹窗 ---------- */
.mk-share-modal{width:440px}
.mk-share-hint{font-size:12px;color:var(--mk-ter);line-height:1.7;margin:0 0 14px!important}
.mk-share-form{display:flex;gap:10px}
.mk-share-form input{flex:1}
.mk-share-form .mk-primary{flex-shrink:0;padding:8px 18px}
.mk-members{list-style:none;padding:0;margin:14px 0 0;max-height:260px;overflow-y:auto}
.mk-members li{display:flex;align-items:center;gap:12px;padding:10px 4px;border-radius:8px}
.mk-members li:hover{background:#f7faf9}
.mk-members li+li{border-top:1px solid var(--mk-line)}
.mk-member-avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#37b795,#1f8f74);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.mk-member-meta{min-width:0;flex:1}
.mk-member-meta strong,.mk-member-meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-member-meta strong{font-size:13px;font-weight:600}
.mk-member-meta small{font-size:11px;color:var(--mk-ter);margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.memmy-knowledge .mk-member-revoke{border:0;background:transparent;font-size:12px;color:var(--mk-ter);padding:5px 8px;border-radius:7px}
.memmy-knowledge .mk-member-revoke:hover{color:#c05a55;background:#faf0ef}
.mk-share-empty{font-size:12px;color:var(--mk-ter);margin:14px 0 0!important}
@media(max-width:560px){.mk-share-form{flex-wrap:wrap}.mk-share-form .mk-primary{width:100%}}

/* ---------- 弹窗 ---------- */
.mk-modal-backdrop{position:fixed;inset:0;background:rgba(27,42,39,.26);backdrop-filter:blur(2px);z-index:10002;display:grid;place-items:center}
.mk-action-modal{position:relative;width:400px;max-width:calc(100vw - 48px);background:#fff;border-radius:16px;padding:24px 26px 20px;box-shadow:0 16px 48px rgba(27,42,39,.18)}
.mk-action-modal h2{font-size:15.5px;font-weight:800;margin:0 0 16px}
.mk-action-modal>p{font-size:12.5px;color:var(--mk-sub);margin:0 0 18px;line-height:1.65}
.mk-action-modal form{display:grid;gap:12px}
.mk-action-modal label{display:grid;gap:7px;font-size:12.5px;font-weight:700}
.memmy-knowledge .mk-modal-close{position:absolute;right:14px;top:14px;border:0;padding:4px;color:var(--mk-ter);background:transparent;border-radius:7px;display:inline-flex}
.memmy-knowledge .mk-modal-close:hover{background:#f4f7f6;color:var(--mk-ink)}
.mk-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
@media(max-width:850px){.mk-side{width:210px}.mk-kbheader,.mk-toolbar,.mk-body{padding-left:20px;padding-right:20px}}
`;
