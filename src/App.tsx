import { OutboxNotices } from "./compose/OutboxNotices";
import type { LocalMailUndo, LocalMailActionResponse } from "../shared/local-mail-undo";
import { mailSearchScope, widenMailSearch } from "./mail-search-scope";
import { SearchToolbar } from "./shell/SearchToolbar";
import { useSavedViews, type SavedViewEdit } from "./saved-views";
import { mailNotice } from "../shared/notifications";
import { readNotifications, saveNotifications } from "./notifications";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { inboxTab, inboxTabs, type InboxTab } from "../shared/inbox-tabs";
import type { Commitment, SentCoverage } from "../shared/workspace";
import type { Draft, OutboxStatus, RendererMail as Mail, RendererState as State, StateResponse, BootstrapResponse } from "../shared/types";
import { emptyComposePreferences, type ComposePreferences } from "../shared/mail-features";
import { initialCompose } from "./compose/ComposePreferences";
import { replyRecipients } from "./compose/recipients";
import { ApiError, coalesceReload } from "./api";
import { applyAppearance, hexColor, readAppearance, resolveScheme, saveAppearance } from "./appearance";
import type { ThemePreview } from "./themes";
import { ComposePanel, sendCompose, type Compose } from "./compose/ComposePanel";
import { DraftList } from "./compose/DraftList";
import { DraftSession, type DraftProgress } from "./compose/draft-session";
import { ConnectDialog, ProviderChoices, type ImapProvider } from "./dialogs/ConnectDialog";
import { LabelForm } from "./dialogs/LabelForm";
import { ShortcutsDialog } from "./dialogs/ShortcutsDialog";
import { SnoozeMenu } from "./dialogs/SnoozeMenu";
import { TeachDialog } from "./dialogs/TeachDialog";
import { TrashDialog } from "./dialogs/TrashDialog";
import { CommandPalette, type PaletteCommand } from "./dialogs/CommandPalette";
import { interactionActions, interactionPlatform, matches, read as readInteraction, save as saveInteraction, shortcutLabel } from "./interaction";
import { InboxTabs } from "./mail/InboxTabs";
import { ListEmpty } from "./mail/ListEmpty";
import { MailActions } from "./mail/MailActions";
import { MailFilters, type PinnedScope } from "./mail/MailFilters";
import { BulkMailSelection } from "./mail/BulkMailSelection";
import { MailList } from "./mail/MailList";
import { ProviderSearch } from "./mail/ProviderSearch";
import { Workbench } from "./work/Workbench";
import { QuickTrack } from "./work/QuickTrack";
import { MeetingDialog } from "./work/EventPanel";
import { useWorkspace } from "./work/useWorkspace";
import { openCommitment } from "../shared/commitment-dates";
import { nextRegion, regionOf, regionOrder, type Region } from "./region-focus";
import { Reader, ReaderEmpty } from "./mail/Reader";
import { sidebarViews, tabName, viewNames, viewOrder, type View } from "./mail/format";
import { accountLabel, customLabels, textSizeShortcut, filterMail, matchesLabel, markMailRead } from "./mail-ui";
import { reuseMailState } from "./mail-state";
import { MailSearchApiContext, useMailSearch } from "./use-mail-search";
import { replySource, useMailBody } from "./mail-body";
import { useMailNavigation, rememberBrowserUpdateLocation, type MailLocation } from "./navigation";
import { collectPrivateNames, redactPrivateText } from "./privacy";
import { ContactsPage } from "./contacts/ContactsPage";
import { SettingsPage } from "./settings/SettingsPage";
import { PaneHeader, type Corner } from "./shell/PaneHeader";
import { Sidebar } from "./shell/Sidebar";
import { UpdateNotice } from "./shell/UpdateNotice";
import { BrowserUpdateNotice, type BrowserWrites } from "./shell/BrowserUpdateNotice";
import { ContextMenu, mailMenuRequest, type MenuAction } from "./ui/ContextMenu";
import { Dialog } from "./ui/Dialog";
import { MailPrivacy, PrivacyContext, Redact } from "./ui/Privacy";
import { drawsWindowControls, systemCaption } from "./ui/TrafficLights";
import { useMedia } from "./ui/useMedia";
import { CredentialFallbackNotice } from "./shell/CredentialFallbackNotice";
import { ToastStack, useToasts } from "./ui/Toasts";
import { ArrowLeft, ArrowRight, ChevronRight, Eye, EyeOff, Mail as MailIcon, Settings as SettingsIcon, SidebarIcon } from "./ui/icons";

// Direction the list pane enters from: tabs slide sideways, mail opens upward.
type Motion = "forward" | "back" | "open" | "close";

const empty: State = {
  accounts: [],
  messages: [],
  labels: [],
  rules: [],
  googleConfigured: false,
  googleClientId: null,
  jevConfigured: false,
  jevProvider: "typesafe",
  aiConfigured: false,
  lastSync: null,
  syncing: false,
};

export function App() {
  const [state, setState] = useState(empty);
  const [composeDraft, setComposeDraft] = useState<ComposePreferences>();
  const [composeSaving, setComposeSaving] = useState(false);
  const composeSaveLock = useRef(false);
  const navigation = useMailNavigation();
  const { page, settingsSection, view, tab, accountFilter, labelFilter, selectedId, query, opened, readFilter, relevanceFilter, sort } = navigation.location;
  const setSelectedId = (selectedId: string | null) =>
    navigation.update((current) => ({ ...current, selectedId }));
  const setOpened = (opened: boolean) =>
    navigation.update((current) => ({ ...current, opened }));
  const [interaction, setInteraction] = useState(readInteraction);
  const shortcut = (action: typeof interactionActions[number]["id"]) => shortcutLabel(interaction.shortcuts[action]);
  const [searching, setSearching] = useState(false);
  const settingsSearchPending = useRef(false);
  const settings = page === "settings";
  const [accountSettingsTarget, setAccountSettingsTarget] = useState<string>();
  const inlineWorkView = view === "actions" || view === "projects" || view === "calendar";
  const contactsView = view === "contacts";
  const workView = view === "actions" || view === "calendar" || view === "projects" || view === "agents";
  const nonMailView = workView || contactsView;
  const ViewIcon = settings ? SettingsIcon : sidebarViews.find((item) => item.view === view)?.Icon ?? MailIcon;
  const setSettings = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(settings) : next;
    navigate({ page: value ? "settings" : "mail" });
  };
  useEffect(() => {
    if (!settings && settingsSearchPending.current) {
      settingsSearchPending.current = false;
      searchRef.current?.focus();
    }
  }, [settings]);
  const setSettingsSection = (settingsSection: MailLocation["settingsSection"]) => navigate({ settingsSection });
  const setLabelFilter = (labelFilter: string) => navigation.update(current => ({ ...current, labelFilter }));
  const [labelMail, setLabelMail] = useState<Mail | null>(null);
  const [contextMenu, setContextMenu] = useState<ReturnType<typeof mailMenuRequest> | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const [connecting, setConnecting] = useState<ImapProvider | "choose" | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [replyContext, setReplyContext] = useState<Mail | undefined>();
  const afterCompose = useRef<
    { type: "visit"; patch: Partial<MailLocation>; search: boolean } |
    { type: "history"; direction: -1 | 1 } |
    { type: "new" | "connect" | "commands" | "filters" | "shortcuts" } | null
  >(null);
  const leaveCompose = (next: NonNullable<typeof afterCompose.current>) => runDraftAction(async session => {
    await session.flush();
    afterCompose.current = next;
    draftSession.current = null;
    setCompose(null);
  });

  const [draftProgress, setDraftProgress] = useState<DraftProgress>({ phase: "idle", message: "Draft saves on this device as you type." });
  const draftSession = useRef<DraftSession | null>(null);
  const composeGeneration = useRef(0);
  const forwardRequest = useRef<{ source: Mail; generation: number; valid: boolean } | null>(null);
  const draftLock = useRef(false);
  const draftAdmissionLock = useRef(false);
  const attachmentTask = useRef<Promise<void> | undefined>(undefined);
  const draftTask = useRef<Promise<void> | undefined>(undefined);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  useLayoutEffect(() => {
    const request = forwardRequest.current;
    if (request && (updateInstalling ||
      !state.accounts.some(account => account.id === request.source.accountId) ||
      !state.messages.some(mail => mail.id === request.source.id && mail.accountId === request.source.accountId && mail.remoteId === request.source.remoteId))) request.valid = false;
  });
  useEffect(() => () => { if (forwardRequest.current) forwardRequest.current.valid = false; }, []);
  const sendTask = useRef<Promise<void> | undefined>(undefined);
  const [quickSource, setQuickSource] = useState<string | null>(null);
  const [meetingMail, setMeetingMail] = useState<Mail | null>(null);
  const [trackingItem, setTrackingItem] = useState<Commitment | undefined>();
  const [trackingDraft, setTrackingDraft] = useState<Partial<Commitment> | undefined>();
  const [trackingSession, setTrackingSession] = useState(0);
  const [trackingSource, setTrackingSource] = useState<string | undefined>(undefined);
  const [teach, setTeach] = useState<Mail | null>(null);
  const [snooze, setSnooze] = useState<(ReturnType<typeof mailMenuRequest> & { mail: Mail }) | null>(null);
  const closeSnooze = useCallback(() => setSnooze(null), []);
  const showSnooze = (mail: Mail, event?: ReactMouseEvent<HTMLElement>) => {
    const anchor = event?.currentTarget || document.getElementById(`mail-${mail.id}`) || document.activeElement as HTMLElement;
    const bounds = anchor.getBoundingClientRect();
    setSnooze({ mail, mailId: mail.id, anchor,
      x: event?.detail ? event.clientX : bounds.left, y: event?.detail ? event.clientY : bounds.bottom });
  };
  const [trashMail, setTrashMail] = useState<Mail | null>(null);
  const gmailPrefix = useRef({ key: "", at: 0 });
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [workModal, setWorkModal] = useState(false);
  // The shared unload guard also protects an event form with unsaved changes.
  const [eventDirty, setEventDirty] = useState(false);
  useEffect(() => { if (updateInstalling) setPalette(false); }, [updateInstalling]);
  const [bulkBlocking, setBulkBlocking] = useState(false);
  const [savedViewEdit, setSavedViewEdit] = useState<SavedViewEdit | null>(null);
  const [reviewingUnsubscribe, setReviewingUnsubscribe] = useState(false);
  const [railSelect, setRailSelect] = useState<HTMLElement | null>(null);
  const [railActions, setRailActions] = useState<HTMLElement | null>(null);
  const toolbarBlocked = !!(savedViewEdit || reviewingUnsubscribe || bulkBlocking || scheduledOpen || teach || snooze || trashMail || shortcuts || labelMail || connecting || updateInstalling || settingsModal || workModal || quickSource || meetingMail);
  const navigationBlocked = settings || !!compose || toolbarBlocked;
  const navigate = (patch: Partial<MailLocation>, search = false) => {
    if (toolbarBlocked) return false;
    if (compose) { leaveCompose({ type: "visit", patch, search }); return false; }
    navigation.visit(patch, search);
    return true;
  };
  const travel = (direction: -1 | 1) => {
    if (toolbarBlocked || contextMenu || palette) return;
    if (compose) {
      if (direction === 1 && !navigation.canForward) return;
      leaveCompose({ type: "history", direction }); return;
    }
    const active = document.activeElement;
    const restoreFocus = active === document.body || active instanceof HTMLElement && !!active.closest(".row, .message");
    navigation.travel(direction, (target) => {
      const accountExists = target.accountFilter === "all" ||
        state.accounts.some((account) => account.id === target.accountFilter);
      const mailExists = state.messages.some((mail) => mail.id === target.selectedId &&
        state.accounts.some((account) => account.id === mail.accountId));
      const mail = state.messages.find((mail) => mail.id === target.selectedId);
      if (target.opened && mailExists && mail) markRead(mail);
      if (restoreFocus && target.opened !== opened) {
        readerFocusPending.current = target.opened && mailExists;
        listFocusPending.current = !target.opened && opened;
      }
      setSearching(!!target.query);
      return { ...target, accountFilter: accountExists ? target.accountFilter : "all",
        selectedId: mailExists ? target.selectedId : null, opened: target.opened && mailExists };
    });
  };
  useEffect(() => {
    const native = !!window.desktop?.onNavigation &&
      ["win32", "linux"].includes(window.desktop.platform);
    const unsubscribe = native ? window.desktop?.onNavigation((direction) =>
      interaction.mouseHistory && travel(direction === "back" ? -1 : 1)) : undefined;
    const mouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      const element = event.target instanceof Element ? event.target : null;
      const guarded = element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"], [data-update-command], .update-notice, .credential-fallback-notice');
      const composeTarget = element?.closest(".compose-dialog") && !element.closest('select, [role="menu"]');
      if (interaction.mouseHistory && !native && (!guarded || composeTarget) && event.type === "mouseup") travel(event.button === 3 ? -1 : 1);
    };
    window.addEventListener("mousedown", mouse, true);
    window.addEventListener("mouseup", mouse, true);
    window.addEventListener("auxclick", mouse, true);
    return () => {
      unsubscribe?.();
      window.removeEventListener("mousedown", mouse, true);
      window.removeEventListener("mouseup", mouse, true);
      window.removeEventListener("auxclick", mouse, true);
    };
  });
  const [motion, setMotion] = useState<Motion>("forward");
  // Privacy blurs email addresses; re-enabling it hides revealed ones again.
  const [privacy, setPrivacy] = useState(
    () => localStorage.getItem("privacy") === "on",
  );
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  // Clicking an address toggles just that one; the eye hides every revealed one.
  const toggleAddress = useCallback((address: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (!next.delete(address)) next.add(address);
      return next;
    }), []);
  const togglePrivacy = () => {
    // Revoke native detail notices before enabling masking in the renderer.
    void window.desktop?.notifications?.configure(notifications, !privacy).catch(() => setNotice("Desktop notification privacy could not be confirmed."));
    localStorage.setItem("privacy", privacy ? "off" : "on");
    if (!privacy) setRevealed(new Set());
    setPrivacy(!privacy);
  };
  const [maximized, setMaximized] = useState(false);
  useEffect(() => window.desktop?.onWindowState(setMaximized), []);
  const [windowSide, setWindowSide] = useState<"left" | "right">(() =>
    localStorage.getItem("window-controls") === "right" ? "right" : "left",
  );
  const placeWindowControls = (side: "left" | "right") => {
    localStorage.setItem("window-controls", side);
    setWindowSide(side);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const readerFocusPending = useRef(false);
  const listFocusPending = useRef(false);
  // The sidebar stays open or closed between launches.
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("sidebar") !== "closed");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toggleSidebar = () => {
    if (!roomy) { setMobileSidebarOpen(value => !value); return; }
    localStorage.setItem("sidebar", sidebarOpen ? "closed" : "open");
    setSidebarOpen(!sidebarOpen);
  };
  // The Filters popover; its button stays lit while a filter or sort differs from its default.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [appearance, setAppearance] = useState(readAppearance);
  const [themePreview, setThemePreview] = useState<ThemePreview | null>(null);
  const prefersLight = useMedia("(prefers-color-scheme: light)", false);
  const scheme = resolveScheme(appearance.mode, prefersLight);
  useLayoutEffect(() => {
    applyAppearance(appearance, scheme, document.documentElement, themePreview);
    // System caption buttons take the pane surface and text color beneath them.
    if (!systemCaption) return;
    const tokens = window.getComputedStyle(document.documentElement);
    const color = hexColor(tokens.getPropertyValue("--surface"));
    const symbolColor = hexColor(tokens.getPropertyValue("--text"));
    if (color && symbolColor) window.desktop?.setOverlay?.({ color, symbolColor });
  }, [appearance, scheme, themePreview]);
  // Panes that need room drop out as the window narrows: the sender panel, then
  // the reader beside the list (mail then opens in place), then the sidebar.
  const roomy = useMedia("(min-width: 760px)");
  const splitRoom = useMedia("(min-width: 980px)");
  const split = appearance.reading === "split" && splitRoom;
  const sidebarShown = roomy ? sidebarOpen : mobileSidebarOpen;
  const fromSidebar = (action: () => unknown) => { action(); setMobileSidebarOpen(false); };
  useEffect(() => {
    if (roomy) { setMobileSidebarOpen(false); return; }
    if (!mobileSidebarOpen) return;
    document.querySelector<HTMLButtonElement>("#sidebar .sidebar-head button")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      setMobileSidebarOpen(false);
      requestAnimationFrame(() => document.getElementById("sidebar-toggle")?.focus());
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [roomy, mobileSidebarOpen]);
  const [textScale, setTextScale] = useState(() => {
    const value = Number(localStorage.getItem("emc2.text-scale"));
    return Number.isFinite(value) && value >= 0.8 && value <= 1.5 ? value : 1;
  });
  const [density, setDensity] = useState<"comfortable" | "compact">(
    () => { try { return localStorage.getItem("emc2.density") === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; } },
  );
  const storedDensity = useRef(density);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notifications, setNotifications] = useState(readNotifications);
  const { toasts, push: pushToast, dismiss: dismissToast, consumeUndo } = useToasts(notifications);
  const [lastUndo, setLastUndo] = useState<LocalMailUndo | null>(null);
  const undoLock = useRef(false);
  const setNotice = useCallback((text: string) => { if (text) pushToast(text, "error"); }, [pushToast]);
  const [outboxRefresh, setOutboxRefresh] = useState(0);
  const outboxNotice = useCallback((text: string, kind: "info" | "error" = "info") => pushToast(text, kind), [pushToast]);
  useEffect(() => {
    // Persist explicit changes only; startup must not write device storage.
    if (storedDensity.current === density) return;
    storedDensity.current = density;
    try { localStorage.setItem("emc2.density", density); }
    catch { setNotice("Density could not be saved on this device."); }
  }, [density, setNotice]);
  const arrivals = useRef<number | undefined>(undefined);
  const [notificationTargets, setNotificationTargets] = useState<string[]>([]);
  useEffect(() => {
    void window.desktop?.notifications?.configure(notifications, privacy).then((saved) => {
      if (!saved) setNotice("Desktop notification settings could not be saved on this device.");
    }).catch(() => setNotice("Desktop notification settings are unavailable."));
  }, [notifications, privacy, setNotice]);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [mailLoadError, setMailLoadError] = useState("");
  const startupLoad = useRef<AbortController | undefined>(undefined);
  const csrf = useRef("");
  const pendingReads = useRef(new Set<string>());
  const [reading, setReading] = useState(new Set<string>());
  const trashLock = useRef(false);
  const loadRevision = useRef(0);
  const mailCursor = useRef<string | undefined>(undefined);
  const syncLock = useRef(false);
  const sendLock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const browserWrites = useRef<BrowserWrites>({ pending: 0, uncertain: false });
  const [, setWriteRevision] = useState(0);
  const api = useCallback(
    async <T,>(url: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> => {
      const writing = !["GET", "HEAD"].includes(method.toUpperCase());
      if (writing) { browserWrites.current.pending++; setWriteRevision(value => value + 1); }
      try {
        const res = await fetch(`/api${url}`, {
          method,
          signal,
          headers: {
            "Content-Type": body instanceof Blob ? "application/octet-stream" : "application/json",
            "X-CSRF-Token": csrf.current,
          },
          body: body instanceof Blob ? body : body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 401 && !window.desktop) window.dispatchEvent(new Event("emc2-browser-locked"));
        const data = (await res.json()) as T & { error?: string; state?: string; sendUnknown?: boolean; results?: { status?: string }[] };
        if (writing && (data?.state === "unknown" || data?.sendUnknown === true ||
          Array.isArray(data?.results) && data.results.some(result => result?.status === "unknown"))) browserWrites.current.uncertain = true;
        if (!res.ok) throw new ApiError(res.status, data.error || "Request failed. Try again.");
        return data;
      } catch (error) {
        // An interrupted write can have succeeded on the host. Never reload or replay it automatically.
        if (writing && (!(error instanceof ApiError) || error.status >= 500)) browserWrites.current.uncertain = true;
        throw error;
      } finally {
        if (writing) { browserWrites.current.pending--; setWriteRevision(value => value + 1); }
      }
    },
    [],
  );
  const work = useWorkspace(api, ready);
  const dueCount = ready && work.loaded && !work.stale && !work.refreshing ? work.workspace.commitments.filter((item) =>
    (accountFilter === "all" || item.accountId === accountFilter) && openCommitment(item) && item.followUpAt !== undefined && item.followUpAt <= work.now).length : undefined;
  const openCompose = (value: Compose | Draft, source?: Mail) => {
    composeGeneration.current++;
    setReplyContext(source);
    const session = new DraftSession(api, value, (progress) => {
      if (draftSession.current === session) {
        setDraftProgress(progress);
        setCompose(session.content);
      }
    });
    draftSession.current = session;
    setCompose(session.content);
    setDraftProgress({ phase: "idle", message: "Draft saves on this device as you type." });
    session.change(session.content);
  };
  const editCompose = (value: Compose) => {
    const session = draftSession.current;
    if (!session || sendLock.current || draftLock.current || updateInstalling) return;
    if (value.accountId !== session.content.accountId) {
      if (session.dirty) return;
      if (session.stored && !confirm("Keep the existing draft and start a copy from the selected account?")) return;
      openCompose(value);
    } else {
      session.change(value);
      setCompose(session.content);
    }
  };
  const runDraftAction = (task: (session: DraftSession) => Promise<void>) => {
    const session = draftSession.current;
    if (!session || busy || sendLock.current || draftAdmissionLock.current || updateInstalling) return;
    draftAdmissionLock.current = true;
    setBusy(true);
    draftTask.current = Promise.resolve(attachmentTask.current).then(() => {
      // Admit the current FileReader completion before freezing draft edits.
      draftLock.current = true;
      return task(session);
    }).catch(() => {
      setNotice("Draft action could not be confirmed. Your text is still open. Check the draft save status before closing.");
    }).finally(() => { draftAdmissionLock.current = false; draftLock.current = false; setBusy(false); });
  };
  const closeCompose = () => runDraftAction(async (session) => {
    await session.flush();
    draftSession.current = null;
    setCompose(null);
  });
  const reload = useMemo(() => coalesceReload(async () => {
    const revision = ++loadRevision.current;
    const signal = startupLoad.current?.signal;
    setMailLoadError("");
    let data: StateResponse;
    try {
      data = await api<StateResponse>(mailCursor.current ? `/state?mailCursor=${encodeURIComponent(mailCursor.current)}` : "/state", "GET", undefined, signal);
    } catch (error) {
      if (!signal?.aborted) {
        setMailLoadError("Cached mail could not be loaded. Retry to check your mail.");
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          csrf.current = ""; mailCursor.current = undefined; arrivals.current = undefined;
          setReady(false); setLoaded(false); setState(empty);
        }
      }
      throw error;
    }
    if (signal?.aborted || revision !== loadRevision.current) return data;
    csrf.current = data.csrf;
    if (data.unreadArrivals !== undefined) {
      if (arrivals.current !== undefined && data.unreadArrivals > arrivals.current) {
        const accepted = (data.mailArrivals || []).filter((arrival) => arrival.sequence > arrivals.current! && arrival.sequence <= data.unreadArrivals!);
        const count = data.unreadArrivals - arrivals.current - accepted.length;
        if (count > 0) pushToast(`${count} new unread ${count === 1 ? "email" : "emails"}.`, "info", `arrival:${data.unreadArrivals}:summary`);
        for (const arrival of accepted) pushToast("1 new unread email.", "info", `arrival:${arrival.sequence}`, arrival.mail);
      }
      arrivals.current = data.unreadArrivals;
    }
    mailCursor.current = data.mailCursor;
    setState((current) => reuseMailState(current, data));
    setComposeDraft((current) => {
      if (!current) return current;
      const signatures = Object.entries(current.signatures).filter(([id]) => data.accounts.some(account => account.id === id));
      return signatures.length === Object.keys(current.signatures).length ? current : { ...current, signatures: Object.fromEntries(signatures) };
    });
    setSyncing(data.syncing || syncLock.current);
    if (signal && startupLoad.current?.signal === signal) startupLoad.current = undefined;
    setLoaded(true);
    setReady(true);
    return data;
  }), [api, pushToast]);
  const sync = useCallback(async () => {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      const result = await api<{ errors: string[] }>("/sync", "POST");
      if (result.errors.length) setNotice(result.errors.join("\n"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      syncLock.current = false;
      try { await reload(); }
      catch (error) {
        setSyncing(false);
        setNotice(error instanceof Error ? error.message : "Sync failed.");
      }
    }
  }, [api, reload]);
  useEffect(() => {
    if (!syncing || window.desktop?.onMailChanged) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await reload(); }
      catch (error) { if (!stopped) setNotice(error instanceof Error ? error.message : "Sync failed."); }
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [syncing, reload]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("error")) {
      setNotice(params.get("error")!);
      setSettings(true);
    }
    if (params.has("connected") || params.has("error"))
      history.replaceState({}, "", "/");
    const controller = new AbortController();
    startupLoad.current = controller;
    let complete = false;
    // Status and the full snapshot start together. Bootstrap never supplies mail
    // or a cursor, and a late result cannot overwrite a completed mail read.
    void api<BootstrapResponse>("/bootstrap", "GET", undefined, controller.signal).then((status) => {
      if (controller.signal.aborted || complete || mailCursor.current) return;
      if (!Array.isArray(status.accounts) || !Array.isArray(status.labels) || !Array.isArray(status.rules) || typeof status.csrf !== "string" || "messages" in status || "mailCursor" in status) return;
      csrf.current = status.csrf;
      setState(current => ({ ...current, ...status }));
      setReady(true);
    }).catch(() => { /* Older services and bootstrap failures use the full snapshot. */ });
    void reload()
      .then((data) => {
        complete = true;
        if (!controller.signal.aborted && data.accounts.length && !params.has("connected")) void sync();
      })
      .catch((error) => { complete = true; if (!controller.signal.aborted) setNotice(error.message); });
    return () => { complete = true; controller.abort(); ++loadRevision.current; };
  }, [api, reload, sync]);
  useEffect(() => {
    if (window.desktop) return;
    let disposed = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void reload().catch((error: unknown) => {
        if (!disposed) setNotice(error instanceof Error ? error.message : "Inbox refresh failed. Try again.");
      });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload, setNotice]);
  useEffect(() => {
    if (window.desktop || !loaded || !state.accounts.length) return;
    const timer = setInterval(() => void sync(), 300000);
    return () => clearInterval(timer);
  }, [loaded, state.accounts.length, sync]);
  useEffect(
    () =>
      window.desktop?.onAccountConnected((error) => {
        if (error) setNotice(error);
        else {
          setConnecting(current => current === "choose" ? null : current);
          void reload()
            .catch((error) => setNotice(error.message));
        }
      }),
    [reload],
  );
  useEffect(
    () =>
      window.desktop?.onMailChanged(() => {
        void reload().catch((error) => setNotice(error.message));
      }),
    [reload],
  );
  useEffect(() => window.desktop?.updates?.onDrain(async () => {
    await sendTask.current;
    await draftTask.current;
    await attachmentTask.current;
    await draftSession.current?.flush();
    // Let the send result update the draft/unload guard before native close.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }), []);
  useEffect(() => {
    if (compose || !afterCompose.current) return;
    const next = afterCompose.current;
    afterCompose.current = null;
    if (next.type === "visit") { navigation.visit(next.patch, next.search); setSearching(!!next.patch.query); }
    else if (next.type === "history") travel(next.direction);
    else if (next.type === "new") startCompose();
    else if (next.type === "connect") setConnecting("choose");
    else if (next.type === "commands") setPalette(true);
    else if (next.type === "filters") setFiltersOpen(true);
    else if (next.type === "shortcuts") setShortcuts(true);
  });
  const showSearch = () => {
    if (toolbarBlocked) return;
    setSearching(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const closeSearch = () => {
    if (toolbarBlocked) return;
    setSearching(false);
    if (!settings && !nonMailView && query) navigation.visit({ query: "", opened: false });
  };
  const switchView = (next: View) => {
    if (next !== view)
      setMotion(
        viewOrder.indexOf(next) > viewOrder.indexOf(view) ? "forward" : "back",
      );
    navigate({ page: "mail", view: next, opened: false, selectedId: null });
  };
  const switchTab = (next: InboxTab) => {
    const order = inboxTabs.map(({ id }) => id);
    if (view === "inbox" && next !== tab)
      setMotion(order.indexOf(next) > order.indexOf(tab) ? "forward" : "back");
    navigate({ view: "inbox", tab: next, opened: false, selectedId: null });
  };
  const nextTab = () => {
    const index = inboxTabs.findIndex(({ id }) => id === tab);
    switchTab(inboxTabs[(index + 1) % inboxTabs.length].id);
  };
  const hasListControls = accountFilter !== "all" || labelFilter !== "all" || !!query ||
    readFilter !== "all" || relevanceFilter !== "all" || sort !== "newest";
  const resetListControls = () => {
    if (navigate({ accountFilter: "all", labelFilter: "all", query: "", readFilter: "all",
      relevanceFilter: "all", sort: "newest", selectedId: null, opened: false })) setSearching(false);
  };
  const labels = state.labels.filter((label) =>
    accountFilter === "all" || label.accountId === accountFilter);
  const activeLabel = labels.find((label) => `${label.accountId}:${label.id}` === labelFilter);
  useEffect(() => {
    if (labelFilter !== "all" && !activeLabel) setLabelFilter("all");
  }, [labelFilter, activeLabel]);
  const now = Date.now();
  const isSnoozed = (m: Mail) =>
    m.snoozedUntil !== null && m.snoozedUntil > now;
  const tabs = useMemo(() => new Map(state.messages.map((mail) => [mail.id, "inboxTab" in mail ? mail.inboxTab : inboxTab(mail, state.rules)])),
    [state.messages, state.rules]);
  const tabOf = (mail: Mail) => "inboxTab" in mail ? mail.inboxTab : tabs.get(mail.id) ?? inboxTab(mail, state.rules);
  const search = useMailSearch(query, state.accounts, state.messages, api, state.draftToken);
  const searchAccount = accountFilter === "all" ? undefined : state.accounts.find((a) => a.id === accountFilter);
  const showSearchDrafts = !!query.trim() && (view === "all" || view === "drafts") &&
    readFilter === "all" && relevanceFilter === "all" && labelFilter === "all";
  const hasSearchDrafts = showSearchDrafts && search.drafts.some(draft => accountFilter === "all" || draft.accountId === accountFilter);
  const draftOpeningAllowed = !navigationBlocked && !contextMenu && !palette;
  const draftOpenGuard = useRef(false);
  useLayoutEffect(() => { draftOpenGuard.current = draftOpeningAllowed; });
  const outboxGeneration = composeGeneration.current;
  const outboxOpenContext = useRef({ allowed: false, scheduled: false, accounts: state.accounts });
  useLayoutEffect(() => { outboxOpenContext.current = { allowed: draftOpeningAllowed && !busy, scheduled: scheduledOpen && !busy && !updateInstalling && !settingsModal && !workModal, accounts: state.accounts }; });
  const openOutboxDraft = (draft: Draft) => {
    const context = outboxOpenContext.current;
    if (context.allowed && outboxGeneration === composeGeneration.current && !draftSession.current &&
      context.accounts.some(account => account.id === draft.accountId)) openCompose(draft);
    else setNotice("Send was cancelled. The restored draft is saved in Drafts; your current view is unchanged.");
  };
  const openScheduledDraft = (draft: Draft) => {
    const context = outboxOpenContext.current;
    if (context.scheduled && outboxGeneration === composeGeneration.current && !draftSession.current &&
      context.accounts.some(account => account.id === draft.accountId)) {
      setScheduledOpen(false); openCompose(draft);
    } else setNotice("The restored draft is saved in Drafts; your current view is unchanged.");
  };
  const openSavedDraft = (draft: Draft) => {
    if (!draftOpenGuard.current || draftSession.current || sendLock.current || draftLock.current || attachmentTask.current) return;
    openCompose(draft);
  };
  // Keep list sorting out of draft keystrokes, selection and unrelated toolbar
  // changes. Expired snoozes still invalidate on the next render.
  const expiredSnooze = state.messages.reduce((latest, mail) => mail.snoozedUntil !== null && mail.snoozedUntil <= now ? Math.max(latest, mail.snoozedUntil) : latest, 0);
  const filtered = useMemo(() => filterMail(state.messages, navigation.location, activeLabel, Date.now(), undefined, tabOf, search.matches),
    [state.messages, view, tab, accountFilter, labelFilter, readFilter, relevanceFilter, sort, query, activeLabel, tabs, search.matches, expiredSnooze]);
  const selected = opened
    ? state.messages.find((m) => m.id === selectedId &&
        state.accounts.some((account) => account.id === m.accountId))
    : filtered.find((m) => m.id === selectedId) || filtered[0];
  const accountOf = (m: Mail) =>
    state.accounts.find((a) => a.id === m.accountId);
  const selectedAccount = selected && accountOf(selected);
  const currentReplySource = compose ? replyContext ? state.messages.find(mail => mail.id === replyContext.id && mail.accountId === compose.accountId &&
    mail.accountId === replyContext.accountId && mail.messageId === compose.inReplyTo) : replySource(state.messages, compose) : undefined;
  const hydratedReply = useMailBody(currentReplySource || undefined, api);
  // Inbox total for the sidebar and unread counts for each category tab.
  const inboxMail = state.messages.filter((m) => m.direction !== "sent" && !m.archived && !isSnoozed(m) &&
    matchesLabel(m, activeLabel) && (accountFilter === "all" || accountFilter === m.accountId));
  const tabUnread = new Map<InboxTab, number>();
  for (const m of inboxMail) if (m.unread) tabUnread.set(tabOf(m), (tabUnread.get(tabOf(m)) ?? 0) + 1);
  const snoozedCount = state.messages.filter(
    (m) => m.direction !== "sent" && !m.archived && isSnoozed(m) && matchesLabel(m, activeLabel),
  ).length;
  const perform = async <T,>(task: () => Promise<T>, success?: string, localUndo?: (result: T) => LocalMailUndo | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await task();
      const undo = localUndo?.(result);
      if (undo) setLastUndo(undo);
      if (success) {
        pushToast(success, "success", undo ? `undo:${undo.token}` : undefined, undefined, undo);
        try { await reload(); }
        catch { setNotice(`${success} Inbox refresh failed. Refresh the inbox separately.`); }
      } else await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };
  const changeMessage = (
    mail: Mail,
    action: "read" | "unread" | "inbox" | "archive" | "snooze" | "unsnooze" | "pin" | "unpin",
    until?: number,
  ) =>
    perform(() =>
      api<LocalMailActionResponse>(`/messages/${encodeURIComponent(mail.id)}`, "PATCH", {
        action,
        until,
      }),
      action === "archive" ? "Email archived." : action === "unsnooze" ? "Email returned to inbox." :
        action === "pin" ? "Email pinned." : action === "unpin" ? "Email unpinned." :
        action === "snooze" ? "Email snoozed." : undefined,
      result => result.undo,
    );
  const undoLocalAction = async (receipt: LocalMailUndo) => {
    if (busy || syncing || toolbarBlocked || undoLock.current) return;
    undoLock.current = true;
    consumeUndo(receipt.token);
    setLastUndo(current => current?.token === receipt.token ? null : current);
    try {
      await perform(async () => {
        try { await api(`/messages/${encodeURIComponent(receipt.id)}/undo`, "POST", { accountId: receipt.accountId, token: receipt.token }); }
        catch (error) { throw new Error(`Undo was not confirmed and was not retried. Refresh mail before acting again. ${error instanceof Error ? error.message : ""}`); }
      }, "Local action undone.");
    } finally { undoLock.current = false; }
  };
  const markRead = (mail: Mail) => {
    if (mail.direction === "sent") return;
    void markMailRead(mail, pendingReads.current, async () => {
      setReading(new Set(pendingReads.current));
      await api(`/messages/${encodeURIComponent(mail.id)}`, "PATCH", { action: "read" });
      // Ignore state snapshots requested before the provider confirmed this read.
      ++loadRevision.current;
      setState((current) => ({ ...current, messages: current.messages.map((message) =>
        message.id === mail.id && message.accountId === mail.accountId && message.remoteId === mail.remoteId
          ? { ...message, unread: false, labelIds: message.labelIds?.filter((id) => id !== "UNREAD") }
          : message) }));
      void reload().catch(() => setNotice("Email marked as read. Inbox refresh failed. Refresh the inbox separately."));
    }).catch((error: unknown) => setNotice(
      error instanceof Error ? `${error.message} Use Mark as read or reopen the email to retry.`
        : "Could not mark this email as read. Use Mark as read or reopen it to retry.",
    )).finally(() => setReading(new Set(pendingReads.current)));
  };
  const trashUnavailable = (mail: Mail) => mail.archived && accountOf(mail)?.provider !== "gmail" && !mail.messageId
    ? "Move to Trash is unavailable for this archived email because its Message-ID is missing. Move it in your provider."
    : undefined;
  const moveToTrash = async (mail: Mail) => {
    if (busy || syncing || trashLock.current || trashUnavailable(mail)) return;
    trashLock.current = true;
    setBusy(true);
    try {
      await api(`/messages/${encodeURIComponent(mail.id)}`, "PATCH", { action: "trash" });
      ++loadRevision.current;
      setState((current) => ({ ...current, messages: current.messages.filter((message) =>
        !(message.id === mail.id && message.accountId === mail.accountId && message.remoteId === mail.remoteId)) }));
      setTrashMail(null);
      if (selectedId === mail.id) setOpened(false);
      pushToast("Email moved to Trash.", "success");
      try { await reload(); }
      catch { setNotice("Email moved to Trash. Inbox refresh failed. Refresh the inbox separately."); }
    } catch (error) {
      setNotice(`${error instanceof Error ? error.message : "Move to Trash could not be confirmed."} Check your provider before trying again.`);
    } finally {
      trashLock.current = false;
      setBusy(false);
    }
  };
  const openMail = (mail: Mail, context: Partial<MailLocation> = {}) => {
    if (navigationBlocked || settings) return;
    navigation.update((current) => ({ ...current, ...context, selectedId: mail.id, opened: true }));
    markRead(mail);
  };
  const openReaderMail = (mail: Mail | undefined) => {
    if (!mail || navigationBlocked || contextMenu) return;
    readerFocusPending.current = true;
    openMail(mail);
  };
  const jumpTo = (mail: Mail) => {
    openMail(mail, {
      view: mail.direction === "sent" ? "sent" : mail.archived ? "archive" : isSnoozed(mail) ? "snoozed" : "inbox", tab: tabOf(mail),
      accountFilter: "all", labelFilter: "all", query: "", readFilter: "all", relevanceFilter: "all",
    });
  };
  const requestNotificationMail = useCallback((id: string) => {
    // Refresh before resolving the exact accepted ID; never choose the newest snapshot row.
    void reload().then(() => setNotificationTargets((ids) => ids.includes(id) ? ids : [...ids, id]))
      .catch(() => setNotice("Could not open the notified email. Refresh the inbox and try again."));
  }, [reload, setNotice]);
  useEffect(() => window.desktop?.notifications?.onOpen(requestNotificationMail), [requestNotificationMail]);
  useEffect(() => {
    if (!loaded || busy || syncing || navigationBlocked || contextMenu || palette || !notificationTargets.length) return;
    const id = notificationTargets[0];
    setNotificationTargets((ids) => ids.slice(1));
    const mail = state.messages.find((mail) => mail.id === id && state.accounts.some((account) => account.id === mail.accountId));
    if (!mail) { setNotice("The notified email is no longer available on this device."); return; }
    navigation.visit({ page: "mail", view: mail.archived ? "archive" : isSnoozed(mail) ? "snoozed" : "inbox",
      tab: tabOf(mail), accountFilter: "all", labelFilter: "all", query: "", readFilter: "all", relevanceFilter: "all",
      selectedId: mail.id, opened: true });
    setSearching(false);
    readerFocusPending.current = true;
    markRead(mail);
  });
  const openWorkSource = (mail: Mail) => {
    if (navigationBlocked || settings || (accountFilter !== "all" && mail.accountId !== accountFilter) || !state.accounts.some((account) => account.id === mail.accountId)) return;
    if (opened && selectedId === mail.id) {
      readerRef.current?.parentElement?.scrollTo({ top: 0, behavior: "instant" });
      readerRef.current?.querySelector<HTMLElement>(".message")?.focus({ preventScroll: true });
    } else readerFocusPending.current = true;
    openMail(mail);
  };
  const openTracking = (mail: Mail) => {
    if (!navigationBlocked) setQuickSource(mail.id);
  };
  const openMeeting = (mail: Mail) => {
    if (!navigationBlocked) setMeetingMail(mail);
  };
  const closeReader = () => { listFocusPending.current = true; setOpened(false); };
  const forwardMail = async (mail: Mail) => {
    if (forwardRequest.current || draftSession.current || compose || busy || updateInstalling) return;
    const request = { source: mail, generation: composeGeneration.current, valid: true };
    forwardRequest.current = request;
    setBusy(true);
    try {
      const draft = await api<Draft>(`/messages/${encodeURIComponent(mail.id)}/forward`, "POST", {});
      if (request.valid && request.generation === composeGeneration.current && !draftSession.current) openCompose(draft);
      else {
        setNotice("Forward finished in the background. Check Drafts for recovery. No mail was sent.");
        void reload().catch(() => {});
      }
    }
    catch { setNotice("Forward could not be prepared. No mail was sent."); }
    finally { forwardRequest.current = null; setBusy(false); }
  };
  const startCompose = (reply?: Mail, all = false) => {
    if (!state.accounts.length) {
      setConnecting("choose");
      return;
    }
    if (compose || updateInstalling) return;
    const accountId = reply?.accountId ||
      (accountFilter !== "all" ? accountFilter : state.accounts[0].id);
    openCompose(initialCompose(accountId, state.composePreferences ?? emptyComposePreferences, {
      accountId:
        reply?.accountId ||
        (accountFilter !== "all" ? accountFilter : state.accounts[0].id),
      ...(reply ? replyRecipients(reply, state.accounts.map((account) => account.email), all) : { to: [] }),
      subject: reply
        ? /^re:/i.test(reply.subject)
          ? reply.subject
          : `Re: ${reply.subject}`
        : "",
      body: "",
      inReplyTo: reply?.messageId,
      threadId: reply?.threadId,
      references: reply?.messageId
        ? [
            ...(reply.references || [])
              .filter((v) => v !== reply.messageId)
              .slice(-99),
            reply.messageId,
          ]
        : reply?.references,
    }), reply);
  };
  const archive = (mail: Mail) => {
    void changeMessage(mail, "archive");
    if (selectedId === mail.id) setOpened(false);
  };
  const neighbours = opened && selected
    ? filterMail(state.messages, navigation.location, activeLabel, now, selected.id, tabOf, search.matches) : filtered;
  const neighbourIndex = neighbours.findIndex((mail) => mail.id === selected?.id);
  const previousMail = neighbours[neighbourIndex - 1];
  const nextMail = neighbours[neighbourIndex + 1];
  type MailMenuId = "open" | "read" | "unread" | "inbox" | "pin" | "reply" | "reply-all" | "forward-mail" | "archive" | "snooze" | "unsnooze" | "trash" | "track" | "meeting" | "teach";
  const busyReason = busy ? "Another action is in progress" : syncing ? "Mail is syncing" : undefined;
  // Why a mailbox-state action is unavailable; undefined while it can run.
  const mailActionReason = (mail: Mail) =>
    mail.archived ? "Already archived" : mail.direction === "sent" ? "Not available for sent mail" : busyReason;
  // One list of actions feeds the native menu on the desktop and the drawn menu elsewhere.
  const mailMenuActions = (mail: Mail): (MenuAction & { id: MailMenuId })[] => [
    { id: "open", label: "Open", key: shortcut("open"), run: () => openMail(mail) },
    { id: "read", key: shortcut("read"), label: reading.has(mail.id) ? "Marking as read…" : "Mark as read", disabled: mail.direction === "sent" || !mail.unread || reading.has(mail.id),
      description: mail.direction === "sent" ? "Sent mail is already read" : reading.has(mail.id) ? "Update in progress" : !mail.unread ? "Already read" : undefined, run: () => markRead(mail) },
    { id: "unread", key: shortcut("unread"), label: "Mark as unread", disabled: busy || syncing || mail.direction === "sent" || mail.unread || reading.has(mail.id),
      description: mail.direction === "sent" ? "Not available for sent mail" : mail.unread ? "Already unread" : reading.has(mail.id) ? "Update in progress" : busyReason, run: () => void changeMessage(mail, "unread") },
    { id: "inbox", key: shortcut("inbox"), label: "Move to Inbox", disabled: busy || syncing || !mail.archived || mail.direction === "sent",
      description: mail.direction === "sent" ? "Not available for sent mail" : !mail.archived ? "Already in Inbox" : busyReason, run: () => void changeMessage(mail, "inbox") },
    { id: "pin", key: shortcut("pin"), label: mail.pinned ? "Unpin email" : "Pin email", disabled: busy, description: busy ? "Another action is in progress" : undefined, run: () => void changeMessage(mail, mail.pinned ? "unpin" : "pin") },
    { id: "reply", label: "Reply", key: shortcut("reply"), disabled: busy, description: busy ? "Another action is in progress" : undefined, separator: true, run: () => startCompose(mail) },
    { id: "reply-all", key: shortcut("replyAll"), label: "Reply all", disabled: busy, description: busy ? "Another action is in progress" : undefined, run: () => startCompose(mail, true) },
    { id: "forward-mail", label: "Forward message", key: shortcut("forwardMail"), disabled: busy, run: () => void forwardMail(mail) },
    { id: "archive", label: "Archive", key: shortcut("done"), disabled: busy || syncing || mail.archived || mail.direction === "sent", description: mailActionReason(mail), separator: true, run: () => archive(mail) },
    { id: "snooze", label: "Snooze", key: shortcut("snooze"), disabled: busy || syncing || mail.archived || mail.direction === "sent", description: mailActionReason(mail), run: () => showSnooze(mail) },
    ...(isSnoozed(mail) ? [{ id: "unsnooze" as const, label: "Return to inbox", disabled: busy || syncing, description: busyReason, run: () => void changeMessage(mail, "unsnooze") }] : []),
    { id: "trash", label: "Move to Trash", disabled: busy || syncing || !!trashUnavailable(mail), description: trashUnavailable(mail) ?? busyReason, run: () => setTrashMail(mail) },
    { id: "track", label: "Track work", disabled: busy || navigationBlocked, description: busy ? "Another action is in progress" : navigationBlocked ? "Not available right now" : undefined, run: () => openTracking(mail) },
    { id: "meeting", label: "Schedule meeting", disabled: busy || navigationBlocked, description: busy ? "Another action is in progress" : navigationBlocked ? "Not available right now" : undefined, run: () => openMeeting(mail) },
    { id: "teach", label: "Teach sorting", key: shortcut("teach"), disabled: busy || syncing, description: busyReason, separator: true, run: () => setTeach(mail) },
  ];
  const showMailMenu = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>, mail: Mail, select = true) => {
    if (select) setSelectedId(mail.id);
    const request = mailMenuRequest(event, mail.id);
    const native = window.desktop?.mailMenu;
    if (!native) { setContextMenu(request); return; }
    const actions = mailMenuActions(mail);
    void native(actions.map(({ id, label, key, disabled, separator }) => ({ id, label, enabled: !disabled, accelerator: key, separator })),
      { x: Math.round(request.x), y: Math.round(request.y) })
      .then((chosen) => actions.find((action) => action.id === chosen)?.run());
  };
  const mailMenuKey = (event: ReactKeyboardEvent<HTMLElement>, mail: Mail, select = true) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.stopPropagation();
      showMailMenu(event, mail, select);
    }
  };
  // Where F6 lands in each window region; null skips a hidden region or one
  // with nothing safe to focus.
  const usable = (element: HTMLElement | null | undefined) =>
    element && !element.closest("[inert]") ? element : null;
  const regionTarget = (region: Region): HTMLElement | null => {
    if (region === "sidebar")
      return usable(document.querySelector<HTMLElement>('#sidebar:not([inert]) button[aria-current="page"]')) ??
        usable(document.querySelector<HTMLElement>('#sidebar:not([inert]) button:not(:disabled), #sidebar:not([inert]) a[href]'));
    if (region === "search")
      return usable(searchRef.current && !searchRef.current.disabled ? searchRef.current : null);
    if (region === "list") {
      if (contactsView) return usable(document.querySelector<HTMLElement>('.contacts-page input[type="search"], .contacts-page section button:not(:disabled)'));
      const list = usable(listRef.current);
      if (!list) return null;
      return usable(selected ? document.getElementById(`mail-${selected.id}`) : null) ??
        usable(list.querySelector<HTMLElement>(".message")) ??
        usable(list.querySelector<HTMLElement>(".row:not(:disabled)")) ??
        list;
    }
    if (!opened) return null;
    const pane = usable(document.querySelector<HTMLElement>(".reader-pane"));
    return pane
      ? usable(pane.querySelector<HTMLElement>(".message")) ?? usable(pane.querySelector<HTMLElement>(".reader-scroll")) ?? pane
      : null;
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const prefix = gmailPrefix.current;
      gmailPrefix.current = { key: "", at: 0 };
      if (settingsModal || workModal || quickSource || meetingMail || updateInstalling || contextMenu || event.defaultPrevented || event.isComposing ||
        event.repeat && !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      const target = event.target;
      if (event.key.toLowerCase() === "k" && !event.altKey && !event.shiftKey &&
        (interactionPlatform() === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) {
        if (!toolbarBlocked && !settings) { event.preventDefault(); setFiltersOpen(false); if (compose) leaveCompose({ type: "commands" }); else setPalette((value) => !value); }
        return;
      }
      if (palette) return;
      // F6/Shift+F6 cycles the visible window regions; dialogs, the composer
      // and fields other than the search box keep their own key scope.
      if (event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (navigationBlocked || (target instanceof HTMLElement && (target.closest('[role="dialog"]') ||
          (target !== searchRef.current && target.closest('input, textarea, select, [role="combobox"], [contenteditable]:not([contenteditable="false"])'))))) return;
        const next = nextRegion(regionOrder.filter((region) => regionTarget(region) !== null),
          regionOf(document.activeElement), event.shiftKey ? -1 : 1);
        if (!next) return;
        event.preventDefault();
        const element = regionTarget(next)!;
        element.focus({ preventScroll: true });
        if (element.matches(".row, .message")) element.scrollIntoView?.({ block: "nearest" });
        return;
      }
      if (settings && target instanceof HTMLElement && target.closest("[data-interaction-settings]") &&
        event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        !compose && !teach && !snooze && !trashMail && !shortcuts && !labelMail && !connecting) {
        event.preventDefault(); setSettings(false); return;
      }
      const sizeStep = textSizeShortcut(event);
      if (sizeStep !== null && !(target instanceof HTMLElement && target.closest("[data-interaction-settings]"))) {
        event.preventDefault();
        setTextScale((current) => {
          const next = sizeStep === 0 ? 1 : Math.min(1.5, Math.max(0.8, Math.round((current + sizeStep * 0.1) * 10) / 10));
          try { localStorage.setItem("emc2.text-scale", String(next)); } catch { /* Session choice still applies. */ }
          return next;
        });
        return;
      }
      const sequence = prefix.key && Date.now() - prefix.at < 1500 ? prefix.key : "";
      const action = interactionActions.find(({ id }) => matches(event, id, interaction, interactionPlatform(), !!compose, sequence))?.id;
      const element = target instanceof HTMLElement ? target : null;
      const editing = element?.closest('input, textarea, select, [role="combobox"], [contenteditable]:not([contenteditable="false"]), [data-interaction-settings]');
      const dialog = element?.closest('dialog, [role="dialog"]');
      const sequenceScope = !toolbarBlocked && !editing && !element?.closest('[role="menu"]') &&
        (!dialog || compose && dialog.matches(".compose-dialog") || settings && dialog.matches(".settings-dialog"));
      // Invalid sequences never fall through to mutations, while editors keep their keys.
      if (sequence && !action && sequenceScope && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); return; }
      const prefixKey = event.key.toLowerCase();
      const allowedSequences = settings ? ["search", "privacy", "back", "forward", "settings"] :
        compose ? ["search", "privacy", "back", "forward", "settings", "help", "compose"] : null;
      if (!action && sequenceScope && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        !event.getModifierState?.("AltGraph") && interactionActions.some(({ id }) =>
          (!allowedSequences || allowedSequences.includes(id)) && interaction.shortcuts[id].prefix === prefixKey)) {
        event.preventDefault(); gmailPrefix.current = { key: prefixKey, at: Date.now() }; return;
      }
      if (settings && !toolbarBlocked && !(target instanceof HTMLElement && target.closest("[data-interaction-settings]"))) {
        if (action === "search") {
          event.preventDefault();
          navigate({ page: "mail", view: "all", readFilter: "all", relevanceFilter: "all", labelFilter: "all", query: "", selectedId: null, opened: false });
          setSearching(true);
          settingsSearchPending.current = true;
          return;
        }
        if (action === "privacy") { event.preventDefault(); togglePrivacy(); return; }
      }
      if (compose && !toolbarBlocked && action === "search") { event.preventDefault(); showSearch(); return; }
      if (compose && !toolbarBlocked && action === "privacy") { event.preventDefault(); togglePrivacy(); return; }
      if (target instanceof HTMLElement && (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest('[role="combobox"]'))) return;
      if (target instanceof HTMLElement && target.tagName === "BUTTON" && target.getAttribute("role") === "combobox") return;
      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (compose) return;
        if (snooze) { closeSnooze(); return; }
        if (trashMail) { if (!trashLock.current) setTrashMail(null); return; }
        setOpened(false); setTeach(null); setSnooze(null); setShortcuts(false);
        setLabelMail(null); if (settings) setSettings(false);
        return;
      }
      if (compose) {
        if (action === "back" || action === "forward") { event.preventDefault(); travel(action === "back" ? -1 : 1); }
        else if (action === "settings") { event.preventDefault(); setSettings(value => !value); }
        else if (action === "help") { event.preventDefault(); leaveCompose({ type: "shortcuts" }); }
        else if (action === "compose") { event.preventDefault(); leaveCompose({ type: "new" }); }
        return;
      }
      if (toolbarBlocked || teach || snooze || trashMail || shortcuts || labelMail || connecting) return;
      if (action === "back" || action === "forward") {
        event.preventDefault(); travel(action === "back" ? -1 : 1); return;
      }
      if (settings && action !== "settings") return;
      if (!navigationBlocked && !settings && !(target instanceof HTMLElement && target.closest('[role="dialog"], [role="menu"]'))) {
        const destinations = { goInbox: "inbox", goSent: "sent", goDrafts: "drafts", goAll: "all", goPinned: "all", goSnoozed: "snoozed" } as const;
        if (action && action in destinations) {
          event.preventDefault();
          navigate({ page: "mail", view: destinations[action as keyof typeof destinations], accountFilter: "all",
            query: action === "goPinned" ? "is:pinned" : "", readFilter: "all", relevanceFilter: "all", labelFilter: "all", opened: false, selectedId: null });
          return;
        }
        if (action === "returnToList" && opened) { event.preventDefault(); closeReader(); return; }
      }
      if (target instanceof HTMLElement && target.closest("#sidebar")) return;
      const draftControl = target instanceof HTMLElement && !!target.closest(".draft-list, .draft-tab-bar");
      const inbox = !draftControl && !settings && !nonMailView && view !== "drafts";
      const mailActions = !draftControl && (inbox || !settings && inlineWorkView && opened && !busy);
      if (inbox && ["PageDown", "PageUp"].includes(event.key) &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        const next = event.key === "PageDown" ? nextMail : previousMail;
        if (next) { if (opened) openReaderMail(next); else setSelectedId(next.id); }
        return;
      }
      if (inbox && !opened && ["ArrowDown", "ArrowUp"].includes(event.key) &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
        (!(target instanceof HTMLElement) || !target.closest("button, a, [role=button]") || target.closest(".row"))) {
        event.preventDefault();
        const next = event.key === "ArrowDown" ? nextMail : previousMail;
        if (next) setSelectedId(next.id);
        return;
      }
      if (action === "search") { event.preventDefault(); showSearch(); }
      else if (action === "settings") setSettings((value) => !value);
      else if (action === "help") setShortcuts(true);
      else if (action === "compose") startCompose();
      else if (action === "privacy") togglePrivacy();
      else if (inbox && action === "density") setDensity((value) => value === "comfortable" ? "compact" : "comfortable");
      else if (inbox && action === "important") switchView("inbox");
      else if (inbox && action === "other") nextTab();
      else if (target instanceof HTMLElement && target.closest(".row-actions") &&
        ["next", "previous", "open", "done", "reply", "replyAll", "forwardMail", "read", "unread", "inbox", "pin", "snooze", "teach"].includes(action ?? "")) return;
      else if (inbox && (action === "next" || action === "previous")) {
        event.preventDefault();
        const next = action === "next" ? nextMail : previousMail;
        if (next) { if (opened) openReaderMail(next); else setSelectedId(next.id); }
      } else if (inbox && action === "open" && selected &&
        (!(target instanceof HTMLElement) || !target.closest("button, a, [role=button]") || target.closest(".row"))) {
        event.preventDefault(); openMail(selected);
      } else if (mailActions && action === "done" && selected && !busy) archive(selected);
      else if (mailActions && ["pin", "read", "unread", "inbox", "replyAll"].includes(action ?? "") && selected) {
        const id = action === "replyAll" ? "reply-all" : action;
        const command = mailMenuActions(selected).find(command => command.id === id);
        if (command && !command.disabled) { event.preventDefault(); command.run(); }
      }
      else if (mailActions && action === "forwardMail" && selected) void forwardMail(selected);
      else if (mailActions && action === "reply" && selected) startCompose(selected);
      else if (mailActions && action === "snooze" && selected) showSnooze(selected);
      else if (mailActions && action === "teach" && selected) setTeach(selected);
      else if (inbox && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !(target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) {
        if (event.key === "Tab" && target === document.body) {
          event.preventDefault(); nextTab();
        } else if (!event.shiftKey && /^[0-9]$/.test(event.key)) {
          const account = state.accounts[Number(event.key) - 1];
          const nextAccount = event.key === "0" ? "all" : account?.id;
          if (nextAccount && nextAccount !== accountFilter) navigate({ accountFilter: nextAccount, labelFilter: "all", selectedId: null, opened: false });
        }
      }
    };
    const resetSequence = () => { gmailPrefix.current = { key: "", at: 0 }; };
    window.addEventListener("keydown", handler);
    window.addEventListener("blur", resetSequence);
    document.addEventListener("focusin", resetSequence);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("blur", resetSequence);
      document.removeEventListener("focusin", resetSequence);
    };
  });
  useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (sendLock.current || draftAdmissionLock.current || attachmentTask.current || draftSession.current?.dirty || compose?.sendUnknown || eventDirty)
        e.preventDefault();
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [compose, eventDirty]);
  const workPrivateNames = useMemo(() => [...new Set(state.messages.flatMap((mail) => collectPrivateNames(state.accounts, mail)))], [state.accounts, state.messages]);

  // Pick the entrance once per pane so re-renders never restart its animation.
  // Beside the reader, the list keeps its pane while mail opens and closes.
  const paneKey = opened && selected && !split
    ? `mail:${selected.id}`
    : `list:${view}:${tab}:${accountFilter}:${labelFilter}:${readFilter}:${relevanceFilter}:${sort}`;
  const pane = useRef({ key: paneKey, motion });
  if (pane.current.key !== paneKey)
    pane.current = {
      key: paneKey,
      motion: paneKey.startsWith("mail:")
        ? "open"
        : pane.current.key.startsWith("mail:")
          ? "close"
          : motion,
    };
  const readerKey = opened && selected ? selected.id : null;
  useLayoutEffect(() => {
    if (!opened) {
      if (listFocusPending.current) {
        listFocusPending.current = false;
        document.getElementById(`mail-${selected?.id}`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (inlineWorkView) {
      readerRef.current?.parentElement?.scrollTo({ top: 0, behavior: "instant" });
      if (readerFocusPending.current) {
        readerFocusPending.current = false;
        readerRef.current?.querySelector<HTMLElement>(".message")?.focus({ preventScroll: true });
      }
      return;
    }
    const region = split ? readerRef.current : listRef.current;
    region?.scrollTo({ top: 0, behavior: "instant" });
    if (readerFocusPending.current) {
      readerFocusPending.current = false;
      region?.querySelector<HTMLElement>(".message")?.focus({ preventScroll: true });
    }
  }, [readerKey, opened, split, view]);
  useEffect(closeContextMenu, [paneKey, readerKey, settings, closeContextMenu]);
  const menuMail = contextMenu && state.messages.find((mail) => mail.id === contextMenu.mailId);
  const privacyContext = useMemo(() => ({ on: privacy, revealed, toggle: toggleAddress,
    accounts: state.accounts, names: collectPrivateNames(state.accounts) }),
  [privacy, revealed, toggleAddress, state.accounts]);
  useEffect(() => {
    if (contextMenu && !menuMail) closeContextMenu();
  }, [contextMenu, menuMail, closeContextMenu]);
  const filtersActive = readFilter !== "all" || relevanceFilter !== "all" ||
    sort !== "newest" || labelFilter !== "all";
  // The header in each window corner carries the window controls. macOS draws its
  // own lights over the top-left header, which only reserves room for them.
  const corner = (pane: "sidebar" | "main"): Corner => {
    const left = sidebarShown ? "sidebar" : "main";
    if (window.desktop?.platform === "darwin") return pane === left ? "reserve" : null;
    // The system caption buttons sit over the top-right corner.
    if (systemCaption) return pane === "main" ? "caption" : null;
    if (!drawsWindowControls) return null;
    return windowSide === "left" ? (pane === left ? "left" : null) : (pane === "main" ? "right" : null);
  };
  const sidebarToggle = !sidebarShown && (
    <button data-compose-access
      className="icon"
      id="sidebar-toggle"
      aria-label="Show sidebar"
      aria-expanded={false}
      aria-controls="sidebar"
      onClick={toggleSidebar}
    >
      <SidebarIcon color="currentColor" size={16} />
    </button>
  );
  const privacyButton = (
    <button
      className={privacy ? "icon on" : "icon"}
      aria-label={privacy ? "Show personal information" : "Hide personal information"}
      aria-pressed={privacy}
      data-compose-access
      title={privacy ? `Personal information hidden (${shortcut("privacy")})` : `Hide personal information (${shortcut("privacy")})`}
      onClick={togglePrivacy}
    >
      {privacy ? <EyeOff color="currentColor" size={15} /> : <Eye color="currentColor" size={15} />}
    </button>
  );
  const actions = selected && (
    <MailActions
      mail={selected}
      opened={opened}
      reading={reading.has(selected.id)}
      busy={busy}
      syncing={syncing}
      snoozed={isSnoozed(selected)}
      trashUnavailable={trashUnavailable(selected)}
      shortcut={shortcut}
      onTrash={() => setTrashMail(selected)}
      onRead={() => markRead(selected)}
      onUnread={() => void changeMessage(selected, "unread")}
      onInbox={() => void changeMessage(selected, "inbox")}
      onReply={() => startCompose(selected)}
      onArchive={() => archive(selected)}
      onSnooze={(event) => showSnooze(selected, event)}
      onUnsnooze={() => void changeMessage(selected, "unsnooze")}
      onPin={() => void changeMessage(selected, selected.pinned ? "unpin" : "pin")}
      onTrack={() => openTracking(selected)}
      onSchedule={() => openMeeting(selected)}
      onClose={closeReader}
      onPrevious={inlineWorkView ? undefined : () => openReaderMail(previousMail)}
      onNext={inlineWorkView ? undefined : () => openReaderMail(nextMail)}
      previousDisabled={navigationBlocked || !!contextMenu || !previousMail}
      nextDisabled={navigationBlocked || !!contextMenu || !nextMail}
    />
  );
  const reader = opened && selected && (
    <Reader
      state={state}
      mail={selected}
      onOpenDraft={openCompose}
      onReviewingUnsubscribe={setReviewingUnsubscribe}
      provider={selectedAccount?.provider}
      labels={state.labels}
      busy={busy || syncing}
      api={api}
      onOpen={inlineWorkView ? openWorkSource : jumpTo}
      onChanged={reload}
      onReplyAll={() => startCompose(selected, true)}
      onForward={() => void forwardMail(selected)}
      onLabels={() => setLabelMail(selected)}
      onUnsnooze={() => void changeMessage(selected, "unsnooze")}
      onChangeTime={(event) => showSnooze(selected, event)}
      onMenu={(event, mail) => showMailMenu(event, mail, false)}
      onMenuKey={(event, mail) => mailMenuKey(event, mail, false)}
    />
  );
  const historyControls = (
    <nav className="mail-navigation" aria-label="Mail history">
      <button data-compose-access type="button" aria-label="Back" title="Back" disabled={toolbarBlocked || !!contextMenu || (!!compose && busy) || !(navigation.canBack || compose)} onClick={() => travel(-1)}>
        <ArrowLeft size={15} />
      </button>
      <button data-compose-access type="button" aria-label="Forward" title="Forward" disabled={toolbarBlocked || !!contextMenu || (!!compose && busy) || !navigation.canForward} onClick={() => travel(1)}>
        <ArrowRight size={15} />
      </button>
    </nav>
  );
  const updateAppearance = (value: typeof appearance) => {
    if (!saveAppearance(value)) {
      setNotice("Appearance could not be saved on this device.");
      return false;
    }
    setAppearance(value);
    return true;
  };
  const paletteActions = {
    important: () => switchView("inbox"), search: showSearch, compose: () => startCompose(),
    settings: () => setSettings(true), privacy: togglePrivacy, help: () => setShortcuts(true),
    density: () => setDensity((value) => value === "comfortable" ? "compact" : "comfortable"),
  };
  const findPinned = (scope: PinnedScope) => {
    navigate({ page: "mail", ...(scope === "all" || contactsView ? { view: "all" as const } : {}), query: "is:pinned", selectedId: null, opened: false });
    setSearching(true);
    setFiltersOpen(false);
  };
  const paletteViews = ["actions", "calendar", "projects", "agents", "contacts", "sent", "all"] as const;
  type PaletteId =
    | keyof typeof paletteActions
    | `view-${(typeof paletteViews)[number]}`
    | "drafts" | "archive-view" | "snoozed-view" | "pinned-view" | "pinned-all" | "sync"
    | `mail-${MailMenuId}`;
  // Extra search words keyed by command id, so an alias on a missing id fails to compile.
  const commandAliases: Partial<Record<PaletteId, string[]>> = {
    search: ["find"],
    compose: ["new", "write"],
    settings: ["preferences"],
    privacy: ["redact", "hide"],
    help: ["keys"],
    sync: ["refresh"],
    "archive-view": ["archived"],
    "snoozed-view": ["later"],
    "mail-archive": ["done"],
    "mail-snooze": ["later"],
    "mail-trash": ["delete"],
    "mail-reply": ["answer"],
    "mail-teach": ["learn"],
  };
  // Actions on the selected email stay listed, disabled, when nothing is selected.
  const placeholderMailCommands: { id: Exclude<MailMenuId, "unsnooze">; label: string; key?: string }[] = [
    { id: "open", label: "Open", key: shortcut("open") },
    { id: "read", key: shortcut("read"), label: "Mark as read" },
    { id: "unread", key: shortcut("unread"), label: "Mark as unread" },
    { id: "inbox", key: shortcut("inbox"), label: "Move to Inbox" },
    { id: "pin", key: shortcut("pin"), label: "Pin email" },
    { id: "reply", label: "Reply", key: shortcut("reply") },
    { id: "reply-all", key: shortcut("replyAll"), label: "Reply all" },
    { id: "forward-mail", label: "Forward message", key: shortcut("forwardMail") },
    { id: "archive", label: "Archive", key: shortcut("done") },
    { id: "snooze", label: "Snooze", key: shortcut("snooze") },
    { id: "trash", label: "Move to Trash" },
    { id: "track", label: "Track work" },
    { id: "meeting", label: "Schedule meeting" },
    { id: "teach", label: "Teach sorting", key: shortcut("teach") },
  ];
  const mailCommands = selected && !contactsView
    ? mailMenuActions(selected).map(({ id, label, key, disabled, description, run }) => ({
        id: `mail-${id}`, label, group: "mail" as const, shortcut: key, disabled,
        disabledReason: description, aliases: commandAliases[`mail-${id}`], run }))
    : placeholderMailCommands.map(({ id, label, key }) => ({
        id: `mail-${id}`, label, group: "mail" as const, shortcut: key, disabled: true,
        disabledReason: "Select an email first", aliases: commandAliases[`mail-${id}`], run: () => undefined }));
  const savedViews = useSavedViews({ api, active: ready && palette, location: navigation.location, privacy, edit: savedViewEdit, setEdit: setSavedViewEdit,
    available: definition => (definition.accountFilter === "all" || state.accounts.some(account => account.id === definition.accountFilter)) &&
      (definition.labelFilter === "all" || state.labels.some(label => `${label.accountId}:${label.id}` === definition.labelFilter &&
        (definition.accountFilter === "all" || definition.accountFilter === label.accountId))),
    onOpen: definition => { setSearching(!!definition.query); navigate({ ...definition, page: "mail", selectedId: null, opened: false }); },
    onError: setNotice,
  });
  const commands: PaletteCommand[] = [
    ...savedViews.commands,
    { id: "undo-local", label: "Undo last action", group: "navigation", disabled: !lastUndo || busy || syncing || toolbarBlocked,
      disabledReason: !lastUndo ? "No local action to undo" : busy || syncing || toolbarBlocked ? "Another action is in progress" : undefined,
      run: () => { if (lastUndo) void undoLocalAction(lastUndo); } },
    ...interactionActions.flatMap(({ id, label }) => id in paletteActions ? [{ id, label, group: "navigation" as const,
      shortcut: shortcut(id), aliases: commandAliases[id as keyof typeof paletteActions],
      run: paletteActions[id as keyof typeof paletteActions] }] : []),
    ...paletteViews.map((next) => ({ id: `view-${next}`, label: `Open ${viewNames[next]}`, group: "navigation" as const,
      aliases: commandAliases[`view-${next}`], run: () => navigate({ page: "mail", view: next, opened: false }) })),
    { id: "scheduled", label: "Open Scheduled", group: "navigation", disabled: navigationBlocked, run: () => setScheduledOpen(true) },
    { id: "drafts", label: "Open Drafts", group: "navigation", disabled: !state.accounts.length,
      disabledReason: !state.accounts.length ? "Add an account first" : undefined, run: () => switchView("drafts") },
    { id: "archive-view", label: "Show Archive", group: "navigation", aliases: commandAliases["archive-view"], run: () => switchView("archive") },
    { id: "snoozed-view", label: "Show Snoozed", group: "navigation", aliases: commandAliases["snoozed-view"], run: () => switchView("snoozed") },
    { id: "pinned-view", label: "Find pinned mail in this view", group: "navigation", run: () => findPinned("view") },
    { id: "pinned-all", label: "Find pinned mail in All cached", group: "navigation", run: () => findPinned("all") },
    { id: "sync", label: "Sync mail", group: "navigation", aliases: commandAliases.sync,
      disabled: syncing || !state.accounts.length,
      disabledReason: !state.accounts.length ? "Add an account first" : syncing ? "Already syncing" : undefined,
      run: () => void sync() },
    ...(!settings ? mailCommands : []),
  ];
  return (
    <MailSearchApiContext.Provider value={api}><PrivacyContext.Provider
      value={privacyContext}
    >
      <div
        className={`app${window.desktop ? " desktop" : ""}${privacy ? " private" : ""}`}
        data-platform={window.desktop?.platform}
        data-view={settings ? "settings" : view}
        style={{ "--text-scale": textScale } as React.CSSProperties}
      >
        <ToastStack outbox={<OutboxNotices api={api} refreshKey={outboxRefresh} enabled={loaded} onScheduled={() => setScheduledOpen(true)} blocked={busy || updateInstalling || scheduledOpen || !!compose || settingsModal || workModal} onEdit={openOutboxDraft} onNotice={outboxNotice} onChanged={() => { void reload().catch(() => {}); }} />} toasts={toasts} onDismiss={dismissToast} position={notifications.position} preferences={notifications} onOpen={requestNotificationMail} onUndo={receipt => void undoLocalAction(receipt)} undoDisabled={busy || syncing || toolbarBlocked} />
        {scheduledOpen && <Dialog title="Scheduled" onClose={() => setScheduledOpen(false)}>
          <p className="dialog-copy">Emc² must be running and online. Sleep, restart and missed offline schedules require review. Unknown outcomes are never retried automatically.</p>
          <OutboxNotices api={api} scheduledOnly enabled={loaded} blocked={busy || updateInstalling}
            onEdit={openScheduledDraft} onNotice={outboxNotice} onChanged={() => { setOutboxRefresh(current => current + 1); void reload().catch(() => {}); }} />
        </Dialog>}

        <BrowserUpdateNotice
          blocked={scheduledOpen || !loaded || busy || syncing || navigationBlocked || nonMailView || view === "drafts" || eventDirty || composeSaving || !!palette || !!contextMenu || !!pendingReads.current.size || sendLock.current || syncLock.current || trashLock.current || (!!composeDraft && JSON.stringify(composeDraft) !== JSON.stringify(state.composePreferences ?? emptyComposePreferences))}
          writes={browserWrites}
          onReload={() => { rememberBrowserUpdateLocation(navigation.location); window.location.reload(); }}
        />
        {palette && !updateInstalling && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
        {savedViews.dialog}
        <div className="frame" inert={settings || updateInstalling || palette || scheduledOpen || savedViews.editing}>
          {!roomy && mobileSidebarOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label="Close navigation" onClick={() => { setMobileSidebarOpen(false); requestAnimationFrame(() => document.getElementById("sidebar-toggle")?.focus()); }} />}
          <Sidebar
            open={sidebarShown}
            onToggle={toggleSidebar}
            corner={corner("sidebar")}
            maximized={maximized}
            settings={false}
            mail={{
              view,
              onView: (next) => fromSidebar(() => switchView(next)),
              inboxCount: loaded ? inboxMail.length : undefined,
              snoozedCount: loaded ? snoozedCount : undefined,
              dueCount,
              accounts: state.accounts,
              accountFilter,
              onAccount: (id) => fromSidebar(() => navigate({ page: "mail", accountFilter: id, labelFilter: "all", selectedId: null, opened: false })),
              privacy,
              blocked: toolbarBlocked || (!!compose && busy),
              busy,
              onAddAccount: () => fromSidebar(() => compose ? leaveCompose({ type: "connect" }) : setConnecting("choose")),
              onCompose: () => fromSidebar(() => compose ? leaveCompose({ type: "new" }) : startCompose()),
              onDrafts: () => fromSidebar(() => switchView("drafts")),
              draftCount: state.draftCount,
              onSettings: () => fromSidebar(() => setSettings(true)),
              onAccountSettings: (id) => fromSidebar(() => {
                setAccountSettingsTarget(id);
                navigate({ page: "settings", settingsSection: "accounts" });
              }),
              shortcut,
              syncing,
              lastSync: state.lastSync,
              onSync: () => void sync(),
            }}
            sections={{
              onClose: () => setSettings(false),
            }}
          />
          <div className="app-main" inert={!roomy && mobileSidebarOpen}>
            <PaneHeader className="app-toolbar" corner={corner("main")} maximized={maximized} lead={sidebarToggle}>
              <div className="app-context" aria-label="Current view">
                <span>{settings ? "Emc²" : nonMailView ? "Workspace" : "Mail"}</span>
                <ChevronRight size={12} color="currentColor" />
                <ViewIcon size={16} color="currentColor" />
                <strong>{settings ? "Settings" : viewNames[view]}</strong>
              </div>
              <SearchToolbar inputRef={searchRef} scopeKey={JSON.stringify([page, view, accountFilter, labelFilter, readFilter, relevanceFilter, opened])} query={settings || nonMailView ? "" : query}
                onSaveView={!settings && !nonMailView && !compose && savedViews.canSave ? savedViews.startSave : undefined}
                label="Search cached mail and saved drafts"
                invalid={!settings && !nonMailView && !!search.error} disabled={toolbarBlocked} commandsDisabled={toolbarBlocked || (!!compose && busy)} shortcut={shortcut("search")} onFocus={() => setSearching(true)}
                onChange={(value) => {
                  setSearching(true);
                  if (toolbarBlocked) return;
                  const entering = !!value.trim() && (!query.trim() || settings || nonMailView);
                  navigation.visit({ page: "mail", ...(entering ? { view: "all", accountFilter: "all", readFilter: "all", relevanceFilter: "all", labelFilter: "all" } : {}), query: value, opened: false, selectedId: null }, true);
                }} onClear={closeSearch} onCommands={() => compose ? leaveCompose({ type: "commands" }) : setPalette(true)} />
              <div className="pane-tools">
                {!settings && view !== "drafts" && !nonMailView && <MailFilters
                  open={filtersOpen}
                  active={filtersActive}
                  location={navigation.location}
                  labels={labels}
                  accounts={state.accounts}
                  blocked={toolbarBlocked || (!!compose && busy)}
                  showReset={hasListControls}
                  labelName={(name) => privacy ? redactPrivateText(name, collectPrivateNames(state.accounts, opened ? selected || {} : {})) : name}
                  onOpen={(open) => open && compose ? leaveCompose({ type: "filters" }) : setFiltersOpen(open)}
                  onChange={(patch) => navigate({ ...patch, selectedId: null, opened: false })}
                  onFindPinned={findPinned}
                  onReset={resetListControls}
                />}
                {privacyButton}
              </div>
              {!settings && historyControls}
              <div className="update-spacer" aria-hidden="true" />
            </PaneHeader>
            <div hidden={!searching || settings || nonMailView} className="search-help">
              <span id="mail-search-help" role={search.error ? "alert" : "status"} aria-live="polite" aria-atomic="true">{search.error || (search.pending ? "Searching cached mail and saved drafts…" : `${filtered.length} mail results${showSearchDrafts ? `, ${search.drafts.filter(draft => accountFilter === "all" || draft.accountId === accountFilter).length} saved drafts` : ""}. ${mailSearchScope(navigation.location, state.accounts, activeLabel, privacy, showSearchDrafts)}`)}</span>
              <ProviderSearch api={api} query={query} account={searchAccount} accountName={searchAccount ? accountLabel(searchAccount, state.accounts.indexOf(searchAccount), privacy, state.accounts) : ""} blocked={toolbarBlocked || busy} visible={!settings && !nonMailView && view !== "drafts" && !search.error && !search.pending} reload={reload} />
              <details><summary>Search help</summary><p>Use from:, to:, subject:, body:, account:, is:unread, is:pinned, before:YYYY-MM-DD or after:YYYY-MM-DD. Unquoted words allow one typo. Searches imported mail and saved drafts on this device, including Sent, Archive and Snoozed. Provider history may be incomplete. With one account selected, searching older mail asks the provider for up to 100 more matches: Gmail uses Gmail search, IMAP searches Archive (or All Mail) and Sent, and account: and is:pinned apply only on this device.</p></details>
            </div>
        {contactsView ? (
          <div className="contacts-pane" inert={!!compose}><ContactsPage key={accountFilter} api={api} accounts={state.accounts} accountFilter={accountFilter} busy={busy} /></div>
        ) : view === "drafts" ? (
          <main className="drafts-pane" inert={!!compose}>
            <h1 className="pane-title visually-hidden">Drafts</h1>
            <DraftList accounts={state.accounts} api={api} accountFilter={accountFilter} query={query}
              refreshKey={state.draftToken ?? state.draftCount} active={draftOpeningAllowed} onOpen={openSavedDraft} search={query.trim() ? search : undefined}
              onDeleted={() => { void reload().catch(() => setNotice("Draft deleted, but refreshing the saved count failed. Refresh to check it.")); }}
              onAccount={(id) => navigate({ accountFilter: id, labelFilter: "all", selectedId: null, opened: false })} />
          </main>
        ) : workView ? (
          <main className="work-pane" inert={!!compose}>
            {!loaded ? <div className="empty" role="status"><p>Loading cached mail</p>{mailLoadError && <><p>{mailLoadError}</p><button type="button" className="link" onClick={() => { void reload().catch(error => setNotice(error.message)); }}>Retry loading mail</button></>}</div> : <Workbench key={`${view}:${accountFilter}:${trackingSession}`} work={work} initialSource={trackingSource} initialItem={trackingItem} initialDraft={trackingDraft} onSourceConsumed={() => { setTrackingSource(undefined); setTrackingItem(undefined); setTrackingDraft(undefined); }} onModalChange={setWorkModal} onEventDirtyChange={setEventDirty} mode={view as "actions" | "calendar" | "projects" | "agents"} state={state} api={api} accountFilter={accountFilter} onOpen={inlineWorkView ? openWorkSource : jumpTo} onMailChanged={reload} onNotice={setNotice} onManageAssistants={() => navigate({ page: "settings", settingsSection: "mcp" })} onOpenDraft={openCompose}
              renderHead={(tools) => <PaneHeader className="main-head work-action-head" corner={null} maximized={maximized}><h1 className="pane-title visually-hidden">{viewNames[view]}</h1><div className="head-tools">{tools}</div></PaneHeader>}
              readerOpened={opened} fullReading={!splitRoom} onCloseReader={closeReader}
              reader={selected && opened ? <div ref={readerRef} className="today-mail">{actions}{reader}</div> : undefined} />}
          </main>
        ) : (
          <div className="mail-view" inert={!!compose}>
              <h1 className="pane-title visually-hidden">{viewNames[view]}</h1>
              {(view === "sent" || view === "all") && <PaneHeader className="main-head mail-view-head" corner={null} maximized={maximized}>
                <span className="view-summary">{loaded ? `${filtered.length} cached ${filtered.length === 1 ? "message" : "messages"}` : "Loading cached mail"}</span>
                {(view === "sent" || view === "all") && <div className="head-note">Cached mail only. <button type="button" title={accountFilter === "all" ? "Select one account to fetch up to 50 Sent messages" : "Fetch up to 50 Sent messages"} disabled={busy || accountFilter === "all"} onClick={() => void perform(async () => { const coverage = await api<SentCoverage>(`/accounts/${encodeURIComponent(accountFilter)}/sent/sync`, "POST", { bound: 50 }); if (coverage.error) throw new Error("Sent import failed. Existing cached mail remains available."); }, "Sent cache refreshed.")}>Fetch Sent</button>{accountFilter === "all" && <small>Choose an account first.</small>}</div>}
              </PaneHeader>}
              <div className="mail-category-bar">
                <div className="rail-select" ref={setRailSelect} />
                {view === "inbox" && !query && <InboxTabs tab={tab} unread={tabUnread} onTab={switchTab} />}
                <div className="rail-actions" ref={setRailActions} />
              </div>
          <main className={split ? "workspace split" : "workspace"}>
            <section className="list-pane">
              {!settings && <CredentialFallbackNotice mode={window.desktop?.credentialFallback} />}
              {opened && !split && actions}
              <div
                ref={listRef}
                className={`list ${density}`}
                aria-label={`${viewNames[view]} mail`}
                tabIndex={-1}
              >
              <div key={paneKey} className={`pane ${pane.current.motion}`}>
                <BulkMailSelection active={!opened} messages={opened ? [] : filtered} accounts={state.accounts}
                  railSelect={railSelect} railActions={railActions}
                  scope={JSON.stringify([page, view, tab, accountFilter, labelFilter, query, readFilter, relevanceFilter, sort, opened])}
                  selectedId={selected?.id} onSelect={setSelectedId} api={api} reload={reload}
                  toggleLabel={shortcut("selectMail")}
                  selectionShortcut={event => matches(event, "selectMail", interaction, interactionPlatform()) ? "toggle" :
                    interactionActions.some(({ id }) => matches(event, id, interaction, interactionPlatform())) ? null : "range"}
                  disabled={!loaded || search.pending || busy || settings || !!compose || updateInstalling || !!contextMenu || palette || !!teach || !!snooze || !!trashMail || shortcuts || !!labelMail || !!connecting}
                  syncing={syncing} onBlockingChange={setBulkBlocking}>
                {reader && !split ? reader : filtered.length ? (
                  <MailList
                    messages={filtered}
                    listRef={listRef}
                    focusSelection={!navigationBlocked && !contextMenu}
                    selectedId={selected?.id}
                    density={density}
                    narrow={split}
                    sort={sort}
                    opening={interaction.opening}
                    accounts={state.accounts}
                    showAccount={accountFilter === "all" && state.accounts.length > 1}
                    actions={(mail) => mailMenuActions(mail).map((action) => action.id === "snooze"
                      ? { ...action, run: (event: ReactMouseEvent<HTMLButtonElement>) => showSnooze(mail, event) }
                      : action)}
                    onOpen={openMail}
                    onSelect={setSelectedId}
                    onMenu={showMailMenu}
                    onMenuKey={mailMenuKey}
                  />
                ) : hasSearchDrafts ? null : (
                  <ListEmpty
                    searchPending={search.pending}
                    includesDrafts={showSearchDrafts}
                    loaded={loaded}
                    loadError={mailLoadError}
                    onRetry={() => { void reload().catch(error => setNotice(error.message)); }}
                    hasAccounts={state.accounts.length > 0}
                    filtered={hasListControls}
                    title={view === "sent" ? "No cached Sent mail" : view === "all" ? "No cached mail" : view === "snoozed" ? "No snoozed mail" : view === "archive" ? "No archived mail" : `Nothing in ${tabName(tab)}`}
                    viewName={viewNames[view]}
                    syncing={syncing}
                    onConnect={() => setConnecting("choose")}
                    onWiden={query.trim() && (view !== "all" || labelFilter !== "all" || readFilter !== "all" || relevanceFilter !== "all") ? () => navigate(widenMailSearch()) : undefined}
                    widenLabel={accountFilter === "all" ? "Search all cached mail across all accounts" : "Search all cached mail in this account"}
                    onReset={resetListControls}
                    onSync={() => void sync()}
                  />
                )}
                </BulkMailSelection>
                {hasSearchDrafts && !opened && <DraftList accounts={state.accounts} api={api} accountFilter={accountFilter} query={query}
                  refreshKey={state.draftToken ?? state.draftCount} active={draftOpeningAllowed} onOpen={openSavedDraft} search={search} onDeleted={() => { void reload().catch(() => setNotice("Draft deleted, but refreshing the saved count failed. Refresh to check it.")); }} />}
              </div>
              </div>
            </section>
            {split && (
              <section className="reader-pane" aria-label="Reading pane">
                <PaneHeader className="reader-head" corner={null} maximized={maximized}>
                  {opened && actions}
                </PaneHeader>
                <div ref={readerRef} className="reader-scroll" tabIndex={-1}>
                  <div key={selected && opened ? selected.id : "empty"} className="pane open">
                    {reader || <ReaderEmpty selected={!!selected} openKey={shortcut("open")} />}
                  </div>
                </div>
              </section>
            )}
          </main>
          </div>
        )}
          </div>
        </div>
        {settings && <Dialog title="Settings" className="settings-dialog" closeLabel="Close settings" initialFocus="close" onClose={() => setSettings(false)} actions={historyControls}>
          <div className="settings-pane" inert={toolbarBlocked}>
            <CredentialFallbackNotice mode={window.desktop?.credentialFallback} />
            <SettingsPage
              notifications={notifications}
              onNotifications={(value) => {
                setNotifications(value);
                if (!saveNotifications(value)) setNotice("Notification settings could not be saved on this device. Your selection applies until the app closes.");
              }}
              onNotificationPreview={() => {
                const sample = { id: "sample", sender: "Sample sender", subject: "Sample subject", preview: "A short sample email preview." };
                pushToast("", "info", `arrival:preview:${Date.now()}`, sample);
                const bridge = window.desktop?.notifications;
                if (bridge) void bridge.configure(notifications, privacy).then((saved) => {
                  if (saved) bridge.preview(); else setNotice("Notification settings could not be saved.");
                }).catch(() => setNotice("Notification preview is unavailable."));
              }}
              state={state}
              busy={busy}
              perform={perform}
              api={api}
              onConnectAccount={setConnecting}
              onNotice={(text) => pushToast(text, "info")}
              onCopied={(text) => pushToast(text, "success")}
              onError={setNotice}
              composeDraft={composeDraft}
              composeSaving={composeSaving}
              onComposeDraft={setComposeDraft}
              onComposePreferences={async (value) => {
                if (composeSaveLock.current) throw new Error("Compose preferences are already saving.");
                composeSaveLock.current = true;
                setComposeSaving(true);
                try {
                  const saved = await api<ComposePreferences>("/compose-preferences", "PUT", value);
                  setState((current) => ({ ...current, composePreferences: saved }));
                  setComposeDraft((current) => current === value ? undefined : current);
                  pushToast("Templates and signatures saved.", "success");
                } catch (error) {
                  setNotice("Could not save templates and signatures. Your edits are kept. Try again.");
                  throw error;
                } finally {
                  composeSaveLock.current = false;
                  setComposeSaving(false);
                }
              }}
              windowSide={windowSide}
              onWindowSide={placeWindowControls}
              onWindowControls={(controls) => {
                if (compose || sendLock.current) setNotice("Send or discard your draft before switching window controls.");
                else window.desktop?.setWindowControls?.(controls);
              }}
              interaction={interaction}
              onInteraction={(value) => {
                setInteraction(value);
                if (!saveInteraction(value)) setNotice("Interaction settings could not be saved on this device.");
              }}
              accountTarget={accountSettingsTarget}
              section={settingsSection}
              onSection={setSettingsSection}
              assistants={<Workbench mode="assistants" state={state} api={api} work={work} accountFilter={accountFilter}
                onOpen={jumpTo} onMailChanged={reload} onNotice={setNotice} onModalChange={setWorkModal} renderHead={(tools) => <div className="settings-group-label"><h2>Your assistants</h2>{tools}</div>} />}
              density={density}
              onDensity={setDensity}
              appearance={appearance}
              scheme={themePreview?.scheme ?? scheme}
              onAppearance={updateAppearance}
              onThemePreview={setThemePreview}
              onModalChange={setSettingsModal}
            />
          </div>
        </Dialog>}
        {/* Native title-bar hit testing needs this no-drag region after the draggable pane headers. */}
        {/* The drawn-lights slot is 86px: header padding-right 12 + lights 52
            (3x12 with 8px gaps) + traffic margin-left 12 + toolbar gap 10. */}
        <div className="app-update-control" inert={settings} style={{ right: systemCaption ? 154 : drawsWindowControls && windowSide === "right" ? 86 : 12 }}>
          <UpdateNotice bridge={window.desktop?.updates} onInstalling={setUpdateInstalling} />
        </div>
        {contextMenu && menuMail && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            anchor={contextMenu.anchor}
            onClose={closeContextMenu}
            actions={mailMenuActions(menuMail)}
          />
        )}
        {labelMail && (
          <MailPrivacy mail={labelMail}>
          <Dialog title="Gmail labels" onClose={() => { if (!busy) setLabelMail(null); }}>
            <LabelForm
              key={labelMail.id}
              mail={labelMail}
              labels={customLabels(labelMail, state.labels)}
              busy={busy || syncing}
              onSave={(labelIds) => void perform(async () => {
                await api(`/messages/${encodeURIComponent(labelMail.id)}`, "PATCH", { action: "labels", labelIds });
                setLabelMail(null);
              }, "Labels updated.")}
            />
          </Dialog>
          </MailPrivacy>
        )}
        {connecting === "choose" ? (
          <Dialog title="Connect account" onClose={() => setConnecting(null)}>
            <p className="dialog-copy">Choose your email provider.</p>
            <ProviderChoices api={api} googleConfigured={state.googleConfigured} busy={busy} onChoose={setConnecting} />
          </Dialog>
        ) : connecting && (
          <ConnectDialog
            key={connecting}
            provider={connecting}
            busy={busy}
            onClose={() => setConnecting(null)}
            onBack={() => setConnecting("choose")}
            onConnect={async (input) => {
              await api("/accounts/imap", "POST", input);
              setConnecting(null);
              setNotice("Account connected. Syncing your inbox.");
              try {
                await reload();
                void sync();
              } catch {
                setNotice("Account connected, but refreshing the inbox failed. Reload the app to sync.");
              }
            }}
          />
        )}
        {quickSource && <Dialog title="Track work" className="quick-track-dialog" onClose={() => { if (!work.pending) setQuickSource(null); }}>
          {state.messages.find((mail) => mail.id === quickSource && state.accounts.some((account) => account.id === mail.accountId)) ? <QuickTrack key={quickSource}
            mail={state.messages.find((mail) => mail.id === quickSource)!} work={work} privateNames={workPrivateNames}
            onDone={() => { setQuickSource(null); pushToast("Work tracked.", "success"); }}
            onEdit={(item, draft) => {
              setTrackingSource(quickSource); setTrackingItem(item); setTrackingDraft(draft); setTrackingSession((value) => value + 1); setQuickSource(null);
              navigation.visit({ view: "actions", opened: false });
            }} /> : <p role="alert">Source unavailable in cache. Existing saved work remains in Today.</p>}
        </Dialog>}
        {meetingMail && <MeetingDialog key={meetingMail.id} mail={meetingMail} state={state} api={api} onClose={() => setMeetingMail(null)} onDirtyChange={setEventDirty}
          onSaved={() => { setMeetingMail(null); pushToast("Meeting added to your Emc² calendar. No invitation was sent.", "success"); }} />}
        {compose && (
          <ComposePanel
            onAttachmentTask={(task) => { attachmentTask.current = task; const clear = () => { if (attachmentTask.current === task) attachmentTask.current = undefined; }; void task.then(clear, clear); }}
            draft={compose}
            source={hydratedReply.mail}
            api={api}
            setDraft={editCompose}
            accounts={state.accounts}
            preferences={state.composePreferences ?? emptyComposePreferences}
            onUndoDelay={seconds => runDraftAction(async session => {
              await session.flush();
              const current = await api<ComposePreferences>("/compose-preferences");
              const saved = await api<ComposePreferences>("/compose-preferences", "PUT", { ...current, undoSendSeconds: seconds });
              setState(currentState => ({ ...currentState, composePreferences: saved }));
            })}
            busy={busy || updateInstalling}
            progress={draftProgress}
            onClose={closeCompose}
            onDiscard={() => runDraftAction(async (session) => {
              await session.discard();
              draftSession.current = null;
              setCompose(null);
            })}
            onRetry={() => runDraftAction(async (session) => {
              await session.retry();
              setCompose(session.content);
            })}
            onSaveCopy={() => {
              if (busy || sendLock.current || draftAdmissionLock.current || attachmentTask.current || updateInstalling) return;
              if (confirm("Save a separate copy? The previous saved draft may still exist. Neither copy will be sent automatically.")) openCompose(draftSession.current?.content || compose);
            }}
            onSend={scheduleAt => {
              const session = draftSession.current;
              if (!session || busy || draftAdmissionLock.current || sendLock.current || attachmentTask.current || updateInstalling) return;
              const snapshot = { ...session.content, to: session.content.to.map(value => value.trim()).filter(Boolean), cc: session.content.cc?.map((value) => value.trim()).filter(Boolean), bcc: session.content.bcc?.map(value => value.trim()).filter(Boolean) };
              sendTask.current = sendCompose(snapshot, {
                lock: sendLock,
                prepare: async () => {
                  session.change(snapshot);
                  setCompose(session.content);
                  await session.flush();
                },
                send: async (draft) => {
                  try { const result = await api<{ queued: boolean }>("/send", "POST", {
                    payload: { ...draft, ...(draft.invitation && session.stored ? { calendarDraft: { id: session.stored.id, revision: session.stored.revision } } : {}) },
                    sourceDraftId: session.stored!.id, sourceRevision: session.stored!.revision,
                    ...(scheduleAt === undefined ? {} : { scheduleAt }),
                  }); return { ...result, scheduled: scheduleAt !== undefined }; } catch (error) {
                    // A lost queue response must not leave a locked pending draft
                    // trapped in the composer or create a second attempt.
                    try {
                      const entries = await api<OutboxStatus[]>("/outbox");
                      if (entries.some(entry => entry.sourceDraftId === session.stored?.id && entry.sourceRevision === session.stored?.revision))
                        return { queued: true, scheduled: scheduleAt !== undefined };
                    } catch { /* Retain conservative uncertainty until review is available. */ }
                    throw error;
                  }
                },
                uncertain: () => {
                  session.change({ ...session.content, sendUnknown: true });
                  void session.flush().catch(() => {});
                },
                complete: () => session.discard(),
                reload,
                setDraft: (value) => {
                  if (value === null) { draftSession.current = null; setOutboxRefresh(current => current + 1); }
                  setCompose(value);
                },
                setBusy,
                setNotice: (text) => pushToast(text, text === "Email sent." ? "success" : (text.startsWith("Email queued") || text.startsWith("Email scheduled")) ? "info" : "error"),
                confirm: (message) => confirm(message),
              });
            }}
          />
        )}
        {teach && (
          <TeachDialog
            api={api}
            mail={teach}
            busy={busy}
            onClose={() => setTeach(null)}
            onSave={(input) =>
              void perform(async () => {
                await api("/rules", "POST", input);
                setTeach(null);
              }, "Sorting updated for this sender.")
            }
          />
        )}
        {snooze && (
          <SnoozeMenu
            {...snooze}
            busy={busy}
            onClose={closeSnooze}
            onSnooze={(until) => void perform(async () => {
              const result = await api<LocalMailActionResponse>(`/messages/${encodeURIComponent(snooze.mail.id)}`, "PATCH", { action: "snooze", until });
              setSnooze(null);
              if (selectedId === snooze.mailId) setOpened(false);
              return result;
            }, `Email snoozed until ${new Date(until).toLocaleString()}.`, result => result.undo)}
            onUnsnooze={() => void perform(async () => {
              const result = await api<LocalMailActionResponse>(`/messages/${encodeURIComponent(snooze.mail.id)}`, "PATCH", { action: "unsnooze" });
              setSnooze(null);
              return result;
            }, "Email returned to inbox.", result => result.undo)}
          />
        )}
        {trashMail && (
          <TrashDialog
            busy={busy}
            syncing={syncing}
            onConfirm={() => void moveToTrash(trashMail)}
            onClose={() => { if (!trashLock.current) setTrashMail(null); }}
          />
        )}
        {shortcuts && <ShortcutsDialog shortcut={shortcut} onClose={() => setShortcuts(false)} />}
      </div>
    </PrivacyContext.Provider></MailSearchApiContext.Provider>
  );
}
