import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { JSDOM } from "jsdom";
import { defaults } from "./interaction";
import { compileMailSearch } from "./mail-search";
import { savedViewSchema, type SavedView } from "../shared/saved-views";
import type { Draft, Mail, State } from "../shared/types";
import { generatePalette, parseThemeFile, serializeThemeFile, type CustomTheme } from "./themes";

let closeMountedApp: (() => Promise<void>) | undefined;
afterEach(async () => { await closeMountedApp?.(); });

test("window opacity applies immediately, persists and disables with transparency off", async () => {
  const app = await mount(true, undefined, { platform: "darwin", materials: true });
  let saved = "";
  try {
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    const input = app.window.document.querySelector<HTMLInputElement>('#window-opacity')!;
    assert.equal(input.disabled, false);
    await app.input(input, "35");
    assert.equal(app.window.document.documentElement.style.getPropertyValue("--glass-opacity"), "35%");
    assert.equal(app.container.querySelector('.opacity-label output')?.textContent, "35%");
    saved = app.storage.getItem("emc2.appearance.v1")!;
    assert.equal(JSON.parse(saved).glassOpacity, 35);
    await app.click(themeButton(app, "Off"));
    assert.equal(input.disabled, true);
    await app.click(themeButton(app, "Glass"));
    assert.equal(input.disabled, false);
    assert.equal(input.value, "35");
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
  const restarted = await mount(true, (_state, storage) => storage.setItem("emc2.appearance.v1", saved), { platform: "darwin", materials: true });
  try {
    assert.equal(restarted.window.document.documentElement.style.getPropertyValue("--glass-opacity"), "35%");
  } finally { await restarted.close(); }
});

async function mount(native = false, setup?: (state: State, storage: Storage) => void, bridge: Partial<NonNullable<Window["desktop"]>> | boolean = {}, fixtureDrafts: Draft[] = [], viewportWidth?: number, keepLocation = false) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/" });
  dom.window.HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y || 0 : options?.top ?? this.scrollTop;
    this.dispatchEvent(new dom.window.Event("scroll"));
  };
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const globals = {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    location: dom.window.location, history: dom.window.history, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
    IS_REACT_ACT_ENVIRONMENT: true,
    confirm: () => true,
  };
  const previous = new Map(Object.keys(globals).map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const makeMail = (id: string, subject: string, accountId = "a", category: Mail["category"] = "important"): Mail => ({
    id, subject, accountId, category, remoteId: id, sender: "Sender", address: "sender@example.com",
    to: "reader@example.com", preview: subject, body: subject, date: 1000, unread: true,
    relevance: 2, reason: "", archived: false, snoozedUntil: null,
    html: null, images: [{ src: "https://images.example.com/photo.png", alt: "Photo" }], attachments: [],
  });
  const state: State = {
    accounts: [{ id: "a", email: "first@example.com", provider: "imap" },
      { id: "b", email: "second@example.com", provider: "imap" }],
    messages: [makeMail("a:1", "Alpha"), makeMail("a:2", "Beta"),
      makeMail("b:1", "Gamma", "b"),
      // Gmail files this one under Promotions, so it sits in a second Inbox tab.
      { ...makeMail("a:3", "Other message", "a", "other"), labelIds: ["CATEGORY_PROMOTIONS"] }],
    labels: [], rules: [], googleConfigured: false, googleClientId: null, jevConfigured: false,
    jevProvider: "typesafe", aiConfigured: false, lastSync: null, syncing: false,
  };
  setup?.(state, dom.window.localStorage);
  let changed: (() => void) | undefined;
  let navigate: ((direction: "back" | "forward") => void) | undefined;
  let subscriptions = 0;
  const desktop: NonNullable<Window["desktop"]> = {
    platform: native ? "linux" : "darwin", materials: false, oauthUrl: "", windowCommand() {},
    onWindowState: () => () => {}, onAccountConnected: () => () => {},
    onMailChanged: (callback) => { changed = callback; return () => { changed = undefined; }; },
    onNavigation: (callback) => {
      subscriptions++; navigate = callback;
      return () => { subscriptions--; navigate = undefined; };
    },
    ...(typeof bridge === "object" ? bridge : {}),
  };
  if (bridge === true) desktop.updates = {
    state: async () => ({ phase: "current" }),
    command: async () => { throw new Error("Opening update details must not issue a command"); },
    onState: () => () => {}, onDrain: () => () => {},
  };
  (dom.window as unknown as Window).desktop = desktop;
  if (viewportWidth !== undefined) {
    delete (dom.window as unknown as Window).desktop;
    dom.window.matchMedia = ((query: string) => ({ matches: /min-width: (\d+)px/.test(query) ? viewportWidth >= Number(query.match(/min-width: (\d+)px/)![1]) : false, media: query, onchange: null, addListener() {}, removeListener() {}, dispatchEvent() { return true; }, addEventListener() {}, removeEventListener() {} })) as typeof dom.window.matchMedia;
  }
  const previousFetch = globalThis.fetch;
  const mutations: string[] = [];
  const requests: string[] = [];
  let savedViews: SavedView[] = [];
  const renames: unknown[] = [];
  let renameFails = false;
  let composePreferencesFail = false;
  let composeSaveWait: Promise<void> | undefined;
  let releaseComposeSave: (() => void) | undefined;
  let composeSaveRequests = 0;
  let savedDraft: Draft | undefined;
  let draftSaveFails = false;
  let readWait: Promise<void> | undefined;
  let releaseRead: (() => void) | undefined;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith("/api/saved-views")) {
      const body = JSON.parse(String(options?.body || "{}"));
      const id = url.split("/").at(-1);
      if (options?.method === "POST") {
        const view = savedViewSchema.parse({ ...body, id: "00000000-0000-4000-8000-000000000057", revision: 1 });
        savedViews.push(view);
        return Response.json(view);
      }
      if (options?.method === "PATCH") {
        const view = savedViewSchema.parse({ ...savedViews.find(view => view.id === id), ...body, revision: body.revision + 1 });
        savedViews = savedViews.map(current => current.id === id ? view : current);
        return Response.json(view);
      }
      if (options?.method === "DELETE") { savedViews = savedViews.filter(view => view.id !== id); return Response.json({ ok: true }); }
      return Response.json(savedViews);
    }
    if (url === "/api/compose-preferences" && options?.method === "PUT") {
      composeSaveRequests++;
      await composeSaveWait;
      if (composePreferencesFail) return { ok: false, json: async () => ({ error: "Synthetic save failure" }) } as Response;
      const preferences = JSON.parse(String(options.body));
      if (Object.keys(preferences.signatures).some(id => !state.accounts.some(account => account.id === id)))
        return { ok: false, json: async () => ({ error: "Choose a connected account for each signature." }) } as Response;
      state.composePreferences = preferences;
      return { ok: true, json: async () => state.composePreferences } as Response;
    }
    if (url.startsWith("/api/accounts/") && options?.method === "DELETE") {
      const id = decodeURIComponent(url.slice("/api/accounts/".length));
      state.accounts = state.accounts.filter(account => account.id !== id);
      state.messages = state.messages.filter(mail => mail.accountId !== id);
      if (state.composePreferences) state.composePreferences = { ...state.composePreferences,
        signatures: Object.fromEntries(Object.entries(state.composePreferences.signatures).filter(([accountId]) => accountId !== id)) };
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.startsWith("/api/messages/search?")) {
      const search = compileMailSearch(new URL(url, "http://localhost").searchParams.get("query") || "", state.accounts);
      return { ok: true, json: async () => ({ mailCursor: "synthetic:0", draftToken: state.draftToken ?? "synthetic-drafts", error: search.error,
        matches: [...state.messages.filter(search.matches).map(mail => ({ kind: "mail", id: mail.id, accountId: mail.accountId, contentVersion: "synthetic" })),
          ...fixtureDrafts.filter(draft => { const account = state.accounts.find(a => a.id === draft.accountId); return account && search.matchesDraft(draft, account); }).map(({ body, attachments, ...draft }) => ({ ...draft, kind: "draft", preview: body.slice(0, 200), attachmentCount: attachments?.length || 0 }))] }) } as Response;
    }
    if (url.endsWith("/forward") && options?.method === "POST") {
      const mail = state.messages.find(mail => url === `/api/messages/${encodeURIComponent(mail.id)}/forward`)!;
      return { ok: true, json: async () => ({ id: "forwarded-draft", accountId: mail.accountId, revision: 1, updatedAt: 1,
        to: [], subject: `Fwd: ${mail.subject}`, body: "Synthetic forwarded text", sendUnknown: false }) } as Response;
    }
    if (url.includes("/drafts/") && (!options?.method || options.method === "GET")) return { ok: true, json: async () => fixtureDrafts.find(draft => url.endsWith(`/drafts/${draft.id}`)) } as Response;
    if (url.endsWith("/drafts") && (!options?.method || options.method === "GET")) return { ok: true, json: async () => fixtureDrafts.filter(draft => url.includes(`/accounts/${draft.accountId}/`)).map(({ body, attachments, ...draft }) => ({ ...draft, preview: body.slice(0, 200), attachmentCount: attachments?.length || 0 })) } as Response;
    if (url.includes("/drafts") && ["POST", "PUT"].includes(options?.method || "")) {
      if (draftSaveFails) return { ok: false, json: async () => ({ error: "Synthetic draft save failure" }) } as Response;
      savedDraft = { ...JSON.parse(String(options?.body)), id: "synthetic-draft", accountId: url.split("/")[3],
        revision: (savedDraft?.revision || 0) + 1, updatedAt: 1 };
      return { ok: true, json: async () => savedDraft } as Response;
    }
    if (options?.method === "PATCH" && url.startsWith("/api/accounts/")) {
      const body = JSON.parse(String(options.body));
      renames.push({ url, body });
      if (renameFails) return { ok: false, json: async () => ({ error: "Synthetic rename failure" }) } as Response;
      const account = state.accounts.find(account => url.endsWith(encodeURIComponent(account.id)))!;
      if (body.name) account.name = body.name;
      else delete account.name;
    } else if (options?.method === "PATCH") {
      mutations.push(url);
      const mail = state.messages.find((mail) => url.endsWith(encodeURIComponent(mail.id)));
      await readWait;
      if (mail) mail.unread = false;
    }
    return { ok: true, json: async () => url === "/api/state" ? { ...state, csrf: "synthetic" } :
      url === "/api/contacts" ? { saved: [], recent: [] } :
      url === "/api/workspace" ? { commitments: [], projects: [], decisions: [], proposals: [], coverage: [] } :
      url === "/api/agent/grants" ? [] : url === "/api/mcp" ? {enabled:false,allowSending:false,token:null} :
      url === "/api/sync" ? { errors: [] } : {} } as Response;
  };
  const { createRoot } = await import("react-dom/client");
  const { App } = await import("./App");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await act(async () => root.unmount());
    } finally {
      dom.window.close();
      globalThis.fetch = previousFetch;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      closeMountedApp = undefined;
    }
    assert.equal(subscriptions, 0);
    assert.equal(changed, undefined);
  };
  closeMountedApp = close;
  await act(async () => root.render(<App />));
  if (!keepLocation) await act(async () => { const inbox = [...container.querySelectorAll<HTMLButtonElement>(".sidebar button")].find((button) => button.textContent?.trim().startsWith("Inbox")); inbox?.click(); });
  const button = (label: string): HTMLButtonElement => {
    if (label === "Filter accounts") return accountButtons().find(item => item.getAttribute("aria-pressed") === "true")!;
    const found = [...container.querySelectorAll<HTMLButtonElement>(".settings-navigation button"), ...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.getAttribute("aria-label") === label || button.textContent?.trim() === label || button.querySelector(".sidebar-name, .tab-label")?.textContent === label || [...button.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join("").trim() === label);
    assert.ok(found, `button ${label}`);
    return found;
  };
  const click = async (target: HTMLElement) => { await act(async () => target.click()); };
  // The filter controls live in a popover behind the Filters button.
  const openFilters = async () => {
    const toggle = button("Filters");
    if (toggle.getAttribute("aria-expanded") !== "true") await click(toggle);
  };
  const choose = async (label: string, value: string) => {
    if (label !== "Filter accounts" && !container.querySelector(`[aria-label="${label}"]`)) await openFilters();
    if (label === "Filter accounts") { await click(account(value)); return; }
    await click(button(label));
    const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.trim() === value);
    assert.ok(option, `option ${value}`);
    await click(option);
  };
  const accountButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Filter accounts"] button[aria-pressed]')];
  const account = (name: string) => {
    const found = accountButtons().find((item) => item.querySelector(".sidebar-name")?.textContent === name);
    assert.ok(found, `account ${name}`);
    return found;
  };
  const activeAccount = () => accountButtons().find((item) => item.getAttribute("aria-pressed") === "true")
    ?.querySelector(".sidebar-name")?.textContent;
  const back = () => button("Back");
  const forward = () => button("Forward");
  const open = async (id: string) => {
    const row = container.querySelector<HTMLElement>(`[id='mail-${id}']`)!;
    assert.ok(row);
    await click(row);
    await act(async () => row.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })));
  };
  const mouse = async (side: number) => {
    const events = ["mousedown", "mouseup", "auxclick"].map((type) =>
      new dom.window.MouseEvent(type, { button: side, bubbles: true, cancelable: true }));
    await act(async () => { for (const event of events) dom.window.dispatchEvent(event); });
    assert.ok(events.every((event) => event.defaultPrevented));
  };
  const key = async (key: string, options: KeyboardEventInit = {}) => {
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, ...options })));
  };
  const input = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = field.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    if (field.closest(".search")) await act(async () => { await new Promise(resolve => setTimeout(resolve, 135)); });
  };
  return { state, storage: dom.window.localStorage, window: dom.window, container, button, click, choose, openFilters, account, activeAccount, accountButtons, back, forward, open, mouse, key, input, mutations, requests,
    renames, failRename: (value: boolean) => { renameFails = value; },
    failComposePreferences: (value: boolean) => { composePreferencesFail = value; },
    composeSaveRequests: () => composeSaveRequests,
    holdComposeSave: () => { composeSaveWait = new Promise<void>((resolve) => { releaseComposeSave = resolve; }); },
    finishComposeSave: async () => { await act(async () => { releaseComposeSave?.(); await composeSaveWait; composeSaveWait = undefined; }); },
    title: () => container.querySelector(".message h1")?.textContent,
    native: async (direction: "back" | "forward") => { await act(async () => navigate?.(direction)); },
    refresh: async () => { await act(async () => changed?.()); },
    menu: async (id: string) => {
      const row = container.querySelector<HTMLElement>(`[id='mail-${id}']`)!;
      await act(async () => row.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    },
    subscriptions: () => subscriptions,
    holdRead: () => { readWait = new Promise<void>((resolve) => { releaseRead = resolve; }); },
    finishRead: async () => { await act(async () => { releaseRead?.(); await readWait; readWait = undefined; }); },
    savedDraft: () => savedDraft,
    failDraftSave: (value: boolean) => { draftSaveFails = value; },
    close,
  };
}

function themeButton(app: Awaited<ReturnType<typeof mount>>, label: string): HTMLButtonElement {
  const document = app.window.document;
  const scope = document.querySelector('[role="dialog"]:not([aria-label="Settings"])') ?? app.container;
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === label || button.getAttribute("aria-label") === label);
  assert.ok(button, `theme button ${label}`);
  return button;
}

const sampleTheme = (): CustomTheme => ({
  id: `custom:${crypto.randomUUID()}`, name: "Nightfall", palettes: {
    dark: generatePalette("#1a1b26", "#7aa2f7", "dark"),
    light: generatePalette("#eef0f8", "#3456bc", "light"),
  },
});

test("theme dialogs retain edits and block Back/Forward until closed", async () => {
  const theme = sampleTheme();
  const app = await mount(true, (_state, storage) => storage.setItem("emc2.appearance.v1", JSON.stringify({ theme: theme.id, customThemes: [theme] })));
  try {
    const document = app.window.document;
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(app.button("Accounts"));
    await app.native("back");
    for (const action of ["Create theme", "Edit theme", "Import theme", "Delete theme"]) {
      const opener = themeButton(app, action);
      await act(async () => opener.focus());
      await app.click(opener);
      const dialog = document.querySelector('[role="dialog"]:not([aria-label="Settings"])')!;
      const color = dialog.querySelector<HTMLInputElement>('[aria-label="Background hex"]');
      if (color) await app.input(color, "#123456");
      for (const direction of ["back", "forward"] as const) {
        await app.native(direction);
        await app.key(direction === "back" ? "ArrowLeft" : "ArrowRight", { altKey: true });
        assert.equal(dialog.isConnected, true, `${action} must survive ${direction}`);
        assert.equal(app.container.querySelector(".settings h1")?.textContent, "Appearance");
        if (color) assert.equal(color.value, "#123456");
      }
      await app.click(themeButton(app, "Cancel"));
      assert.equal(document.activeElement === opener, true, `${action} restores its Settings opener after the portal closes`);
    }
    await app.native("forward");
    assert.equal(app.container.querySelector(".settings h1")?.textContent, "Accounts", "closing restores navigation");
    await app.native("back");
    assert.equal(app.container.querySelector(".settings h1")?.textContent, "Appearance");
  } finally { await app.close(); }
});

for (const mac of [false, true]) test(`${mac ? "Cmd" : "Ctrl"}+K cannot stack Commands over a theme dialog`, async () => {
  const theme = sampleTheme();
  const app = await mount(!mac, (_state, storage) => storage.setItem("emc2.appearance.v1", JSON.stringify({ theme: theme.id, customThemes: [theme] })));
  try {
    const document = app.window.document;
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    for (const action of ["Create theme", "Edit theme", "Import theme", "Delete theme"]) {
      await app.click(themeButton(app, action));
      const dialog = document.querySelector('[role="dialog"]:not([aria-label="Settings"])')!;
      await app.key("k", mac ? { metaKey: true } : { ctrlKey: true });
      assert.equal(document.querySelectorAll('[role="dialog"]:not([aria-label="Settings"])').length, 1, action);
      assert.ok(document.querySelector('[role="dialog"][aria-label="Settings"]'), "Settings stays beneath its child dialog");
      assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), dialog);
      if (mac) {
        await app.key("[", { metaKey: true });
        await app.key("]", { metaKey: true });
        assert.equal(dialog.isConnected, true);
      }
      await app.key("Escape");
      assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), null);
    }
    await app.key("k", mac ? { metaKey: true } : { ctrlKey: true });
    assert.equal(document.querySelector('[aria-label="Search commands"]'), null, "Settings remains modal after its child closes");
    await app.click(app.button("Close settings"));
    await app.key("k", mac ? { metaKey: true } : { ctrlKey: true });
    assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])')?.getAttribute("aria-label"), "Commands", "closing restores Commands");
  } finally { await app.close(); }
});

test("custom theme preview cancels without saving; both palettes persist through an App restart", async () => {
  const app = await mount();
  let saved = "";
  try {
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(app.button("Midnight"));
    const before = app.storage.getItem("emc2.appearance.v1");
    const document = app.window.document;
    const root = document.documentElement;
    await app.click(themeButton(app, "Create theme"));
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!, "#202530");
    assert.equal(root.style.getPropertyValue("--bg"), "#202530");
    const color = document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!;
    await app.input(color, "#123");
    assert.equal(color.value, "#123", "shorthand must not interrupt typing a six-digit color");
    await app.input(color, "#1234");
    assert.equal(color.getAttribute("aria-invalid"), "true");
    await app.click(themeButton(app, "Save theme"));
    assert.ok(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), "invalid colors block saving");
    await app.input(color, "#123456");
    assert.equal(root.style.getPropertyValue("--bg"), "#123456");
    assert.equal(app.storage.getItem("emc2.appearance.v1"), before);
    await app.key("Escape");
    assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), null);
    assert.equal(root.style.getPropertyValue("--bg"), "");
    assert.equal(root.dataset.theme, "midnight");
    assert.equal(app.storage.getItem("emc2.appearance.v1"), before);

    await app.click(themeButton(app, "Create theme"));
    await app.input(document.querySelector<HTMLInputElement>('.theme-name input')!, "Nightfall");
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!, "#202530");
    await app.click(themeButton(app, "Light"));
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!, "#eef0f8");
    assert.equal(root.dataset.scheme, "light");
    await app.click(themeButton(app, "Save theme"));
    assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), null);
    assert.equal(root.dataset.scheme, "dark", "saving returns to the selected appearance mode");
    assert.equal(root.style.getPropertyValue("--bg"), "#202530");
    saved = app.storage.getItem("emc2.appearance.v1")!;
    const value = JSON.parse(saved);
    assert.equal(value.customThemes.length, 1);
    assert.equal(value.customThemes[0].palettes.light.canvas, "#eef0f8");
    assert.equal(value.theme, value.customThemes[0].id);
    await app.click(app.button("Close settings"));
    assert.equal(root.style.getPropertyValue("--bg"), "#202530");
    assert.equal(app.mutations.length, 0, "theme work never mutates mail");
  } finally { await app.close(); }
  const restarted = await mount(false, (_state, storage) => storage.setItem("emc2.appearance.v1", saved));
  try {
    assert.equal(restarted.window.document.documentElement.style.getPropertyValue("--bg"), "#202530");
    await restarted.click(restarted.button("Settings"));
    await restarted.click(restarted.button("Appearance"));
    assert.equal(restarted.button("Nightfall").getAttribute("aria-checked"), "true");
    await restarted.click(themeButton(restarted, "Light"));
    assert.equal(restarted.window.document.documentElement.style.getPropertyValue("--bg"), "#eef0f8");
  } finally { await restarted.close(); }
});

test("edit, duplicate, rename conflicts and confirmed deletion preserve independent themes", async () => {
  const original = sampleTheme();
  const app = await mount(false, (_state, storage) => storage.setItem("emc2.appearance.v1", JSON.stringify({ theme: original.id, customThemes: [original] })));
  try {
    const document = app.window.document;
    const read = () => JSON.parse(app.storage.getItem("emc2.appearance.v1")!);
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(themeButton(app, "Edit theme"));
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Links hex"]')!, "#00ccaa");
    await app.click(themeButton(app, "Save theme"));
    assert.equal(read().customThemes[0].palettes.dark.link, "#00ccaa");
    await app.click(themeButton(app, "Duplicate theme"));
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!, "#323232");
    await app.click(themeButton(app, "Save theme"));
    assert.equal(read().customThemes.length, 2);
    assert.notEqual(read().customThemes[0].id, read().customThemes[1].id);
    assert.equal(read().customThemes[0].palettes.dark.canvas, original.palettes.dark.canvas);
    assert.equal(read().customThemes[1].palettes.dark.canvas, "#323232");
    await app.click(themeButton(app, "Edit theme"));
    await app.input(document.querySelector<HTMLInputElement>('.theme-name input')!, "Nightfall");
    await app.click(themeButton(app, "Save theme"));
    assert.match(document.querySelector('[role="dialog"]:not([aria-label="Settings"]) [role="alert"]')!.textContent!, /already has this name/);
    assert.equal(read().customThemes[1].name, "Nightfall copy");
    await app.click(themeButton(app, "Cancel"));
    await app.click(themeButton(app, "Delete theme"));
    await app.click(themeButton(app, "Cancel"));
    assert.equal(read().customThemes.length, 2);
    await app.click(themeButton(app, "Delete theme"));
    await app.click(themeButton(app, "Delete theme"));
    assert.equal(read().customThemes.length, 1);
    assert.equal(read().theme, "black");
    assert.equal(document.documentElement.style.getPropertyValue("--bg"), "");
  } finally { await app.close(); }
});

test("JSON import validates before saving and export downloads a portable copy", async () => {
  const app = await mount();
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  let downloaded: Blob | undefined;
  let filename = "";
  let revoked = "";
  try {
    const document = app.window.document;
    URL.createObjectURL = (blob) => {
      assert.ok(blob instanceof Blob);
      downloaded = blob;
      return "blob:synthetic-theme";
    };
    URL.revokeObjectURL = (url) => { revoked = url; };
    app.window.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(themeButton(app, "Import theme"));
    await app.input(document.querySelector<HTMLTextAreaElement>("textarea")!, '{"version":2}');
    await app.click(themeButton(app, "Import theme"));
    assert.match(document.querySelector('[role="dialog"]:not([aria-label="Settings"]) [role="alert"]')!.textContent!, /Emc² version 1/);
    assert.equal(app.storage.getItem("emc2.appearance.v1"), null);
    const theme = sampleTheme();
    await app.input(document.querySelector<HTMLTextAreaElement>("textarea")!, serializeThemeFile(theme));
    await app.click(themeButton(app, "Import theme"));
    assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), null);
    const imported = JSON.parse(app.storage.getItem("emc2.appearance.v1")!).customThemes[0];
    assert.notEqual(imported.id, theme.id);
    await app.click(themeButton(app, "Export theme"));
    assert.equal(filename, "nightfall.emc2-theme.json");
    assert.ok(downloaded);
    assert.deepEqual(parseThemeFile(await downloaded.text()), { name: theme.name, palettes: theme.palettes });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(revoked, "blob:synthetic-theme");
    await app.click(themeButton(app, "Import theme"));
    await app.input(document.querySelector<HTMLTextAreaElement>("textarea")!, await downloaded.text());
    await app.click(themeButton(app, "Import theme"));
    const themes = JSON.parse(app.storage.getItem("emc2.appearance.v1")!).customThemes;
    assert.deepEqual(themes.map((item: CustomTheme) => item.name), ["Nightfall", "Nightfall (2)"]);
    assert.notEqual(themes[0].id, themes[1].id);
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    await app.close();
  }
});

test("failed theme saves keep the editor and draft available and Cancel restores the saved appearance", async () => {
  const app = await mount();
  try {
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(app.button("Midnight"));
    const saved = app.storage.getItem("emc2.appearance.v1");
    Object.defineProperty(app.window.Storage.prototype, "setItem", { configurable: true, value() { throw new Error("quota"); } });
    await app.click(themeButton(app, "Create theme"));
    await app.input(app.window.document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!, "#202530");
    await app.click(themeButton(app, "Save theme"));
    assert.ok(app.window.document.querySelector('[role="dialog"]:not([aria-label="Settings"])'));
    assert.match(app.window.document.querySelector('[role="dialog"]:not([aria-label="Settings"]) [role="alert"]')!.textContent!, /could not be saved/);
    assert.equal(app.storage.getItem("emc2.appearance.v1"), saved);
    await app.click(themeButton(app, "Cancel"));
    assert.equal(app.window.document.documentElement.dataset.theme, "midnight");
    assert.equal(app.window.document.documentElement.style.getPropertyValue("--bg"), "");
  } finally { await app.close(); }
});

test("theme file input reads bounded files and ignores a read completed after Cancel", async () => {
  const app = await mount();
  try {
    const document = app.window.document;
    const exported = serializeThemeFile(sampleTheme());
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(themeButton(app, "Import theme"));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x".repeat(65537)], "large.json")] });
    await act(async () => input.dispatchEvent(new app.window.Event("change", { bubbles: true })));
    assert.match(document.querySelector('[role="dialog"]:not([aria-label="Settings"]) [role="alert"]')!.textContent!, /64 KB/);
    Object.defineProperty(input, "files", { configurable: true, value: [new File([exported], "theme.json")] });
    await act(async () => input.dispatchEvent(new app.window.Event("change", { bubbles: true })));
    assert.equal(document.querySelector<HTMLTextAreaElement>("textarea")!.value, exported);
    await app.click(themeButton(app, "Import theme"));
    const saved = app.storage.getItem("emc2.appearance.v1");
    await app.click(themeButton(app, "Import theme"));
    let finish = (_text: string) => {};
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const nextInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(nextInput, "files", { value: [{ size: 100, text: () => pending }] });
    await act(async () => nextInput.dispatchEvent(new app.window.Event("change", { bubbles: true })));
    assert.ok(themeButton(app, "Reading file…").disabled);
    await app.click(themeButton(app, "Cancel"));
    await act(async () => { finish(exported); await pending; });
    assert.equal(document.querySelector('[role="dialog"]:not([aria-label="Settings"])'), null);
    assert.equal(app.storage.getItem("emc2.appearance.v1"), saved);
  } finally { await app.close(); }
});

test("a full theme library keeps editing available and the theme picker supports keyboard wrapping", async () => {
  const themes = Array.from({ length: 32 }, (_, index) => ({ ...sampleTheme(), name: `Palette ${index + 1}` }));
  const app = await mount(false, (_state, storage) => storage.setItem("emc2.appearance.v1", JSON.stringify({ theme: themes[0].id, customThemes: themes })));
  try {
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    assert.ok(themeButton(app, "Create theme").disabled);
    assert.ok(themeButton(app, "Import theme").disabled);
    assert.ok(themeButton(app, "Duplicate theme").disabled);
    await app.click(themeButton(app, "Edit theme"));
    await app.input(app.window.document.querySelector<HTMLInputElement>('.theme-name input')!, "Renamed palette");
    await app.click(themeButton(app, "Save theme"));
    assert.equal(JSON.parse(app.storage.getItem("emc2.appearance.v1")!).customThemes.length, 32);
    const chosen = app.button("Renamed palette");
    chosen.focus();
    await act(async () => chosen.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    assert.equal(app.button("Black").getAttribute("aria-checked"), "true");
    assert.equal(app.window.document.activeElement, app.button("Black"));
    await act(async () => app.button("Black").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    assert.equal(app.button("Palette 32").getAttribute("aria-checked"), "true");
    assert.equal(app.window.document.activeElement, app.button("Palette 32"));
    assert.equal(app.container.querySelectorAll('.theme-choices [tabindex="0"]').length, 1);
  } finally { await app.close(); }
});

test("context menu Open navigates and marks read without a menu guard blocking it", async () => {
  const app = await mount();
  try {
    await app.menu("a:1");
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, 0);
    await app.click(app.container.querySelector<HTMLButtonElement>('[role="menuitem"]')!);
    assert.equal(app.title(), "Alpha");
    assert.equal(app.mutations.length, 1);
  } finally { await app.close(); }
});

test("Settings persist opening mode and custom keys while single-click opens and marks read once", async () => {
  const app = await mount();
  try {
    const first = app.container.querySelector<HTMLElement>("[id='mail-a:1']")!;
    await app.click(first);
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, 0);
    await app.click(app.button("Settings"));
    await app.click(app.button("Keyboard and mouse"));
    await app.click(app.button("Single click"));
    const search = [...app.container.querySelectorAll<HTMLInputElement>('[data-interaction-settings] input')]
      .find((input) => input.value === "/")!;
    search.focus();
    await act(async () => search.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "z", bubbles: true, cancelable: true })));
    assert.equal(search.value, "Z");
    assert.ok(app.container.querySelector('input[aria-describedby="mail-search-help"]'), "global search stays available");
    const saved = JSON.parse(app.storage.getItem("emc2.interaction.v1")!);
    assert.equal(saved.opening, "single"); assert.equal(saved.shortcuts.search.key, "z");
    const preferences = app.storage.getItem("emc2.interaction.v1");
    assert.equal(app.window.document.activeElement, search);
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
      { shiftKey: true }, { isComposing: true }, { repeat: true }]) {
      await act(async () => search.dispatchEvent(new app.window.KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true, ...options,
      })));
      assert.ok(app.container.querySelector(".settings"), "modified/repeated/composing Escape stays guarded");
    }
    const consumed = new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    await act(async () => search.dispatchEvent(consumed));
    assert.ok(app.container.querySelector(".settings"), "consumed Escape stays guarded");
    await act(async () => search.dispatchEvent(new app.window.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    assert.equal(app.container.querySelector(".settings"), null, "focused shortcut Escape closes Settings");
    assert.equal(app.storage.getItem("emc2.interaction.v1"), preferences, "Escape does not change a binding");
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, 0, "Escape does not run a mail action");
    assert.equal(app.container.querySelector('[role="dialog"]'), null);
    assert.ok(app.container.querySelector('input[aria-describedby="mail-search-help"]'), "global search stays available");
    const row = app.container.querySelector<HTMLElement>("[id='mail-a:1']")!;
    await act(async () => {
      row.dispatchEvent(new app.window.MouseEvent("click", { detail: 1, bubbles: true }));
      row.dispatchEvent(new app.window.MouseEvent("click", { detail: 2, bubbles: true }));
      row.dispatchEvent(new app.window.MouseEvent("dblclick", { detail: 2, bubbles: true }));
    });
    assert.equal(app.title(), "Alpha"); assert.equal(app.mutations.length, 1);
    await app.key("ArrowLeft", { altKey: true });
    assert.equal(app.title(), undefined);
    await app.key("ArrowRight", { altKey: true });
    assert.equal(app.title(), "Alpha"); assert.equal(app.mutations.length, 1);
    await app.key("Escape");
    await app.key("f");
    assert.ok(app.container.querySelector('input[aria-describedby="mail-search-help"]'));
  } finally { await app.close(); }
});

test("privacy removes connected recipient names and addresses from list, headers, body and attributes", async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("privacy", "on");
    state.messages[0] = { ...state.messages[0], to: '"Nora Lane" <first@example.com>',
      cc: "Kai Rivers <second@example.com>", subject: "For Nora Lane", preview: "Hello Nora and Kai",
      body: "Hello Nora Lane", reason: "Priority for Nora Lane",
      html: '<table style="background-color:#fff;color:#222"><tbody><tr><td>Hello <b>Nora</b> Lane and Kai first<span>@example.com<img src="https://images.example.com/photo.png" alt="Nora Lane first@example.com" title="Nora Lane" aria-label="Nora Lane"></span></td></tr><tr><td><a href="https://example.com/?name=Nora%2520Lane" title="Nora Lane">Private destination</a><img src="https://images.example.com/?to=first%40example.com" alt="Nora Lane"></td></tr></tbody></table>' };
  });
  try {
    const assertHidden = () => {
      const markup = app.container.innerHTML;
      for (const value of ["Nora", "Lane", "Kai", "first@example.com", "second@example.com", "%2520", "%40"])
        assert.ok(!markup.includes(value), `hidden ${value} must not be in markup`);
    };
    assertHidden();
    await app.open("a:1");
    assertHidden();
    await app.key("b"); assert.ok(app.container.querySelector('[role="menu"]'));
    assertHidden(); await app.key("Escape");
    assert.equal(app.container.querySelector(".message-body img"), null);
    assert.equal(app.button("Show images").disabled, false);
    await app.click(app.button("Show images"));
    assert.equal(app.container.querySelectorAll(".message-body img").length, 1);
    assertHidden();
    assert.ok(app.container.querySelector('[aria-label="Image unavailable while personal information is hidden."]'));
    await app.click(app.button("Hide images"));
    assert.equal(app.container.querySelector(".message-body img"), null);
    assert.ok(app.container.querySelector(".formatted-mail table"));
    const control = app.container.querySelector(".image-controls")!;
    const body = app.container.querySelector(".message-body")!;
    assert.ok(control.compareDocumentPosition(body) & 4, "Show images precedes body");
    await app.click(app.button("Show personal information"));
    assert.ok(app.container.textContent?.includes("Nora"));
    await app.click(app.button("Show images"));
    assert.equal(app.container.querySelectorAll(".message-body img").length, 2);
    assert.equal(app.container.querySelectorAll(".message-images figure").length, 0, "formatted images are not duplicated");
    await app.key("p");
    assertHidden(); assert.equal(app.container.querySelector(".message-body img"), null);
    await app.click(app.button("Show images"));
    assert.equal(app.container.querySelectorAll(".message-body img").length, 1);
    assertHidden();
    await app.click(app.back()); await app.click(app.forward());
    assert.equal(app.container.querySelector(".message-body img"), null, "history return requires new consent in privacy mode");
    assert.equal(app.button("Show images").disabled, false);
  } finally { await app.close(); }
});

test("formatted privacy keeps image order and keyboard reveal across image boundaries", async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("privacy", "on");
    state.messages[0] = { ...state.messages[0], to: '"Nora Lane" <first@example.com>',
      html: '<p>😀BEFORE <b>No<img src="https://images.example.com/first.png" alt="Nora Lane">ra</b> Lane BETWEEN first<span>@<img src="https://images.example.com/second.png" alt="first@example.com">example.com</span> AFTER<img src="https://images.example.com/?to=first%40example.com" alt="Nora Lane"> Separate Lane.</p>' };
  });
  try {
    await app.open("a:1");
    const body = app.container.querySelector<HTMLElement>(".message-body")!;
    const assertHidden = () => {
      for (const token of ["Nora", "Lane", "first@example.com", "%40"])
        assert.ok(!body.innerHTML.includes(token), token);
      for (const bar of body.querySelectorAll(".address.veiled")) {
        assert.equal(bar.textContent, "");
        assert.equal(bar.getAttribute("tabindex"), "0");
        assert.equal(bar.getAttribute("role"), "button");
      }
    };
    assertHidden();
    assert.equal(body.querySelector("img"), null);
    await app.click(app.button("Show images"));
    assertHidden();
    assert.equal(body.querySelectorAll("img").length, 2);
    assert.equal(body.querySelectorAll("[src]").length, 2);
    assert.ok(body.querySelector('[aria-label="Image unavailable while personal information is hidden."]'));
    const copy = body.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".formatted-mail-image-status").forEach((status) => status.remove());
    copy.querySelectorAll("img").forEach((image, index) => image.replaceWith(`[image${index + 1}]`));
    assert.match(copy.textContent || "", /😀BEFORE.*\[image1\].*BETWEEN.*\[image2\].*AFTER/s);
    const name = body.querySelector<HTMLElement>('[aria-label="Reveal hidden name"]')!;
    name.focus();
    await act(async () => name.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    assert.equal(app.window.document.activeElement, name);
    assert.match(body.textContent || "", /Nora Lane/);
    assert.ok(!body.innerHTML.includes("first@example.com"));
    assert.ok(body.textContent?.endsWith(" Separate ."), "revealing the full name leaves a separate surname hidden");
    await act(async () => name.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
    assertHidden();
    const address = body.querySelector<HTMLElement>('[aria-label="Reveal hidden address"]')!;
    await app.click(address);
    assert.match(body.textContent || "", /first@example.com/);
    assert.ok(!body.innerHTML.includes("Nora") && !body.innerHTML.includes("Lane"));
    await app.click(address);
    assertHidden();
    await app.click(app.button("Hide images"));
    assert.equal(body.querySelector("img"), null);
    await app.click(app.button("Show images"));
    assert.equal(body.querySelectorAll("img").length, 2);
    await app.key("Escape");
    assert.equal(app.container.querySelectorAll(".message").length, 0, "Escape closes the reader before reopening resets image consent");
    await app.open("a:1");
    assert.equal(app.container.querySelector(".message-body img"), null);
  } finally { await app.close(); }
});

for (const target of ["filter", "editor"]) {
  test(`privacy hides message-derived names and destinations in Gmail label ${target}`, async () => {
    const app = await mount(false, (state, storage) => {
      storage.setItem("privacy", "on");
      state.accounts[0].provider = "gmail";
      state.labels = [{ id: "private", accountId: "a", name: "Nora Lane", type: "user" }];
      state.messages[0] = { ...state.messages[0], to: "Nora Lane <first@example.com>",
        subject: "For Nora", preview: "Hello Lane", body: "Hello Nora Lane", labelIds: ["private"],
        html: '<p>Hello Nora Lane <a href="https://example.com/?name=Nora%2520Lane">Private destination</a></p>' };
    });
    try {
      await app.open("a:1");
      assert.ok(app.container.querySelector(".message-labels .veiled"), "reader label is hidden");
      const assertHidden = () => {
        for (const value of ["Nora", "Lane", "first@example.com", "second@example.com", "%2520"])
          assert.ok(!app.container.innerHTML.includes(value), `hidden ${value} must not be in markup`);
      };
      assertHidden();
      if (target === "filter") await app.openFilters();
      await app.click(app.button(target === "filter" ? "Filter by Gmail label" : "Edit labels"));
      assertHidden();
      if (target === "filter") {
        assert.equal(app.container.querySelectorAll('.label-filter [role="option"]').length, 2);
      } else {
        assert.ok(app.container.querySelector('[role="dialog"] .label-options .veiled'));
        assert.equal(app.container.querySelector<HTMLInputElement>('.label-options input')?.checked, true);
      }
      assert.equal(app.container.querySelector(".message-body a"), null, "private destination has no anchor");
      assert.equal(app.mutations.length, 1, "only read-on-open runs");
    } finally { await app.close(); }
  });
}

test("privacy hides one-character recipient names and encoded destinations in mounted mail", async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("privacy", "on");
    state.accounts[0].email = "reader@gmail.com";
    state.messages[0] = { ...state.messages[0], sender: "张 文", address: "reader@gmail.com", to: "张 文 <reader@gmail.com>",
      subject: "For 张", preview: "Hello 文", body: "Hello 张 and 文", reason: "Priority for 文",
      html: '<p>Hello <b>张</b> and 文 <a href="https://example.com/?name=%E5%BC%A0">Private destination</a> <a href="https://example.com/public">Public destination</a></p>' };
  });
  try {
    const assertHidden = () => {
      for (const value of ["张", "文", "reader@gmail.com", "%E5%BC%A0"])
        assert.ok(!app.container.innerHTML.includes(value), `hidden ${value} must not be in markup`);
      assert.equal(app.container.querySelector('[id="mail-a:1"] .avatar-letter')?.textContent ||
        app.container.querySelector('.message .avatar-letter')?.textContent, "·");
    };
    assertHidden();
    await app.open("a:1");
    assertHidden();
    assert.equal(app.container.querySelectorAll(".message-body a").length, 1);
    assert.equal(app.container.querySelector(".message-body a")?.getAttribute("href"), "https://example.com/public");
    await app.click(app.button("Show personal information"));
    assert.ok(app.container.textContent?.includes("张"));
    assert.ok(app.container.textContent?.includes("文"));
    assert.equal(app.container.querySelector('.message .avatar-letter')?.textContent, "张");
    assert.ok(app.container.querySelector('a[href="https://example.com/?name=%E5%BC%A0"]'));
    await app.key("p");
    assertHidden();
  } finally { await app.close(); }
});


test("unread navigation sends independent read requests while earlier reads are pending", async () => {
  const app = await mount();
  try {
    app.holdRead(); await app.open("a:1");
    assert.equal(app.title(), "Alpha"); assert.equal(app.mutations.length, 1);
    await app.key("j");
    assert.equal(app.title(), "Beta"); assert.equal(app.mutations.length, 2);
    await app.finishRead();
    assert.equal(app.state.messages.find((mail) => mail.id === "a:2")?.unread, false);
  } finally { await app.close(); }
});


test("empty and rejected formatting retain readable text and consent-controlled fallback images", async () => {
  for (const html of [null, "", "<script>discard</script>", "<br>".repeat(4001),
    "<html><head><style>p { color: red }</style></head><body><form><p>Discarded form</p></form></body></html>",
    "<div><span>   </span></div>", '<div><img src="javascript:invalid"></div>']) {
    const app = await mount(false, (state, storage) => {
      storage.setItem("privacy", "on");
      state.messages[0] = { ...state.messages[0], html, body: "First paragraph\n\nSecond paragraph" };
    });
    try {
      await app.open("a:1");
      assert.equal(app.container.querySelector(".message-body p")?.textContent, "First paragraph");
      assert.equal(app.container.querySelector(".message-images img"), null);
      await app.click(app.button("Show images"));
      assert.equal(app.container.querySelectorAll(".message-images figure img").length, 1);
      assert.equal(app.container.querySelectorAll(".message-body p").length, 2);
      await app.click(app.button("Hide images"));
      assert.equal(app.container.querySelector(".message-images img"), null);
      await app.click(app.button("Show images"));
      await app.key("Escape"); await app.open("a:1");
      assert.equal(app.container.querySelector(".message-images img"), null, "reopening requires fresh consent");
    } finally { await app.close(); }
  }
});

test("mounted cached-mail controls combine filters, retain the read-on-open reader and restore history", async () => {
  const app = await mount(false, (state) => {
    state.accounts[0].provider = "gmail";
    state.labels = [{ id: "team", accountId: "a", name: "Team", type: "user" }];
    state.messages[0] = { ...state.messages[0], relevance: 3, labelIds: ["team"], date: 30 };
    state.messages[1] = { ...state.messages[1], relevance: 1, labelIds: ["team"], date: 20 };
    state.messages[2] = { ...state.messages[2], relevance: 3, date: 40 };
  });
  const rows = () => [...app.container.querySelectorAll(".row")].map(row => row.id);
  try {
    assert.deepEqual(rows(), ["mail-b:1", "mail-a:1", "mail-a:2"]);
    await act(async () => app.container.querySelector<HTMLInputElement>('.app-search-toolbar input')!.focus());
    await app.input(app.container.querySelector<HTMLInputElement>(".search input")!, "ALPHA");
    await app.click(app.account("first@example.com"));
    await app.choose("Filter by Gmail label", "Team");
    await app.choose("Read status", "Unread");
    await app.choose("Relevance filter", "High relevance");
    await app.choose("Sort mail", "Oldest");
    assert.deepEqual(rows(), ["mail-a:1"]);
    await app.open("a:1");
    assert.equal(app.title(), "Alpha");
    assert.equal(app.state.messages[0].unread, false);
    assert.equal(app.button("Read status").textContent, "Unread");
    await app.refresh();
    assert.equal(app.title(), "Alpha", "automatic cache updates retain the opened reader");
    await app.choose("Sort mail", "Relevance");
    assert.equal(app.title(), undefined, "explicit sort change closes the reader");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); });
    assert.deepEqual(rows(), []);
    assert.match(app.container.querySelector(".empty")!.textContent!, /No matching mail/);
    await app.click(app.back());
    assert.equal(app.title(), undefined, "menu history restores its list");
    assert.equal(app.button("Sort mail").textContent, "Oldest");
    await app.click(app.forward());
    assert.equal(app.title(), undefined);
    const reset = app.button("Reset filters and sort");
    assert.equal(reset.textContent, "Reset filters and sort");
    await app.click(reset);
    assert.deepEqual(rows(), ["mail-a:3", "mail-b:1", "mail-a:1", "mail-a:2"]);
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "All cached");
    assert.equal(app.activeAccount(), "All accounts");
    for (const [label, value] of [["Read status", "All mail"],
      ["Relevance filter", "All relevance"], ["Sort mail", "Newest"], ["Filter by Gmail label", "All labels"]])
      assert.equal(app.button(label).textContent, value);
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")?.value, "");
    await app.click(app.back());
    assert.deepEqual(rows(), []);
    assert.equal(app.button("Sort mail").textContent, "Relevance");
    assert.equal(app.activeAccount(), "first@example.com");
    assert.equal(app.button("Read status").textContent, "Unread");
    assert.equal(app.button("Relevance filter").textContent, "High relevance");
    assert.equal(app.button("Filter by Gmail label").textContent, "Team");
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")?.value, "ALPHA");
    await app.choose("Read status", "All mail");
    assert.deepEqual(rows(), ["mail-a:1"]);
    await app.click(app.forward());
    assert.equal(app.button("Read status").textContent, "All mail", "new control visit truncates Forward");
    assert.equal(app.storage.length, 0, "mail filter history remains in memory");
  } finally { await app.close(); }
});

test("multiple IMAP accounts stay distinguishable and private, choose compose From and reuse Add account", async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("privacy", "on");
    state.accounts[1].error = "second@example.com connection failed";
  });
  try {
    const hidden = () => {
      for (const token of ["first@example.com", "second@example.com"])
        assert.ok(!app.container.innerHTML.includes(token), `${token} hidden in text and attributes`);
    };
    assert.equal(app.accountButtons().length, 3);
    hidden();
    await app.click(app.account("Account 2 · Custom IMAP"));
    assert.equal(app.activeAccount(), "Account 2 · Custom IMAP");
    assert.ok(app.account("Account 2 · Custom IMAP").nextElementSibling?.matches(".account-warning"));
    hidden();
    assert.deepEqual([...app.container.querySelectorAll(".row")].map(row => row.id), ["mail-b:1"]);
    await app.key("c");
    assert.match(app.container.querySelector('.compose-from-row [role="combobox"]')!.textContent!, /Account 2/);
    await app.key("Escape");
    await app.click(app.button("Add account"));
    assert.equal(app.container.querySelector('[role="dialog"] h2')?.textContent, "Connect account");
    assert.ok(app.container.querySelector(".provider-row"), "existing provider choice is reused");
    assert.ok(app.accountButtons().every((item) => item.disabled));
    await app.key("Escape");
    await app.click(app.button("Show personal information"));
    assert.ok(app.account("first@example.com"));
    assert.ok(app.account("second@example.com").nextElementSibling?.matches(".account-warning"));
    assert.equal(app.mutations.length, 0, "filter and setup entry do not mutate mail");
  } finally { await app.close(); }
});

test("sidebar account choices close the reader, keep history and leave number shortcuts working", async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    await app.click(app.account("first@example.com"));
    assert.equal(app.activeAccount(), "first@example.com");
    assert.equal(app.title(), undefined);
    await app.click(app.back());
    assert.equal(app.title(), undefined, "account history returns to its list");
    await app.click(app.account("second@example.com"));
    assert.equal(app.title(), undefined);
    assert.equal(app.container.querySelector(".row.selected")?.id, "mail-b:1");
    await app.key("0");
    assert.equal(app.activeAccount(), "All accounts", "number shortcuts still work");
  } finally { await app.close(); }
});

test("mounted Oldest and Relevance controls reorder cached rows and history restores the sort", async () => {
  const app = await mount(false, (state) => {
    state.messages[0] = { ...state.messages[0], date: 30, relevance: 1 };
    state.messages[1] = { ...state.messages[1], date: 20, relevance: 3 };
    state.messages[2] = { ...state.messages[2], date: 10, relevance: 2 };
  });
  const rows = () => [...app.container.querySelectorAll(".row")].map(row => row.id);
  try {
    assert.deepEqual(rows(), ["mail-a:1", "mail-a:2", "mail-b:1"]);
    await app.choose("Sort mail", "Oldest");
    assert.deepEqual(rows(), ["mail-b:1", "mail-a:2", "mail-a:1"]);
    await app.choose("Sort mail", "Relevance");
    assert.deepEqual(rows(), ["mail-a:2", "mail-b:1", "mail-a:1"]);
    assert.equal(app.container.querySelector(".group"), null, "date groups do not interrupt relevance ordering");
    await app.click(app.back());
    assert.equal(app.button("Sort mail").textContent, "Oldest");
    assert.deepEqual(rows(), ["mail-b:1", "mail-a:2", "mail-a:1"]);
    await app.click(app.forward());
    assert.equal(app.button("Sort mail").textContent, "Relevance");
    assert.deepEqual(rows(), ["mail-a:2", "mail-b:1", "mail-a:1"]);
  } finally { await app.close(); }
});

test("Unread reader navigation keeps the opened message as an ordering anchor", async () => {
  const scenarios = [
    { sort: "Newest", opened: "a:2", key: "j", expected: "Gamma" },
    { sort: "Newest", opened: "b:1", key: "k", expected: "Beta" },
    { sort: "Oldest", opened: "a:2", key: "j", expected: "Alpha" },
    { sort: "Relevance", opened: "a:2", key: "j", expected: "Gamma" },
    { sort: "Newest", opened: "b:1", key: "j", expected: "Gamma" },
    { sort: "Newest", opened: "a:1", key: "k", expected: "Alpha" },
  ];
  for (const scenario of scenarios) {
    const app = await mount(false, (state) => {
      state.messages[0] = { ...state.messages[0], date: 30, relevance: 3 };
      state.messages[1] = { ...state.messages[1], date: 20, relevance: 2 };
      state.messages[2] = { ...state.messages[2], date: 10, relevance: 1 };
    });
    try {
      await app.choose("Read status", "Unread");
      await app.choose("Sort mail", scenario.sort);
      await app.open(scenario.opened);
      assert.equal(app.state.messages.find(mail => mail.id === scenario.opened)?.unread, false);
      await app.key(scenario.key);
      assert.equal(app.title(), scenario.expected, JSON.stringify(scenario));
      await app.key("Escape");
      assert.ok(!app.container.querySelector(`[id="mail-${scenario.opened}"]`), "read anchor stays out of the Unread list");
    } finally { await app.close(); }
  }
});

test("sidebar destinations have distinct decorative navigation glyphs", async () => {
  const app = await mount(false, (state) => { state.messages[0].snoozedUntil = Date.now() + 86400000; });
  try {
    const labels = ["Today", "Calendar", "Projects", "Agent review", "Contacts", "Inbox", "Snoozed", "Archive", "Sent", "All cached", "Drafts"];
    const glyphs = labels.map((label) => {
      const button = app.button(label);
      assert.ok(button.closest("#sidebar"), `${label} belongs in the sidebar`);
      if (label === "Drafts") {
        const icon = button.querySelector<HTMLElement>(".drafts-mark");
        assert.ok(icon, "Drafts has an icon");
        assert.ok(icon.style.maskImage.includes("drafts.png"), "Drafts uses the rebuild's envelope icon");
        assert.equal(icon.getAttribute("aria-hidden"), "true");
        return icon.style.maskImage;
      }
      const svg = button.querySelector("svg");
      assert.ok(svg, `${label} has an icon`);
      assert.equal(svg.getAttribute("width"), "16");
      assert.equal(svg.getAttribute("height"), "16");
      assert.equal(svg.getAttribute("stroke"), "currentColor");
      assert.equal(svg.getAttribute("color"), "currentColor");
      assert.equal(svg.getAttribute("aria-hidden"), "true");
      assert.equal(svg.getAttribute("focusable"), "false");
      return svg.innerHTML;
    });
    assert.equal(new Set(glyphs).size, labels.length, "each sidebar destination has a distinct rendered glyph");
  } finally { await app.close(); }
});

test("the rebuild account footer follows the filter, preserves privacy and opens existing settings", async () => {
  const app = await mount();
  try {
    const footer = () => app.container.querySelector<HTMLElement>(".sidebar-account-card")!;
    assert.match(footer().textContent!, /All accounts.*2 connected accounts/);
    await app.click(footer());
    assert.equal(app.button("Accounts").getAttribute("aria-current"), "page");
    await app.click(app.button("Appearance"));
    await app.click(app.button("Close settings"));
    await app.click(footer());
    assert.equal(app.button("Accounts").getAttribute("aria-current"), "page", "All accounts ignores the last Settings section");
    await app.click(app.button("Close settings"));
    await app.click(app.button("first@example.com"));
    assert.match(footer().textContent!, /first@example.com/);
    await app.click(app.button("Hide personal information"));
    assert.doesNotMatch(footer().outerHTML, /first@example.com|second@example.com/);
    assert.match(footer().textContent!, /Account 1/);
    assert.ok(footer().getAttribute("aria-label")?.includes("Account 1"), "the accessible name includes the visible privacy-safe account label");
    await app.click(footer());
    assert.equal(app.button("Accounts").getAttribute("aria-current"), "page");
    assert.ok(app.container.querySelector(".settings"));
    assert.equal(app.mutations.length, 0, "account summary only navigates");
  } finally { await app.close(); }
});

test("the rebuild footer opens Accounts with no connected accounts", async () => {
  const app = await mount(false, state => { state.accounts = []; state.messages = []; });
  try {
    const footer = app.container.querySelector<HTMLButtonElement>(".sidebar-account-card")!;
    assert.match(footer.textContent!, /Connect an account/);
    await app.click(footer);
    assert.equal(app.button("Accounts").getAttribute("aria-current"), "page");
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
});

test("sidebar toggle stays first in its header, hides the panel and survives a restart", async () => {
  const app = await mount();
  try {
    assert.equal(app.container.querySelector(".sidebar-head")?.firstElementChild, app.button("Hide sidebar"));
    assert.equal(app.container.querySelector('.app-toolbar [aria-controls="sidebar"]'), null);
    await app.click(app.button("Hide sidebar"));
    assert.equal(app.container.querySelector(".app-toolbar")?.firstElementChild, app.button("Show sidebar"));
    // The panel stays mounted so it can animate closed, but leaves the focus order.
    assert.ok(app.container.querySelector(".sidebar.closed[inert]"));
    assert.equal(app.window.localStorage.getItem("sidebar"), "closed");
    await app.click(app.button("Show sidebar"));
    assert.equal(app.container.querySelector(".sidebar.closed, .sidebar[inert]"), null);
    await app.click(app.button("Settings"));
    await app.click(app.button("Hide sidebar"));
    assert.equal(app.container.querySelector(".app-toolbar")?.firstElementChild, app.button("Show sidebar"));
  } finally { await app.close(); }
  const restarted = await mount(false, (_state, storage) => storage.setItem("sidebar", "closed"));
  try {
    assert.ok(restarted.container.querySelector(".sidebar.closed[inert]"));
  } finally { await restarted.close(); }
});

test("Settings keeps mail navigation, uses a section rail and shows one section at a time", async () => {
  const app = await mount();
  try {
    const settings = app.button("Settings");
    const footer = settings.closest(".sidebar-footer");
    assert.ok(footer, "Settings belongs beside Sync at the bottom of the sidebar");
    assert.ok(footer.querySelector(".sync"));
    assert.ok(settings.querySelector("svg"));
    assert.equal(settings.textContent, "", "Settings uses the requested gear-only footer");
    assert.equal(settings.getAttribute("aria-label"), "Settings");
    await app.click(settings);
    assert.ok(app.container.querySelector('[aria-label="Mail views"]'), "mail navigation remains visible");
    assert.equal(app.container.querySelectorAll(".settings-navigation button").length, 11);
    const rail = app.container.querySelector('.settings-navigation')!;
    assert.deepEqual([...rail.querySelectorAll('[role="group"]')].map(group => group.getAttribute('aria-label')),
      ["Connections", "Mail", "Preferences", "Advanced"]);
    assert.equal(new Set([...rail.querySelectorAll('button')].map(button => button.textContent)).size, 11,
      "each existing section remains reachable once");
    assert.equal(app.container.querySelector(".settings-column select"), null);
    assert.ok(app.container.querySelector("[data-interaction-settings]"));
    await app.click(app.button("Appearance"));
    assert.equal(app.container.querySelector("[data-interaction-settings]"), null);
    await app.click(app.container.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Purple"]')!);
    assert.equal(app.window.document.documentElement.style.getPropertyValue("--accent"), "#a78bfa");
    assert.equal(JSON.parse(app.window.localStorage.getItem("emc2.appearance.v1")!).accent, "purple");
    await app.click(app.button("Close settings"));
    assert.ok(app.container.querySelector('[aria-label="Mail views"]'));
  } finally { await app.close(); }
});

test("side by side keeps the list beside the opened email; full width opens it in place", async () => {
  const split = await mount();
  try {
    assert.ok(split.container.querySelector(".workspace.split .reader-pane"), "side by side reserves the reader before opening mail");
    await split.open("a:1");
    assert.equal(split.title(), "Alpha");
    assert.ok(split.container.querySelector(".reader-pane .message"));
    assert.ok(split.container.querySelector("[id='mail-a:2']"), "the list stays beside the reader");
    assert.equal(split.container.querySelector(".reader-pane .mail-actions")?.getAttribute("aria-label"), "Opened email actions");
    await split.click(split.button("Close email"));
    assert.equal(split.title(), undefined);
    assert.ok(split.container.querySelector(".workspace.split .reader-pane"), "closing keeps the saved side-by-side layout");
  } finally { await split.close(); }
  const full = await mount(false, (_state, storage) =>
    storage.setItem("emc2.appearance.v1", JSON.stringify({ reading: "full" })));
  try {
    assert.equal(full.container.querySelector(".reader-pane"), null);
    await full.open("a:1");
    assert.equal(full.title(), "Alpha");
    assert.equal(full.container.querySelector("[id='mail-a:2']"), null, "the email replaces the list");
  } finally { await full.close(); }
});

test("side by side uses one column on narrow screens", async () => {
  const app = await mount(false, undefined, {}, [], 760);
  try {
    assert.equal(app.container.querySelector(".reader-pane"), null);
    await app.open("a:1");
    assert.equal(app.title(), "Alpha");
    assert.equal(app.container.querySelector(".reader-pane"), null);
    assert.equal(app.container.querySelector("[id='mail-a:2']"), null, "narrow reading replaces the list");
    await app.click(app.button("Close email"));
    assert.ok(app.container.querySelector("[id='mail-a:2']"));
  } finally { await app.close(); }
});

test("compose preferences survive Settings navigation, close and failed save", async () => {
  const app = await mount();
  try {
    await app.click(app.button("Settings"));
    await app.click(app.button("Templates and signatures"));
    const signature = () => app.container.querySelector<HTMLTextAreaElement>(".compose-settings textarea")!;
    await app.input(signature(), "A retained signature");
    await app.click(app.button("Notifications"));
    await app.click(app.button("Templates and signatures"));
    assert.equal(signature().value, "A retained signature");
    await app.click(app.button("Close settings"));
    await app.click(app.button("Settings"));
    await app.click(app.button("Templates and signatures"));
    assert.equal(signature().value, "A retained signature");
    app.failComposePreferences(true);
    await act(async () => app.container.querySelector(".compose-settings")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(signature().value, "A retained signature");
    assert.match(app.container.querySelector(".compose-settings [role=alert]")?.textContent || "", /edits are kept/);
    app.failComposePreferences(false);
    await act(async () => app.container.querySelector(".compose-settings")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(app.state.composePreferences?.signatures.a, "A retained signature");
    await app.click(app.button("Notifications"));
    await app.click(app.button("Templates and signatures"));
    assert.equal(signature().value, "A retained signature");
  } finally { await app.close(); }
});

for (const fails of [false, true]) test(`compose save stays locked across Settings navigation and ${fails ? "failure" : "success"}`, async () => {
  const app = await mount();
  try {
    await app.click(app.button("Settings")); await app.click(app.button("Templates and signatures"));
    const signature = () => app.container.querySelector<HTMLTextAreaElement>(".compose-settings textarea")!;
    const save = () => app.container.querySelector<HTMLButtonElement>('.compose-settings button[type="submit"]')!;
    await app.input(signature(), "First save");
    app.holdComposeSave(); app.failComposePreferences(fails);
    await app.click(save());
    assert.equal(app.composeSaveRequests(), 1);
    await app.click(app.button("Accounts")); await app.click(app.button("Templates and signatures"));
    assert.equal(save().disabled, true, "pending save survives section remount");
    await app.click(app.button("Close settings")); await app.click(app.button("Settings"));
    await app.click(app.button("Templates and signatures"));
    assert.equal(save().disabled, true, "pending save survives Settings close and reopen");
    assert.equal(signature().value, "First save");
    await act(async () => { app.container.querySelector(".compose-settings")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(app.composeSaveRequests(), 1, "remounted form cannot start an overlapping request");
    await app.finishComposeSave();
    assert.equal(save().disabled, false, "settled save unlocks the remounted form");
    assert.equal(signature().value, "First save", "success or failure preserves the submitted edits");
    if (fails) assert.match(app.container.textContent || "", /Could not save templates and signatures. Your edits are kept/);
    app.failComposePreferences(false);
    await app.input(signature(), "Second save"); await app.click(save());
    assert.equal(app.composeSaveRequests(), 2);
    assert.equal(app.state.composePreferences?.signatures.a, "Second save");
    await app.click(app.button("Accounts")); await app.click(app.button("Templates and signatures"));
    assert.equal(signature().value, "Second save");
  } finally { await app.finishComposeSave(); await app.close(); }
});

test("retained compose preferences stay savable after disconnecting an account", async () => {
  const app = await mount(false, state => {
    state.composePreferences = { templates: [{ id: "greeting", name: "Greeting", subject: "Hello", body: "Saved text" }], signatures: { a: "Removed account signature", b: "Keep this signature" } };
  });
  try {
    await app.click(app.button("Settings")); await app.click(app.button("Templates and signatures"));
    await app.click(app.button("Greeting"));
    const body = () => [...app.container.querySelectorAll("label")].find(label => label.firstChild?.textContent === "Template body")!.querySelector<HTMLTextAreaElement>("textarea")!;
    await app.input(body(), "Keep these unsaved template edits");
    await app.click(app.button("Accounts"));
    await app.click(app.button("Disconnect"));
    assert.deepEqual(app.state.accounts.map(account => account.id), ["b"]);
    await app.click(app.button("Templates and signatures")); await app.click(app.button("Greeting"));
    assert.equal(body().value, "Keep these unsaved template edits");
    await act(async () => app.container.querySelector(".compose-settings")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(app.container.querySelector(".compose-settings [role=alert]")?.textContent, undefined, "removed signatures must not block saving");
    assert.deepEqual(app.state.composePreferences?.signatures, { b: "Keep this signature" });
    assert.equal(app.state.composePreferences?.templates[0].body, "Keep these unsaved template edits");
  } finally { await app.close(); }
});

test("filters open as a popover that Escape closes, and the button stays lit while filtered", async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    await app.choose("Read status", "Unread");
    assert.ok(app.container.querySelector('[role="dialog"][aria-label="Mail filters and sort"]'));
    await app.key("Escape");
    assert.equal(app.container.querySelector('[aria-label="Mail filters and sort"]'), null);
    assert.equal(app.button("Filters").getAttribute("aria-expanded"), "false");
    assert.ok(app.container.querySelector(".filter-dot"), "a filtered list keeps the button lit");
    assert.equal(app.container.querySelector(".mail-filters"), null, "no filter row under the header");
  } finally { await app.close(); }
});

test("desktop mail rows use a native context menu and run the chosen action", async () => {
  const menus: { items: { id: string; label: string; enabled: boolean; separator?: boolean }[]; position?: { x: number; y: number } }[] = [];
  const app = await mount(false, undefined, {
    mailMenu: async (items, position) => { menus.push({ items, position }); return "archive"; },
  });
  try {
    await app.menu("a:1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(app.container.querySelector('[role="menu"]'), null, "no drawn menu on the desktop");
    assert.deepEqual(menus[0].items.map((item) => item.label),
      ["Open", "Mark as read", "Mark as unread", "Move to Inbox", "Pin email", "Reply", "Reply all", "Forward message", "Archive", "Snooze", "Move to Trash", "Track work", "Schedule meeting", "Teach sorting"]);
    assert.deepEqual(menus[0].items.filter((item) => item.separator).map((item) => item.id), ["reply", "archive", "teach"]);
    assert.ok(app.mutations.some((url) => url.endsWith(encodeURIComponent("a:1"))), "the chosen action ran");
  } finally { await app.close(); }
});

test("sidebar sections fold away and stay folded after a restart", async () => {
  const app = await mount();
  try {
    await app.click(app.button("Accounts"));
    assert.equal(app.accountButtons().length, 0);
    assert.equal(app.button("Accounts").getAttribute("aria-expanded"), "false");
  } finally { await app.close(); }
  const restarted = await mount(false, (_state, storage) => storage.setItem("sidebar-folded", JSON.stringify(["accounts"])));
  try {
    assert.equal(restarted.accountButtons().length, 0);
    await restarted.click(restarted.button("Accounts"));
    assert.ok(restarted.accountButtons().length > 0);
  } finally { await restarted.close(); }
});

test("initial reader Back and Forward restore the latest reader without traversal visits", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    assert.equal(app.back().disabled, false);
    await app.click(app.back());
    assert.equal(app.title(), undefined);
    assert.equal(app.back().disabled, false, "the initial Actions visit remains reachable");
    await app.click(app.forward());
    assert.equal(app.title(), "Alpha");
    await app.key("j");
    await app.click(app.button("Next email"));
    assert.equal(app.title(), "Gamma");
    await app.click(app.button("Show images"));
    await app.click(app.back());
    assert.equal(app.title(), undefined);
    assert.equal(app.back().disabled, false, "Actions remains the only earlier menu visit");
    await app.click(app.forward());
    assert.equal(app.title(), "Gamma");
    assert.ok(app.button("Show images"), "restoring a reader requires fresh image consent");
    await app.click(app.back());
    await app.open("a:2");
    await app.key("Escape");
    assert.equal(app.forward().disabled, true, "opening another reader clears the previous return");
    await app.open("a:1");
    await app.click(app.back());
    await app.click(app.button("Promotions"));
    assert.equal(app.forward().disabled, true, "a new menu visit clears the reader return");
  } finally { await app.close(); }
});


test("mouse side buttons leave and restore an initial reader while dialogs guard both directions", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    await app.mouse(3);
    assert.equal(app.title(), undefined);
    await app.mouse(4);
    assert.equal(app.title(), "Alpha");
    for (const shortcut of ["m", "b", "?"]) {
      await app.key(shortcut);
      assert.ok(app.container.querySelector(shortcut === "b" ? '[role="menu"]' : '[role="dialog"]'));
      await app.mouse(3); await app.mouse(4);
      assert.equal(app.title(), "Alpha");
      assert.ok(app.container.querySelector(shortcut === "b" ? '[role="menu"]' : '[role="dialog"]'));
      await app.key("Escape");
    }
    await app.mouse(3);
    assert.equal(app.title(), undefined);
    await app.mouse(4);
    assert.equal(app.title(), "Alpha");
  } finally { await app.close(); }
});


test("menu history restores view, account, search and Settings without restoring readers", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    assert.ok(!app.back().disabled && app.forward().disabled, "Inbox follows the initial Actions visit");
    await app.open("a:1");
    await app.key("j");
    assert.equal(app.title(), "Beta");
    assert.ok(!app.back().disabled, "an opened reader can return to its list");
    await app.key("Escape");
    assert.ok(!app.back().disabled, "closing email preserves the earlier Actions visit");
    await app.click(app.button("Promotions"));
    await app.choose("Filter accounts", "first@example.com");
    await act(async () => app.container.querySelector<HTMLInputElement>('.app-search-toolbar input')!.focus());
    const search = app.container.querySelector<HTMLInputElement>(".search input")!;
    await app.input(search, "Other"); await app.input(search, "Other message");
    await app.click(app.button("Settings"));
    assert.ok(app.container.querySelector(".settings"));
    assert.ok(!app.back().disabled, "history remains reachable in Settings");
    await app.click(app.back());
    assert.equal(app.container.querySelector(".settings"), null);
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")?.value, "Other message");
    assert.equal(app.activeAccount(), "All accounts", "first nonempty search enters global scope");
    await app.open("a:3");
    assert.equal(app.title(), "Other message");
    await app.key("Escape");
    assert.ok(!app.forward().disabled, "opening and closing do not clear Forward");
    await app.click(app.forward());
    assert.ok(app.container.querySelector(".settings"));
    await app.mouse(3);
    assert.equal(app.title(), undefined);
    await app.mouse(3);
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")?.value, "", "search keystrokes form one visit");
    await app.mouse(4);
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")?.value, "Other message");
    await app.click(app.back());
    await app.click(app.button("Archive"));
    assert.ok(app.forward().disabled, "new menu navigation truncates Forward");
    await app.choose("Filter accounts", "second@example.com");
    await app.click(app.button("Settings"));
    app.state.accounts = app.state.accounts.filter(account => account.id !== "b");
    await app.refresh(); await app.click(app.back());
    assert.equal(app.activeAccount(), "All accounts", "missing accounts resolve to All");
    assert.equal(app.title(), undefined);
    assert.equal(app.storage.length, 0, "history is memory-only");
  } finally { await app.close(); }
});



test("reader buttons reuse unread anchors, edge guards and image resets without history visits", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.choose("Read status", "Unread");
    await app.click(app.button("Settings")); await app.click(app.back());
    await app.open("a:1");
    assert.equal(app.button("Previous email").disabled, true);
    await app.click(app.button("Show images"));
    await app.click(app.button("Next email"));
    assert.equal(app.title(), "Beta");
    assert.ok(app.button("Show images"));
    assert.ok(!app.forward().disabled, "reader buttons preserve menu Forward");
    await app.click(app.button("Next email"));
    assert.equal(app.title(), "Gamma");
    assert.equal(app.button("Next email").disabled, true);
    await app.click(app.button("Reply"));
    assert.equal(app.button("Previous email").disabled, true);
    assert.equal(app.button("Next email").disabled, true);
  } finally { await app.close(); }
});


test("updater Escape dismisses only update details and preserves reader focus", { timeout: 10000 }, async () => {
  const app = await mount(false, undefined, true);
  try {
    await app.open("a:1");
    const trigger = app.container.querySelector<HTMLButtonElement>("[aria-controls='update-details']")!;
    trigger.focus();
    await app.click(trigger);
    assert.ok(app.container.querySelector("#update-details"));
    const escape = new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => trigger.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, true);
    assert.equal(app.container.querySelector("#update-details"), null);
    assert.equal(app.title(), "Alpha");
    assert.ok(app.window.document.activeElement === trigger, "focus returns to the updater icon");
    await app.key("Escape");
    assert.equal(app.title(), undefined, "the next Escape still closes the reader");
  } finally { await app.close(); }
});


test("updater Escape from Search preserves Search and the opened reader", { timeout: 10000 }, async () => {
  const app = await mount(false, undefined, true);
  try {
    await app.open("a:1");
    await app.key("/");
    const search = app.container.querySelector<HTMLInputElement>("input[aria-describedby='mail-search-help']")!;
    assert.ok(search);
    const trigger = app.container.querySelector<HTMLButtonElement>("[aria-controls='update-details']")!;
    await app.click(trigger);
    search.focus();
    const escape = new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => search.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, true);
    assert.equal(app.container.querySelector("#update-details"), null);
    assert.equal(app.title(), "Alpha");
    assert.ok(search.isConnected, "Escape leaves Search open beneath the dismissed panel");
    assert.ok(app.window.document.activeElement === trigger, "focus returns to the updater icon");
  } finally { await app.close(); }
});


test("reader button traversal keeps focus in the reader so Tab preserves the mail view", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    for (const [label, title] of [["Next email", "Beta"], ["Previous email", "Alpha"]]) {
      if (label === "Previous email") await app.key("j");
      const button = app.button(label);
      button.focus();
      await app.click(button);
      const reader = app.container.querySelector<HTMLElement>(".message")!;
      assert.equal(app.title(), title);
      assert.ok(app.window.document.activeElement === reader, "focus stays inside the replacement reader");
      const tab = new app.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      await act(async () => reader.dispatchEvent(tab));
      assert.equal(tab.defaultPrevented, false);
      assert.equal(app.title(), title);
      assert.ok(app.container.querySelector('.sidebar-group button.active')?.textContent?.includes("Inbox"));
      const action = app.container.querySelector<HTMLButtonElement>('[aria-label="Opened email actions"] [aria-label="Reply"]')!;
      action.focus();
      const key = new app.window.KeyboardEvent("keydown", { key: title === "Beta" ? "k" : "j", bubbles: true, cancelable: true });
      await act(async () => action.dispatchEvent(key));
      const nextReader = app.container.querySelector<HTMLElement>(".message")!;
      assert.ok(app.window.document.activeElement === nextReader, "j/k moves focus off the replaced reader action");
      const nextTitle = title === "Beta" ? "Alpha" : "Beta";
      assert.equal(app.title(), nextTitle);
      const afterKeyTab = new app.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      await act(async () => nextReader.dispatchEvent(afterKeyTab));
      assert.equal(afterKeyTab.defaultPrevented, false);
      assert.equal(app.title(), nextTitle);
      assert.ok(app.container.querySelector('.sidebar-group [aria-current="page"]')?.textContent?.includes("Inbox"));
    }
  } finally { await app.close(); }
});



test("private rename confirms saving and displays the custom account label", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.click(app.button("Hide personal information"));
    await app.click(app.button("Settings"));
    await app.click(app.button("Accounts"));
    await app.click(app.button("Rename"));
    const form = app.container.querySelector<HTMLFormElement>(".account-name-form")!;
    const input = form.querySelector<HTMLInputElement>("input")!;
    await act(async () => input.focus());
    await app.input(input, "Work inbox");
    await act(async () => input.blur());
    assert.equal(input.value, "", "blur hides the private draft without discarding it");
    await app.click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    assert.equal(app.state.accounts[0].name, "Work inbox");
    assert.match(app.container.querySelector(".toast-text")?.textContent || "", /^Account name saved\.$/);
    assert.match(app.container.querySelector(".settings")!.textContent!, /Work inbox/);
    await app.key("p");
    assert.match(app.container.querySelector(".settings")!.textContent!, /Work inbox/, "the saved name appears when privacy is off");
  } finally { await app.close(); }
});


test("Settings rename persists through PATCH and reload, clears to email, cancels and retains failed input", { timeout: 10000 }, async () => {
  const app = await mount();
  const form = () => app.container.querySelector<HTMLFormElement>(".account-name-form")!;
  const submit = async () => { await act(async () => form().dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }))); };
  try {
    await app.click(app.button("Settings")); await app.click(app.button("Accounts")); await app.click(app.button("Rename"));
    assert.equal(form().querySelector<HTMLInputElement>("input")!.maxLength, 80);
    await app.input(form().querySelector("input")!, "  Personal inbox  "); await submit();
    assert.deepEqual(app.renames, [{ url: "/api/accounts/a", body: { name: "Personal inbox" } }]);
    assert.equal(app.state.accounts[0].name, "Personal inbox");
    assert.match(app.container.querySelector(".settings")!.textContent!, /Personal inbox/); assert.equal(form(), null);
    await app.click(app.button("Rename")); await app.input(form().querySelector("input")!, "Discarded");
    await app.click(app.button("Cancel")); assert.equal(app.renames.length, 1);
    await app.click(app.button("Rename")); await app.input(form().querySelector("input")!, "Keep this name");
    app.failRename(true); await submit();
    assert.equal(form().querySelector<HTMLInputElement>("input")!.value, "Keep this name");
    assert.match(form().querySelector('[role="alert"]')!.textContent!, /Could not rename/);
    assert.equal(app.state.accounts[0].name, "Personal inbox");
    app.failRename(false); await app.input(form().querySelector("input")!, "x".repeat(81)); await submit();
    assert.deepEqual(app.renames.at(-1), { url: "/api/accounts/a", body: { name: "x".repeat(80) } });
    await app.click(app.button("Rename")); await app.input(form().querySelector("input")!, "   "); await submit();
    assert.equal(app.state.accounts[0].name, undefined); assert.match(app.container.querySelector(".settings")!.textContent!, /first@example.com/);
  } finally { await app.close(); }
});


test("custom account labels remain visible in privacy while addresses and unfocused edit values are hidden", { timeout: 10000 }, async () => {
  const app = await mount(false, (state, storage) => { state.accounts[0].name = "Private Identity"; storage.setItem("privacy", "on"); });
  try {
    const hidden = () => {
      assert.doesNotMatch(app.container.innerHTML, /first@example.com|second@example.com/);
      assert.match(app.container.textContent!, /Private Identity/);
    };
    hidden(); await app.click(app.button("Hide sidebar")); hidden();
    await app.click(app.button("Show sidebar"));
    await app.click(app.button("Settings")); await app.click(app.button("Accounts")); hidden();
    await app.click(app.button("Rename")); hidden();
    const input = app.container.querySelector<HTMLInputElement>(".account-name-form input")!;
    await act(async () => input.focus()); assert.equal(input.value, "Private Identity");
    await act(async () => input.blur()); assert.equal(input.value, ""); hidden();
    await app.click(app.button("Cancel")); assert.equal(app.renames.length, 0);
    await app.click(app.button("Show personal information"));
    assert.match(app.container.textContent!, /Private Identity/);
  } finally { await app.close(); }
});


test("menu Back and Forward shortcuts work from focused sidebar controls", { timeout: 10000 }, async () => {
  const app = await mount();
  const historyKey = async (key: string) => {
    const target = app.window.document.activeElement!;
    assert.ok(target.closest("#sidebar"), "dispatch from the sidebar control that retained focus");
    const event = new app.window.KeyboardEvent("keydown", { key, altKey: true, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
  };
  try {
    for (const label of ["Archive", "second@example.com"]) {
      const control = app.button(label);
      await act(async () => control.focus()); await app.click(control);
      assert.equal(app.back().disabled, false);
      await historyKey("ArrowLeft");
      assert.equal(app.container.querySelector(".settings"), null);
      assert.equal(app.button("Inbox").getAttribute("aria-current"), "page");
      assert.equal(app.activeAccount(), "All accounts");
      await historyKey("ArrowRight");
      if (label === "Settings") assert.ok(app.container.querySelector(".settings"));
      else if (label === "Archive") assert.equal(app.button(label).getAttribute("aria-current"), "page");
      else assert.equal(app.activeAccount(), label);
      await historyKey("ArrowLeft");
    }
  } finally { await app.close(); }
});



test("text size works from filters, search and reply editors without changing density", { timeout: 10000 }, async () => {
  const app = await mount();
  const size = () => Number(app.container.querySelector<HTMLElement>(".app")!.style.getPropertyValue("--text-scale"));
  const send = async (target: HTMLElement, key: string) => {
    const event = new app.window.KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  try {
    await app.openFilters();
    const filter = app.button("Read status"); await act(async () => filter.focus());
    assert.equal(await send(filter, "-"), true); assert.equal(size(), 0.9);
    assert.equal(await send(filter, "+"), true); assert.equal(size(), 1);
    const search = app.container.querySelector<HTMLInputElement>(".search input")!;
    search.focus(); assert.equal(await send(search, "-"), true); assert.equal(size(), 0.9);
    await app.key("Escape"); await app.open("a:1"); await app.key("c");
    const textarea = app.container.querySelector<HTMLTextAreaElement>("textarea")!;
    assert.equal(await send(textarea, "+"), true); assert.equal(size(), 1);
    assert.equal(await send(textarea, "0"), true); assert.equal(size(), 1);
    assert.equal(app.container.querySelector(".list")!.classList.contains("compact"), false);
  } finally { await app.close(); }
});

for (const reading of ["split", "full"] as const) test(`3000-row ${reading} App window retains tail mail, navigation, actions and passive-scroll focus`, { timeout: 15000 }, async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("emc2.appearance.v1", JSON.stringify({ reading }));
    const sample = state.messages[0];
    state.messages = Array.from({ length: 3000 }, (_, index) => ({ ...sample,
      id: `window:${index}`, remoteId: String(index), subject: `Window message ${index}`,
      body: `Window message ${index}`, preview: `Window message ${index}`, unread: false,
      date: Date.now() - index * 1000, accountId: index % 2 ? "b" : "a",
    }));
  });
  const list = () => app.container.querySelector<HTMLElement>(".list")!;
  const bounded = () => assert.ok(app.container.querySelectorAll(".row").length < 60);
  const tail = async () => {
    const window = app.container.querySelector<HTMLElement>(".mail-window")!;
    assert.ok(window);
    await act(async () => list().scrollTo({ top: Math.max(0, parseFloat(window.style.height) - 600) }));
    bounded();
  };
  try {
    bounded();
    const first = app.container.querySelector<HTMLElement>('[id="mail-window:0"]')!;
    await act(async () => first.focus());
    await tail();
    assert.equal(app.window.document.activeElement, first, "ordinary scrolling preserves focused row");
    const tailTop = list().scrollTop;
    await app.refresh();
    assert.equal(list().scrollTop, tailTop, "refresh never snaps scrolling to selection");
    assert.ok(app.container.querySelector('[id="mail-window:2999"]'), "last message stays reachable");
    await app.open("window:2999"); assert.equal(app.title(), "Window message 2999");
    for (let index = 0; index < 31; index++) await app.key("k");
    assert.equal(app.title(), "Window message 2968", "reader navigation crosses the mounted viewport");
    await app.click(app.back()); bounded(); assert.ok(app.container.querySelector('[id="mail-window:2968"]'));
    await app.click(app.forward()); assert.equal(app.title(), "Window message 2968");
    await app.click(app.back());
    await app.key("j"); await app.key("Enter"); assert.equal(app.title(), "Window message 2969", "keyboard uses the full ordered data");
    await app.key("Escape");
    await app.key("d"); assert.ok(list().classList.contains("compact")); await tail();
    assert.ok(app.container.querySelector('[id="mail-window:2999"]'));
    await app.choose("Sort mail", "Oldest"); await app.key("Escape"); bounded();
    assert.ok(app.container.querySelector('[id="mail-window:2999"]'), "sort includes the tail of the original data");
    await app.choose("Filter accounts", "first@example.com"); await tail();
    assert.ok(app.container.querySelector('[id="mail-window:0"]'), "filtered sorted tail remains reachable");
    await app.choose("Filter accounts", "All accounts");
    await act(async () => app.container.querySelector<HTMLInputElement>('.app-search-toolbar input')!.focus());
    await app.input(app.container.querySelector<HTMLInputElement>(".search input")!, "Window message 2999");
    assert.equal(app.container.querySelectorAll(".row").length, 1, "search considers all cached messages");
    const row = app.container.querySelector<HTMLElement>(".mail-row")!;
    await act(async () => row.dispatchEvent(new app.window.MouseEvent("mouseover", { bubbles: true })));
    assert.ok(row.querySelector('[aria-label="More actions"]'), "offscreen mail retains its action when reached");
  } finally { await app.close(); }
});


for (const removed of ["message", "account"]) test(`Forward rejects a removed reader ${removed}`, { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.open("a:1"); await app.click(app.back());
    if (removed === "message") app.state.messages = app.state.messages.filter(mail => mail.id !== "a:1");
    else app.state.accounts = app.state.accounts.filter(account => account.id !== "a");
    await app.refresh(); await app.click(app.forward());
    assert.equal(app.title(), undefined);
    assert.ok(app.container.querySelector(".list"));
  } finally { await app.close(); }
});


test("privacy masks addresses embedded in custom account labels", { timeout: 10000 }, async () => {
  const app = await mount(false, (state, storage) => {
    state.accounts[0].name = "Work first@example.com";
    storage.setItem("privacy", "on");
  });
  try {
    assert.match(app.container.querySelector('[aria-label="Filter accounts"]')!.textContent!, /Work/);
    assert.doesNotMatch(app.container.innerHTML, /first@example.com|second@example.com/);
    await app.click(app.button("Settings")); await app.click(app.button("Accounts"));
    assert.match(app.container.querySelector(".settings")!.textContent!, /Work/);
    assert.doesNotMatch(app.container.innerHTML, /first@example.com|second@example.com/);
  } finally { await app.close(); }
});



test("reader history restores row focus from a removed reader and preserves focused controls", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    const reader = app.container.querySelector<HTMLElement>(".message")!;
    await act(async () => reader.focus());
    await app.mouse(3);
    assert.equal(app.window.document.activeElement?.id, "mail-a:1");
    await app.mouse(4);
    assert.equal(app.title(), "Alpha");
    assert.ok(app.window.document.activeElement?.closest(".message"));
    const control = app.back(); await act(async () => control.focus());
    await app.click(control);
    assert.equal(app.window.document.activeElement, control, "returning to the list preserves control focus");
  } finally { await app.close(); }
});

test("mounted App guards modal dialogs and uses one native side-button source with cleanup", { timeout: 10000 }, async () => {
  const app = await mount(true);
  try {
    await app.open("a:1");
    await app.click(app.button("Promotions"));
    assert.equal(app.subscriptions(), 1);
    await app.mouse(3);
    assert.equal(app.title(), undefined); // DOM delivery cannot duplicate Electron's command.
    await app.native("back");
    assert.equal(app.title(), undefined);
    await app.native("forward");
    assert.equal(app.title(), undefined);
    await app.native("back");
    await app.open("a:1");
    const mutations = app.mutations.length;
    for (const shortcut of ["m", "b", "?"]) {
      await app.key(shortcut);
      assert.ok(app.container.querySelector(shortcut === "b" ? '[role="menu"]' : '[role="dialog"]'));
      assert.ok(app.back().disabled && app.forward().disabled);
      await app.native("back");
      await app.native("forward");
      assert.equal(app.title(), "Alpha");
      await app.key("Escape");
    }
    await app.key("Escape");
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, mutations);
    await app.click(app.button("Settings"));
    await app.native("back");
    assert.equal(app.container.querySelector(".settings"), null);
    await app.native("forward");
    assert.ok(app.container.querySelector(".settings"));
    await app.native("back");
    assert.equal(app.title(), undefined);
    assert.ok(!app.back().disabled, "Actions is still reachable from the initial Inbox visit");
    await app.native("back");
    assert.ok(app.container.querySelector(".work-content"));
    assert.ok(app.back().disabled, "reader and dialog operations added no menu visits");
  } finally { await app.close(); }
});

test("menu history clears saved readers before resolving and never marks them read", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    await app.click(app.button("Archive"));
    app.state.messages.find(mail => mail.id === "a:1")!.unread = true;
    await app.refresh();
    const reads = app.mutations.length;
    await app.click(app.back());
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, reads, "returning to a menu never opens its saved reader");
    assert.equal(app.state.messages.find(mail => mail.id === "a:1")!.unread, true);
    await app.click(app.forward());
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, reads);
  } finally { await app.close(); }
});

test("global search leaves Settings for cached mail and Commands navigates to work views", { timeout: 10000 }, async () => {
  const app = await mount();
  try {
    const search = app.container.querySelector<HTMLInputElement>('.app-search-toolbar input')!;
    await act(async () => app.button("Settings").focus());
    await app.click(app.button("Settings"));
    assert.equal(app.container.querySelector('.app-search-toolbar input'), search);
    assert.ok(search.closest("[inert]"), "the background search is inert while Settings is open");
    await act(async () => app.button("Close settings").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })));
    assert.equal(app.window.document.activeElement === search, true, "Settings Search keeps focus after restoring its opener");
    await app.input(search, 'subject:Alpha');
    assert.equal(app.container.querySelector('.settings'), null);
    assert.equal(app.container.querySelector('.pane-title')?.textContent, 'All cached');
    assert.deepEqual([...app.container.querySelectorAll('.row')].map(row => row.id), ['mail-a:1']);
    assert.equal(app.mutations.length, 0, 'search does not mark mail read');
    await app.click(app.container.querySelector<HTMLButtonElement>('.commands-button')!);
    const commandSearch = app.container.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!;
    await app.input(commandSearch, 'Open Projects');
    await act(async () => commandSearch.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(app.container.querySelector('[role="dialog"]'), null);
    assert.equal(app.container.querySelector('.pane-title')?.textContent, 'Projects');
    assert.equal(app.container.querySelector('.app-search-toolbar input'), search);
    await app.click(app.button('Settings'));
    assert.ok(app.button('Inbox').closest('[inert]'));
    await app.click(app.button('Close settings'));
    await app.click(app.button('Inbox'));
    assert.equal(app.container.querySelector('.settings'), null, 'explicit close restores persistent mail navigation');
    assert.equal(app.container.querySelector('.pane-title')?.textContent, 'Inbox');
  } finally { await app.close(); }
});

test('V2 compact toolbar, text size, page keys and drafts navigation', async () => {
  const ui = await mount();
  try {
    assert.ok(ui.back().closest('.app-toolbar'), 'history belongs in the persistent toolbar');
    assert.equal(ui.container.querySelector('[aria-label="Sender context"]'), null);
    assert.equal(ui.container.querySelector('[aria-label="Sender details"]'), null, "no sender panel toggle");
    await ui.click(ui.container.querySelector<HTMLElement>("[id='mail-a:1']")!);
    assert.equal(ui.container.querySelector('[aria-label="Selected email actions"]'), null);
    await ui.key('PageDown');
    assert.equal(ui.container.querySelector('.row.selected')?.id, 'mail-a:2');
    await ui.open('a:1');
    await ui.key('PageDown'); assert.equal(ui.title(), 'Beta');
    await ui.key('PageUp'); assert.equal(ui.title(), 'Alpha');
    await ui.key('+', {ctrlKey:true});
    assert.equal(ui.container.querySelector<HTMLElement>('.app')?.style.getPropertyValue('--text-scale'), '1.1');
    await ui.key('-', {ctrlKey:true});
    assert.equal(ui.container.querySelector<HTMLElement>('.app')?.style.getPropertyValue('--text-scale'), '1');
    await ui.click(ui.button('Drafts'));
    assert.equal(ui.container.querySelector('.pane-title')?.textContent, 'Drafts');
    assert.equal(ui.container.querySelector('[role="dialog"]'), null);
  } finally { await ui.close(); }
});

test('pane tools live in the persistent toolbar and section controls share the title line', async () => {
  const ui = await mount();
  try {
    for (const label of ["Filters", "Hide personal information"]) {
      const control = ui.button(label);
      assert.ok(control.closest(".app-toolbar"), `${label} sits in the persistent toolbar`);
      assert.equal(control.closest(".main-head, .reader-head"), null, `${label} left the pane headers`);
    }
    const toolbar = ui.container.querySelector<HTMLElement>(".app-toolbar")!;
    const spacer = toolbar.querySelector<HTMLElement>(".update-spacer")!;
    assert.ok(spacer, "the toolbar reserves the update control's slot in the flow");
    const order = [...toolbar.children];
    assert.ok(order.indexOf(toolbar.querySelector(".pane-tools")!) < order.indexOf(spacer), "the update slot follows the pane tools");
    const lights = toolbar.querySelector(".traffic");
    if (lights) assert.equal(lights.previousElementSibling, spacer, "the update slot sits right before the window controls");
    const update = ui.container.querySelector<HTMLElement>(".app-update-control")!;
    assert.equal(update.closest(".frame"), null, "the update control stays usable while the frame is inert");
    const tabs = ui.container.querySelector(".inbox-tabs")!;
    assert.ok(tabs.parentElement?.classList.contains("mail-category-bar"), "categories span the working area");
    assert.equal(ui.container.querySelector(".mail-view-head"), null, "Inbox has no duplicated title row");
    assert.ok(ui.container.querySelector(".mail-view > h1")?.classList.contains("visually-hidden"), "Inbox keeps its accessible heading");
    assert.equal(ui.container.querySelectorAll(".inbox-tabs").length, 1, "one category strip");
    await ui.open("a:1");
    assert.ok(ui.container.querySelector(".reader-head"), "split layout shows the reader pane");
    for (const label of ["Filters", "Hide personal information"])
      assert.ok(ui.button(label).closest(".app-toolbar"), `${label} stays in the toolbar beside the reader`);
    assert.equal(ui.container.querySelector(".reader-head .pane-tools"), null, "reader head keeps no tool strip");
    await ui.input(ui.container.querySelector<HTMLInputElement>(".search input")!, "alpha");
    assert.equal(ui.container.querySelector(".inbox-tabs"), null, "search hides the tabs");
    await ui.click(ui.button("Clear search"));
    await ui.click(ui.button("Sent"));
    const note = ui.container.querySelector(".head-note")!;
    assert.ok(note.parentElement?.classList.contains("main-head"), "the cached note sits inside the header");
    assert.ok(note.closest(".mail-view")?.querySelector("h1.visually-hidden"), "cached-mail context retains the accessible view title");
    assert.equal(ui.container.querySelector(".list-pane > .search-help"), null, "no separate note row");
    await ui.click(ui.button("Settings"));
    assert.ok(ui.button("Hide personal information").closest(".app-toolbar"), "privacy stays in the toolbar on Settings");
    assert.equal(ui.container.querySelector('[aria-label="Filters"]'), null, "Settings has no Filters");
    assert.ok(ui.button("Drafts").closest("[inert]"));
    await ui.click(ui.button("Close settings"));
    await ui.click(ui.button("Drafts"));
    assert.equal(ui.container.querySelector(".drafts-pane > .main-head"), null, "Drafts has no duplicated title row");
    assert.ok(ui.button("Hide personal information").closest(".app-toolbar"), "privacy stays in the toolbar on Drafts");
    assert.equal(ui.container.querySelector('[aria-label="Filters"]'), null, "Drafts has no Filters");
    await ui.click(ui.button("Agent review"));
    assert.equal(ui.container.querySelector('[aria-label="Filters"]'), null, "work views have no Filters");
    assert.ok(ui.container.querySelector(".main-head .agent-navigation"), "agent sections sit inside the header");
    assert.ok(ui.container.querySelector(".main-head .work-controls"), "work controls sit inside the header");
  } finally { await ui.close(); }
});

test('copying the MCP endpoint toasts without locking or remounting the sidebar', async () => {
  let releaseCopy!: () => void;
  const held = new Promise<void>((resolve) => { releaseCopy = resolve; });
  const ui = await mount(false, undefined, { copyMcpEndpoint: () => held });
  try {
    await ui.click(ui.button('Settings'));
    await ui.click(ui.button('AI and agents'));
    const sidebar = ui.container.querySelector(".sidebar")!;
    const nav = sidebar.querySelector<HTMLElement>(".sidebar-group")!;
    const drafts = ui.button('Drafts');
    await ui.click(ui.button('Show options'));
    await ui.click(ui.button('Copy'));
    assert.equal(drafts.disabled, false, "a clipboard write never locks the mail actions");
    assert.equal(ui.container.querySelector(".sidebar"), sidebar, "sidebar stays mounted");
    assert.equal(sidebar.querySelector(".sidebar-group"), nav, "sidebar nav keeps its nodes");
    await act(async () => releaseCopy());
    const copied = [...ui.container.querySelectorAll(".toast")].filter((toast) => toast.textContent?.includes("Endpoint copied."));
    assert.equal(copied.length, 1, "one copied toast");
    assert.equal(drafts.disabled, false);
  } finally { await ui.close(); }
});

test('assistant management stays in Settings and Agent review only shows review work', async () => {
  const ui = await mount();
  try {
    await ui.click(ui.button('Settings')); await ui.click(ui.button('AI and agents'));
    assert.equal(ui.container.querySelector('.settings-dialog > .dialog-title h2')?.textContent, 'Settings');
    assert.ok(ui.container.querySelector('.settings .agent-assistants'));
    assert.equal(ui.container.querySelector('.settings .agent-proposals'), null);
    assert.ok(ui.button('Agent review').closest('[inert]'));
    await ui.click(ui.button('Close settings'));
    await ui.click(ui.button('Agent review'));
    assert.equal(ui.container.querySelector('.pane-title')?.textContent, 'Agent review');
    assert.ok(ui.container.querySelector('.agent-proposals'));
    assert.equal(ui.container.querySelector('.agent-assistants'), null);
    await ui.click(ui.button('Manage assistants'));
    assert.equal(ui.container.querySelector('.settings-dialog > .dialog-title h2')?.textContent, 'Settings');
    assert.ok(ui.container.querySelector('.settings .agent-assistants'));
    await ui.click(ui.back()); assert.equal(ui.container.querySelector('.pane-title')?.textContent, 'Agent review');
    await ui.click(ui.forward()); assert.equal(ui.container.querySelector('.settings-dialog > .dialog-title h2')?.textContent, 'Settings');
  } finally { await ui.close(); }
});

test("compose keeps toolbar search and privacy usable without losing the draft or settings", async () => {
  const stored = JSON.stringify({ mode: "light", theme: "midnight", accent: "purple", transparency: "glass", glassOpacity: 35, reading: "full" });
  const app = await mount(true, (_state, storage) => storage.setItem("emc2.appearance.v1", stored), { platform: "darwin", materials: true });
  try {
    await app.click(app.button("New message"));
    const editor = app.container.querySelector<HTMLTextAreaElement>('.compose-form textarea')!;
    await app.input(editor, "Keep this unsent draft");
    const search = app.container.querySelector<HTMLInputElement>('.app-search-toolbar input')!;
    assert.equal(search.disabled, false);
    assert.equal(app.container.querySelector('.compose-dialog')?.getAttribute('aria-modal'), null);
    const privacy = app.button("Hide personal information");
    await act(async () => privacy.focus());
    await app.key("Tab");
    assert.equal(app.window.document.activeElement, app.container.querySelector('.compose-dialog .dialog-title button'));
    await app.key("Tab", { shiftKey: true });
    assert.equal(app.window.document.activeElement, privacy);
    await app.click(app.button("Hide personal information"));
    assert.equal(app.storage.getItem("privacy"), "on");
    await act(async () => search.focus());
    await app.input(search, "Alpha");
    assert.equal(search.value, "Alpha");
    await act(async () => search.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(search.value, "");
    assert.equal(editor.value, "Keep this unsent draft");
    assert.ok(app.container.querySelector('.compose-dialog'));
    assert.equal(app.storage.getItem("emc2.appearance.v1"), stored);
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
});

test("compose improvements preserve device settings and account preferences through restart", async () => {
  const { defaults } = await import("./interaction");
  const { notificationDefaults } = await import("./notifications");
  const theme = sampleTheme();
  const settings: Record<string, string> = {
    "emc2.appearance.v1": JSON.stringify({ mode: "light", theme: theme.id, accent: "purple", transparency: "glass", glassOpacity: 35, reading: "full", customThemes: [theme] }),
    "emc2.interaction.v1": JSON.stringify({ ...defaults, opening: "single" }),
    "emc2.notifications.v1": JSON.stringify({ ...notificationDefaults, position: "top-right", duration: 10000, sound: "off" }),
    "emc2.text-scale": "1.2", privacy: "on", sidebar: "open", "sidebar-folded": '["accounts"]', "window-controls": "right",
  };
  for (let restart = 0; restart < 2; restart++) {
    const app = await mount(true, (state, storage) => {
      for (const [key, value] of Object.entries(settings)) storage.setItem(key, value);
      state.accounts[0].name = "Saved account label";
      state.composePreferences = { templates: [], signatures: { a: "Saved signature" } };
    }, { platform: "darwin", materials: true });
    try {
      const accounts = structuredClone(app.state.accounts);
      await app.click(app.button("New message"));
      const search = app.container.querySelector<HTMLInputElement>('.app-search-toolbar input')!;
      await app.input(search, "Alpha");
      for (const [key, value] of Object.entries(settings)) assert.equal(app.storage.getItem(key), value, key);
      assert.equal(app.window.document.documentElement.style.getPropertyValue("--glass-opacity"), "35%");
      assert.equal(app.window.document.documentElement.dataset.theme, theme.id);
      assert.deepEqual(app.state.accounts, accounts);
      assert.equal(app.state.composePreferences?.signatures.a, "Saved signature");
      assert.equal(app.mutations.length, 0);
    } finally { await app.close(); }
  }
});


for (const native of [false, true]) test(`compose history saves before ${native ? "native" : "mouse"} Back and retains Forward`, async () => {
  const app = await mount(native);
  try {
    await app.click(app.button("Archive"));
    await app.click(app.button("New message"));
    const editor = app.container.querySelector<HTMLTextAreaElement>(".compose-form textarea")!;
    await app.input(editor, "Keep this history draft");
    if (native) await app.native("back");
    else await act(async () => {
      for (const type of ["mousedown", "mouseup", "auxclick"]) editor.dispatchEvent(new app.window.MouseEvent(type, { button: 3, bubbles: true, cancelable: true }));
    });
    assert.equal(Boolean(app.container.querySelector(".compose-dialog")), false);
    assert.equal(app.savedDraft()?.body, "Keep this history draft");
    assert.equal(app.container.querySelector(".app-context strong")?.textContent, "Inbox");
    if (native) await app.native("forward"); else await app.mouse(4);
    assert.equal(app.container.querySelector(".app-context strong")?.textContent, "Archive");
  } finally { await app.close(); }
});

test("compose navigation keeps failed saves open and sidebar navigation saves before leaving", async () => {
  const app = await mount();
  try {
    await app.click(app.button("New message"));
    const editor = app.container.querySelector<HTMLTextAreaElement>(".compose-form textarea")!;
    await app.input(editor, "Retain across Settings");
    await app.click(app.button("Settings"));
    assert.equal(Boolean(app.container.querySelector(".compose-dialog")), false);
    assert.ok(app.container.querySelector(".settings"));
    assert.equal(app.savedDraft()?.body, "Retain across Settings");
    await app.click(app.button("Close settings"));
    app.failDraftSave(true);
    await app.click(app.button("New message"));
    const failed = app.container.querySelector<HTMLTextAreaElement>(".compose-form textarea")!;
    await app.input(failed, "Keep this failed save");
    await app.mouse(3);
    assert.ok(app.container.querySelector(".compose-dialog"));
    assert.equal(failed.value, "Keep this failed save");
    assert.match(app.container.textContent!, /could not be confirmed|could not be saved/);
  } finally { await app.close(); }
});


test("compose keyboard cycle reaches sidebar and toolbar without stealing editing or native field keys", async () => {
  const app = await mount();
  try {
    await app.click(app.button("New message"));
    const doc = app.window.document;
    const editor = app.container.querySelector<HTMLTextAreaElement>(".compose-form textarea")!;
    await app.input(editor, "Typing stays in the editor");
    for (const key of ["c", "/", "p", ",", "?", "ArrowLeft", "ArrowRight"]) {
      const event = new app.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => editor.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false, `editor owns ${key}`);
    }
    const from = app.container.querySelector<HTMLButtonElement>('.compose-from-row [role="combobox"]')!;
    const fromKey = async (key: string) => act(async () => from.dispatchEvent(new app.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    const arrow = new app.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    await act(async () => from.dispatchEvent(arrow));
    assert.equal(arrow.defaultPrevented, true, "From dropdown opens with arrows");
    assert.equal(from.getAttribute("aria-expanded"), "true");
    await fromKey("End");
    const lastOption = app.container.querySelector('[role="option"]:last-child')!;
    assert.equal(from.getAttribute("aria-activedescendant"), lastOption.id);
    await fromKey("Home");
    assert.equal(from.getAttribute("aria-activedescendant"), app.container.querySelector('[role="option"]')!.id);
    const hiddenBefore = app.storage.getItem("privacy");
    await fromKey("p");
    assert.equal(app.storage.getItem("privacy"), hiddenBefore, "account picker owns printable keys");
    await fromKey("Escape");
    assert.equal(from.getAttribute("aria-expanded"), "false");
    assert.ok(app.container.querySelector(".compose-dialog"), "menu Escape keeps the composer open");
    await app.click(from);
    await act(async () => from.focus());
    await fromKey("Tab");
    assert.equal(from.getAttribute("aria-expanded"), "false");
    assert.notEqual(doc.activeElement, from, "Tab dismisses the menu and moves focus");
    await app.click(app.button("Hide sidebar"));
    await act(async () => app.button("Show sidebar").focus());
    await app.key("Tab");
    assert.equal(doc.activeElement?.getAttribute("aria-label"), "Back", "collapsed sidebar toggle stays in the compose cycle");
    await app.click(app.button("Show sidebar"));
    await act(async () => app.button("New message").focus());
    await app.key("Tab");
    assert.equal(doc.activeElement, app.button("Drafts"));
    await act(async () => app.button("Back").focus());
    await app.key("Tab");
    assert.ok(doc.activeElement?.closest(".app-toolbar"));
    await act(async () => app.button("Close dialog").focus());
    await act(async () => app.button("Close dialog").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true })));
    assert.equal(app.storage.getItem("privacy"), "on");
    await act(async () => app.button("Close dialog").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    assert.equal(Boolean(app.container.querySelector(".compose-dialog")), false);
    assert.equal(app.savedDraft()?.body, "Typing stays in the editor");
    await app.click(app.button("New message"));
    await app.click(app.button("Commands"));
    assert.equal(Boolean(app.container.querySelector(".compose-dialog")), false);
    assert.ok(app.container.querySelector(".command-palette"));
  } finally { await app.close(); }
});

for (const failed of [false, true]) test(`compose attachment drain ${failed ? "retains failed reads" : "keeps completed bytes"} during navigation`, async () => {
  const app = await mount();
  const original = globalThis.fetch;
  let finish: (() => void) | undefined;
  const uploaded = { id: "5b8f2c1d-3e4a-4b6c-9d7e-8f9a0b1c2d3e", filename: "notes.txt", contentType: "text/plain", size: 9 };
  // Hold the raw attachment upload so navigation must wait for it.
  globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input).includes("/attachments?") && options?.method === "POST")
      return new Promise<Response>((resolve, reject) => {
        finish = () => failed ? reject(new Error("Synthetic upload failure")) : resolve({ ok: true, status: 201, json: async () => uploaded } as Response);
      });
    return original(input, options);
  }) as typeof fetch;
  try {
    await app.click(app.button("New message"));
    const input = app.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new app.window.File(["Synthetic"], "notes.txt", { type: "text/plain" })] });
    await act(async () => input.dispatchEvent(new app.window.Event("change", { bubbles: true })));
    assert.ok(finish, "synthetic attachment upload is pending");
    await app.click(app.button("Settings"));
    assert.ok(app.container.querySelector(".compose-dialog"), "navigation waits for the upload");
    await act(async () => finish?.());
    if (failed) {
      assert.ok(app.container.querySelector(".compose-dialog"));
      assert.match(app.container.textContent!, /Attachment could not be read/);
      assert.equal(Boolean(app.container.querySelector(".settings")), false);
    } else {
      assert.equal(Boolean(app.container.querySelector(".compose-dialog")), false);
      assert.equal(app.savedDraft()?.attachments?.[0]?.filename, "notes.txt");
      assert.equal((app.savedDraft()?.attachments?.[0] as { id?: string } | undefined)?.id, uploaded.id, "the draft keeps the uploaded reference");
      assert.ok(app.container.querySelector(".settings"));
    }
  } finally {
    globalThis.fetch = original;
    await app.close();
  }
});


test("Settings floats over the mounted reader, owns focus and restores its opener", async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    const mailView = app.container.querySelector(".mail-view");
    const reader = app.container.querySelector(".message");
    const opener = app.button("Settings");
    opener.focus();
    await app.click(opener);
    const dialog = app.container.querySelector<HTMLElement>('[role="dialog"][aria-label="Settings"]');
    assert.ok(dialog, "Settings is a modal dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(app.container.querySelector(".mail-view"), mailView, "mail view stays mounted");
    assert.equal(app.container.querySelector(".message"), reader, "open reader stays mounted");
    assert.equal(app.title(), "Alpha");
    assert.ok(mailView?.closest("[inert]"), "background mail cannot receive input");
    assert.ok(app.container.querySelector(".sidebar")?.closest("[inert]"), "background navigation is inert");
    assert.ok(dialog.contains(app.window.document.activeElement), "focus enters Settings");
    await app.key("Escape", { cancelable: true });
    assert.equal(app.container.querySelector('[role="dialog"][aria-label="Settings"]'), null);
    assert.equal(app.container.querySelector(".message"), reader);
    assert.equal(app.title(), "Alpha");
    assert.equal(app.window.document.activeElement, opener);
    assert.equal(app.mutations.length, 1, "opening and closing Settings does not mutate mail");
  } finally { await app.close(); }
});


test("Settings history keeps the mounted reader through sections, Back and Forward", async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    const reader = app.container.querySelector(".message");
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(app.back());
    assert.equal(app.container.querySelector(".settings h1")?.textContent, "Keyboard and mouse");
    assert.equal(app.container.querySelector(".message"), reader);
    await app.click(app.back());
    assert.equal(app.container.querySelector(".settings"), null);
    assert.equal(app.container.querySelector(".message"), reader);
    await app.click(app.forward());
    assert.ok(app.container.querySelector(".settings"));
    assert.equal(app.container.querySelector(".message"), reader);
    await app.click(app.button("Close settings"));
    assert.equal(app.title(), "Alpha");
    assert.equal(app.mutations.length, 1);
  } finally { await app.close(); }
});

test("Settings keeps the work view mounted and limits shortcuts to safe modal actions", async () => {
  const app = await mount();
  try {
    await app.click(app.button("Calendar"));
    const work = app.container.querySelector(".work-pane");
    await app.click(app.button("Settings"));
    assert.equal(app.container.querySelector(".work-pane"), work);
    assert.ok(work?.closest("[inert]"));
    await app.click(app.button("Appearance"));
    app.button("Close settings").focus();
    await app.key("k", { metaKey: true });
    assert.equal(app.container.querySelector('[aria-label="Search commands"]'), null);
    await app.key("c");
    assert.equal(app.container.querySelector(".compose-dialog"), null);
    await act(async () => app.button("Close settings").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true })));
    assert.equal(app.storage.getItem("privacy"), "on");
    assert.ok(app.container.querySelector(".settings"));
    await act(async () => app.button("Close settings").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })));
    assert.equal(app.container.querySelector(".settings"), null);
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "All cached");
    assert.equal(app.window.document.activeElement, app.container.querySelector(".app-search-toolbar input"));
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
});

test("Settings history rejects an unavailable reader when returning to mail", async () => {
  const app = await mount();
  try {
    await app.open("a:1");
    await app.click(app.button("Settings"));
    app.state.accounts = app.state.accounts.filter(account => account.id !== "a");
    app.state.messages = app.state.messages.filter(mail => mail.accountId !== "a");
    await app.refresh();
    await app.click(app.back());
    assert.equal(app.container.querySelector(".settings"), null);
    assert.equal(app.title(), undefined);
    assert.equal(app.mutations.length, 1);
  } finally { await app.close(); }
});

test("global search enters all accounts once, preserves narrowing and restores scope through history", async () => {
  const app = await mount(false, state => {
    state.messages.push({ ...state.messages[0], id: "b:sent", accountId: "b", subject: "Alpha sent", direction: "sent" },
      { ...state.messages[0], id: "b:archive", accountId: "b", subject: "Alpha archive", archived: true },
      { ...state.messages[0], id: "b:snoozed", accountId: "b", subject: "Alpha snoozed", snoozedUntil: Date.now() + 60000 });
  });
  try {
    await app.click(app.account("first@example.com"));
    await app.choose("Read status", "Unread");
    const search = app.container.querySelector<HTMLInputElement>(".search input")!;
    await app.input(search, "   ");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Inbox");
    await app.input(search, "Alpha");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "All cached");
    assert.equal(app.activeAccount(), "All accounts");
    assert.equal(app.container.querySelectorAll(".row").length, 4);
    await app.click(app.account("second@example.com"));
    await app.click(app.button("Sent"));
    await app.input(search, "Alpha sent");
    assert.equal(app.activeAccount(), "second@example.com");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Sent");
    assert.equal(app.container.querySelectorAll(".row").length, 1);
    await app.click(app.button("Clear search"));
    assert.equal(app.activeAccount(), "second@example.com");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Sent");
    await app.click(app.back());
    assert.equal(search.value, "Alpha sent", "clear has a predictable history visit");
    await app.click(app.forward());
    assert.equal(search.value, "");
    await app.input(search, "Alpha");
    assert.equal(app.activeAccount(), "All accounts");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "All cached");
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
});

test("Find pinned mail searches this view or All cached and keeps the selected account", async () => {
  const app = await mount(false, state => {
    state.messages[0].pinned = true;
    state.messages[2].pinned = true;
    state.messages.push({ ...state.messages[0], id: "a:archived", remoteId: "a:archived", subject: "Archived pin", preview: "Archived pin", body: "Archived pin", archived: true });
  });
  const subjects = () => [...app.container.querySelectorAll(".row")].map(row => row.textContent).map(text =>
    ["Alpha", "Gamma", "Archived pin"].find(subject => text?.includes(subject))).sort();
  try {
    await app.click(app.account("first@example.com"));
    await app.openFilters();
    assert.match(app.container.querySelector(".pinned-help")?.textContent || "", /Pin keeps mail for reference/);
    await app.click(app.button("Find pinned mail in this view"));
    assert.equal(app.container.querySelector('[aria-label="Mail filters and sort"]'), null, "the popover closes");
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")!.value, "is:pinned");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Inbox");
    assert.deepEqual(subjects(), ["Alpha"]);

    await app.openFilters();
    await app.click(app.button("Find pinned mail in All cached"));
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "All cached");
    assert.equal(app.activeAccount(), "first@example.com");
    assert.deepEqual(subjects(), ["Alpha", "Archived pin"], "an archived pin is found without the other account's pin");

    await app.click(app.button("Commands"));
    const options = [...app.container.querySelectorAll(".command-option")].map(option => option.textContent);
    assert.ok(options.includes("Find pinned mail in this view"));
    assert.ok(options.includes("Find pinned mail in All cached"));
    assert.equal(app.mutations.length, 0, "finding pins never changes mail");
  } finally { await app.close(); }
});

test("mixed global search draft focus isolates mail shortcuts and traversal", async (t) => {
  const draft: Draft = { id: "saved", accountId: "b", revision: 3, updatedAt: 1, to: ["client@example.test"], subject: "Needle draft", body: "Saved draft body", sendUnknown: false };
  for (const control of [".draft-row", ".draft-refresh"]) {
    for (const key of ["e", "r", "b", "m", "j", "k", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Enter"]) {
      await t.test(`${control}: ${key}`, async () => {
        const app = await mount(false, state => {
          state.messages = state.messages.map(mail => ({ ...mail, subject: `Needle ${mail.subject}` }));
          state.draftCount = 1; state.draftToken = "d1";
        }, {}, [draft]);
        try {
          await app.input(app.container.querySelector<HTMLInputElement>(".search input")!, "Needle");
          await act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); });
          assert.equal(app.container.querySelector(".pane-title")?.textContent, "All cached");
          assert.equal(app.container.querySelectorAll(".row").length, 4);
          assert.equal(app.container.querySelectorAll(".draft-row").length, 1);
          await app.click(app.container.querySelector<HTMLElement>('[id="mail-a:2"]')!);
          const selected = app.container.querySelector(".row.selected")?.id;
          assert.equal(selected, "mail-a:2", "selection has mail on both sides for traversal");
          const messages = structuredClone(app.state.messages);
          const requestCount = app.requests.length;
          const target = app.container.querySelector<HTMLButtonElement>(control)!;
          const event = new app.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          await act(async () => { target.focus(); target.dispatchEvent(event); });
          assert.equal(app.mutations.length, 0, "draft focus cannot mutate the selected mail");
          assert.equal(app.container.querySelector(".compose-dialog, [role=dialog], [role=menu], .message"), null,
            "draft focus cannot reply, open mail, snooze or teach unrelated mail");
          assert.equal(app.container.querySelector(".row.selected")?.id, selected, "draft focus cannot traverse mail");
          assert.deepEqual(app.state.messages, messages);
          assert.deepEqual(app.requests.slice(requestCount), [], "no mailbox or compose requests");
          if (key === "Enter") assert.equal(event.defaultPrevented, false, "native button activation remains available");
        } finally { await app.close(); }
      });
    }
  }
});

test("mixed global search draft focus preserves global shortcuts and draft activation", async () => {
  const draft: Draft = { id: "saved", accountId: "b", revision: 3, updatedAt: 1, to: ["client@example.test"], subject: "Alpha draft", body: "Saved draft body", sendUnknown: false };
  const app = await mount(false, state => { state.draftCount = 1; state.draftToken = "d1"; }, {}, [draft]);
  try {
    const search = app.container.querySelector<HTMLInputElement>(".search input")!;
    await app.input(search, "Alpha");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); });
    assert.equal(app.container.querySelectorAll(".row").length, 1);
    for (const control of [".draft-row", ".draft-refresh"]) {
      const target = app.container.querySelector<HTMLButtonElement>(control)!;
      for (const privacy of ["on", "off"]) {
        await act(async () => { target.focus(); target.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "p", bubbles: true })); });
        assert.equal(app.storage.getItem("privacy"), privacy);
      }
      await act(async () => { target.focus(); target.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true })); });
      assert.equal(app.window.document.activeElement, search, "Search remains global from draft controls");
      assert.equal(search.value, "Alpha");
    }
    await app.click(app.container.querySelector<HTMLButtonElement>(".draft-row")!);
    assert.equal(app.container.querySelector<HTMLTextAreaElement>(".compose-form textarea")?.value, draft.body);
    assert.match(app.container.querySelector('.compose-form [aria-label="From"]')?.textContent || "", /second@example\.com/);
    assert.equal(app.mutations.length, 0);
    assert.equal(app.requests.some(url => url === "/api/send"), false);
  } finally { await app.close(); }
});

test("global search finds and opens a saved draft body with no cached mail and no account-list requests", async () => {
  const draft: Draft = { id: "saved", accountId: "b", revision: 3, updatedAt: 1, to: ["client@example.test"], subject: "Saved proposal", body: "x".repeat(500) + " Needle", sendUnknown: true };
  const app = await mount(false, state => { state.messages = []; state.draftCount = 1; state.draftToken = "d1"; }, {}, [draft]);
  try {
    const search = app.container.querySelector<HTMLInputElement>(".search input")!;
    await app.input(search, "body:needle");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); });
    assert.equal(app.requests.filter(url => url.startsWith("/api/messages/search?")).length, 1);
    assert.equal(app.requests.filter(url => /\/accounts\/[^/]+\/drafts$/.test(url)).length, 0, "search never fetches per-account draft lists");
    assert.equal(app.container.querySelectorAll(".draft-row").length, 1);
    assert.equal(app.container.querySelectorAll(".row").length, 0);
    assert.match(app.container.querySelector(".draft-row")!.textContent!, /Send status unknown/);
    assert.equal(app.container.querySelector(".empty"), null, "draft results do not show a contradictory empty mail list");
    await app.click(app.container.querySelector<HTMLButtonElement>(".draft-row")!);
    assert.equal(app.container.querySelector<HTMLTextAreaElement>(".compose-form textarea")?.value, draft.body);
    assert.match(app.container.querySelector(".compose-form")!.textContent!, /may already have been sent/);
    assert.equal(app.requests.some(url => url === "/api/send"), false);
    await app.key("Escape");
    await app.click(app.button("Inbox"));
    assert.equal(app.container.querySelector(".draft-row"), null, "mail-only views exclude drafts without dropping the query");
    assert.equal(search.value, "body:needle");
    await app.click(app.button("All cached"));
    assert.equal(app.container.querySelectorAll(".draft-row").length, 1);
    await app.choose("Read status", "Unread");
    assert.equal(app.container.querySelector(".draft-row"), null, "mail-only filters exclude drafts");
  } finally { await app.close(); }
});

test("global search Gmail label choices use distinct friendly account names without private addresses", async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("privacy", "on");
    state.accounts = state.accounts.map(account => ({ ...account, provider: "gmail", name: account.email }));
    state.labels = state.accounts.map(account => ({ id: "team", accountId: account.id, name: "Team", type: "user" }));
  });
  try {
    assert.ok(app.account("Account 1 · Gmail")); assert.ok(app.account("Account 2 · Gmail"));
    await app.openFilters(); await app.click(app.button("Filter by Gmail label"));
    const choices = [...app.container.querySelectorAll('[role="option"]')].map(option => option.textContent);
    assert.deepEqual(choices, ["All labels", "Team (Account 1 · Gmail)", "Team (Account 2 · Gmail)"]);
    assert.doesNotMatch(app.container.innerHTML, /first@example\.com|second@example\.com/);
  } finally { await app.close(); }
});


test("F6 cycles the visible regions and Shift+F6 reverses", async () => {
  const app = await mount();
  try {
    const doc = app.window.document;
    const search = app.container.querySelector<HTMLInputElement>(".search input")!;
    await app.key("F6");
    const sidebarFocus = doc.activeElement as HTMLElement;
    assert.ok(sidebarFocus.closest("#sidebar") === app.container.querySelector("#sidebar"), "F6 starts in the sidebar");
    assert.equal(sidebarFocus.getAttribute("aria-current"), "page", "the sidebar cycle lands on the current view");
    await app.key("F6");
    assert.ok(doc.activeElement === search, "F6 next reaches search");
    await app.key("F6");
    assert.ok(doc.activeElement?.classList.contains("row") && doc.activeElement.getAttribute("aria-current") === "true",
      "entering the list focuses the selected row");
    await app.key("F6");
    assert.ok(doc.activeElement === sidebarFocus, "a closed reader is skipped and the cycle wraps");
    await app.key("F6", { shiftKey: true });
    assert.ok(doc.activeElement?.classList.contains("row"), "Shift+F6 cycles backwards");
    await app.open("a:1");
    assert.ok(app.container.querySelector(".reader-pane .message"), "the reader opens beside the list");
    await app.key("F6");
    assert.ok(doc.activeElement?.classList.contains("message"), "the next region is the reader");
    await app.key("F6");
    assert.ok(doc.activeElement === sidebarFocus, "the cycle wraps back to the sidebar");
    await app.key("F6", { shiftKey: true });
    assert.ok(doc.activeElement?.classList.contains("message"), "Shift+F6 returns to the reader");
  } finally { await app.close(); }
});

test("F6 skips a closed sidebar and a full-width reader", async () => {
  const app = await mount(false, (_state, storage) => {
    storage.setItem("emc2.appearance.v1", JSON.stringify({ reading: "full" }));
  });
  try {
    const doc = app.window.document;
    await app.click(app.button("Hide sidebar"));
    await app.open("a:1");
    assert.equal(app.container.querySelector(".reader-pane"), null, "full-width opens in place of the list");
    const message = app.container.querySelector<HTMLElement>(".list .message")!;
    assert.ok(message, "the opened email renders inside the list pane");
    await app.key("F6");
    assert.equal(doc.activeElement, app.container.querySelector(".search input"), "the cycle starts at search without the sidebar");
    await app.key("F6");
    assert.equal(doc.activeElement, message, "the list region lands on the opened email");
    await app.key("F6");
    assert.equal(doc.activeElement, app.container.querySelector(".search input"), "the cycle wraps past the hidden sidebar and reader");
    await app.key("F6", { shiftKey: true });
    assert.equal(doc.activeElement, message);
  } finally { await app.close(); }
});

test("F6 keeps dialog and composer focus scope", async () => {
  const app = await mount();
  try {
    const doc = app.window.document;
    await app.key("?");
    const dialog = app.container.querySelector('[role="dialog"]')!;
    assert.ok(dialog, "the shortcuts dialog is open");
    const inDialog = doc.activeElement as HTMLElement;
    assert.ok(dialog.contains(inDialog));
    await app.key("F6");
    assert.equal(doc.activeElement, inDialog, "F6 does not leave the dialog");
    await app.click(app.button("Close dialog"));
    await app.click(app.button("New message"));
    const composer = app.container.querySelector(".compose-dialog")!;
    const inComposer = doc.activeElement as HTMLElement;
    assert.ok(composer.contains(inComposer), "the composer opens with field focus");
    await app.key("F6");
    assert.equal(doc.activeElement, inComposer, "F6 does not leave the composer");
    await app.key("F6", { shiftKey: true });
    assert.equal(doc.activeElement, inComposer);
  } finally { await app.close(); }
});


test("global search draft deletion reports a failed count refresh without retrying deletion", async () => {
  const draft: Draft = { id: "saved", accountId: "b", revision: 3, updatedAt: 1, to: ["client@example.test"], subject: "Alpha draft", body: "Saved body", sendUnknown: false };
  const drafts = [draft];
  const app = await mount(false, state => { state.draftCount = 1; state.draftToken = "d1"; }, {}, drafts);
  const priorFetch = globalThis.fetch;
  let deletes = 0;
  try {
    await app.input(app.container.querySelector<HTMLInputElement>(".search input")!, "Alpha");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    assert.equal(app.container.querySelectorAll(".draft-row").length, 1);
    globalThis.fetch = async (input, options) => {
      if (String(input).includes("/drafts/") && options?.method === "DELETE") {
        deletes++; drafts.splice(0);
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (String(input).startsWith("/api/state")) throw new Error("Synthetic count refresh failure");
      return priorFetch(input, options);
    };
    await app.click(app.button("Delete draft"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    assert.match(app.container.textContent || "", /Draft deleted, but refreshing the saved count failed/);
    assert.equal(deletes, 1);
    assert.equal(app.container.querySelector(".draft-row"), null);
    assert.equal(app.container.querySelector(".compose-dialog"), null);
  } finally { globalThis.fetch = priorFetch; await app.close(); }
});


test("Gmail go-to sequences navigate views, cancel safely and expose saved hints", async () => {
  const app = await mount();
  try {
    for (const [key, title] of [["t", "Sent"], ["d", "Drafts"], ["a", "All cached"], ["b", "Snoozed"], ["i", "Inbox"]]) {
      await app.key("g"); await app.key(key);
      assert.equal(app.container.querySelector(".pane-title")?.textContent, title);
    }
    const before = app.mutations.length;
    await app.key("g"); await app.key("e");
    assert.equal(app.mutations.length, before, "mistyped sequence cannot archive");
    await app.key("g"); await app.key("s");
    assert.equal(app.container.querySelector<HTMLInputElement>('.search input')?.value, "is:pinned");
    await app.key("g"); await app.key("i");
    await app.key("o"); assert.equal(app.title(), "Alpha");
    await app.key("u"); assert.equal(app.title(), undefined);
    await app.key("?");
    assert.match(app.container.querySelector('[role="dialog"]')!.textContent!, /G then I/);
    assert.match(app.container.querySelector('[role="dialog"]')!.textContent!, /Mouse controls/);
  } finally { await app.close(); }
});

test("custom sequences and mouse-history preferences persist and respect editor focus", async () => {
  const app = await mount(false, (_state, storage) => {
    const custom = structuredClone(defaults);
    custom.shortcuts.goSent = { prefix: "z", key: "x" };
    custom.mouseHistory = false;
    storage.setItem("emc2.interaction.v1", JSON.stringify(custom));
  });
  try {
    await app.open("a:1");
    await app.mouse(3); assert.equal(app.title(), "Alpha", "disabled side button does not leave reader");
    await app.key("z"); await app.key("x");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Sent");
    await app.key("g"); await app.key("i");
    const field = app.container.querySelector<HTMLInputElement>('.search input')!;
    await app.key("z");
    await act(async () => field.focus());
    await app.key("x");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Inbox", "focus change cancels sequence");
    await app.key("g");
    await act(async () => field.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "i", bubbles: true })));
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Inbox", "editor keeps its keys");
  } finally { await app.close(); }
});

test("Gmail pin, mark-read and reply-all shortcuts reuse guarded mail actions", async () => {
  const app = await mount();
  try {
    const before = app.mutations.length;
    await app.key("s"); assert.equal(app.mutations.length, before + 1);
    await app.key("I", { shiftKey: true });
    assert.equal(app.state.messages[0].unread, false);
    await app.key("a"); assert.ok(app.container.querySelector(".compose-dialog"));
    const duringCompose = app.mutations.length;
    await app.key("s"); assert.equal(app.mutations.length, duringCompose, "composer retains pin key");
  } finally { await app.close(); }
});

test("custom sequences retain safe Settings and compose actions and Caps Lock navigation", async () => {
  const app = await mount(false, (_state, storage) => {
    const custom = structuredClone(defaults);
    custom.shortcuts.privacy = { prefix: "z", key: "p" };
    custom.shortcuts.search = { prefix: "z", key: "f" };
    custom.shortcuts.back = { prefix: "z", key: "b" };
    storage.setItem("emc2.interaction.v1", JSON.stringify(custom));
  });
  const privacyLabel = () => app.container.querySelector('[aria-label="Show personal information"], [aria-label="Hide personal information"]')?.getAttribute("aria-label");
  try {
    await app.key("G"); await app.key("T");
    assert.equal(app.container.querySelector(".pane-title")?.textContent, "Sent", "Caps Lock starts a canonical sequence");
    await app.key("g"); await app.key("i");
    await app.key(",");
    const before = privacyLabel();
    await app.key("z"); await app.key("p");
    assert.notEqual(privacyLabel(), before, "custom Privacy works in Settings");
    await app.key("z"); await app.key("f");
    assert.equal(app.container.querySelector(".settings"), null, "custom Search leaves Settings");
    await app.key("c");
    await app.input(app.container.querySelector<HTMLTextAreaElement>('[aria-label="Message body"]')!, "Saved before custom history navigation");
    const control = app.container.querySelector<HTMLButtonElement>('[aria-label="Delete draft"]')!;
    await act(async () => control.focus());
    const press = async (key: string) => { await act(async () => control.dispatchEvent(new app.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))); };
    const composing = privacyLabel();
    await press("z"); await press("p");
    assert.notEqual(privacyLabel(), composing, "custom Privacy works from nonediting compose controls");
    await press("z"); await press("b");
    assert.equal(app.container.querySelector(".compose-dialog"), null);
    assert.equal(app.savedDraft()?.body, "Saved before custom history navigation");
  } finally { await app.close(); }
});

test("pending sequences preserve Escape, Tab and system shortcuts", async () => {
  const app = await mount(false, (_state, storage) => {
    const custom = structuredClone(defaults);
    custom.shortcuts.privacy = { prefix: "z", key: "p" };
    storage.setItem("emc2.interaction.v1", JSON.stringify(custom));
  });
  try {
    await app.open("a:1");
    await app.key("g"); await app.key("Escape");
    assert.equal(app.title(), undefined, "Escape closes the reader after a prefix");
    for (const options of [{ key: "Tab" }, { key: "c", metaKey: true }]) {
      await app.key("g");
      const event = new app.window.KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true });
      const control = app.container.querySelector<HTMLButtonElement>(".commands-button")!;
      await act(async () => control.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false, `${options.key} keeps native behavior`);
    }
    await app.key(",");
    await app.key("z"); await app.key("Escape");
    assert.equal(app.container.querySelector(".settings"), null);
  } finally { await app.close(); }
});

test("phone navigation can leave Today, close the drawer and reopen it for Settings", async () => {
  const app = await mount(false, undefined, {}, [], 390);
  try {
    const toggle = app.button("Show sidebar");
    assert.equal(toggle.closest(".app-toolbar")?.firstElementChild, toggle);
    assert.ok(app.container.querySelector(".sidebar.closed[inert]"));
    await app.click(toggle);
    assert.ok(app.container.querySelector(".mobile-sidebar-backdrop"));
    assert.equal(app.container.querySelector(".sidebar[inert]"), null);
    await app.click(app.button("Today"));
    assert.equal(app.container.querySelector(".app")?.getAttribute("data-view"), "actions");
    assert.ok(app.container.querySelector(".sidebar.closed[inert]"));
    await app.click(app.button("Show sidebar"));
    await app.click(app.button("Inbox"));
    assert.equal(app.container.querySelector(".app")?.getAttribute("data-view"), "inbox");
    assert.ok(app.container.querySelector(".sidebar.closed[inert]"));
    await app.click(app.button("Show sidebar"));
    await app.click(app.button("Settings"));
    assert.ok(app.container.querySelector(".settings-dialog"));
    await app.click(app.button("Close settings"));
    await app.click(app.button("Show sidebar"));
    await app.click(app.button("Close navigation"));
    assert.ok(app.container.querySelector(".sidebar.closed[inert]"));
    assert.equal(app.storage.getItem("sidebar"), null, "phone drawer does not overwrite desktop preference");
  } finally { await app.close(); }
});


test("phone users can create, customize and retain a theme without changing mail", async () => {
  const app = await mount(false, undefined, {}, [], 390);
  let saved = "";
  try {
    await app.click(app.button("Show sidebar"));
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    await app.click(themeButton(app, "Create theme"));
    const document = app.window.document;
    await app.input(document.querySelector<HTMLInputElement>('.theme-name input')!, "Phone palette");
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!, "#202530");
    await app.input(document.querySelector<HTMLInputElement>('[aria-label="Accent hex"]')!, "#9c8aff");
    await app.click(themeButton(app, "Save theme"));
    saved = app.storage.getItem("emc2.appearance.v1")!;
    const value = JSON.parse(saved);
    assert.equal(value.customThemes[0].name, "Phone palette");
    assert.equal(value.customThemes[0].palettes.dark.canvas, "#202530");
    assert.equal(value.customThemes[0].palettes.dark.accent, "#9c8aff");
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
  const restarted = await mount(false, (_state, storage) => storage.setItem("emc2.appearance.v1", saved), {}, [], 390);
  try { assert.equal(restarted.window.document.documentElement.style.getPropertyValue("--bg"), "#202530"); }
  finally { await restarted.close(); }
});


test("an empty browser page refreshes imported accounts when the phone tab returns", async () => {
  let accounts: State["accounts"] = [], messages: State["messages"] = [];
  const app = await mount(false, (state) => { accounts = state.accounts; messages = state.messages; state.accounts = []; state.messages = []; }, {}, [], 390);
  try {
    assert.equal(app.container.querySelectorAll('[aria-label="Filter accounts"] button[aria-pressed]').length, 0);
    app.state.accounts = accounts; app.state.messages = messages;
    const before = app.requests.filter(url => url.startsWith("/api/state")).length;
    await act(async () => { app.window.dispatchEvent(new app.window.Event("focus")); });
    assert.ok(app.requests.filter(url => url.startsWith("/api/state")).length > before, "returning to the browser reloads server state");
    assert.equal(app.container.querySelectorAll('[aria-label="Filter accounts"] button[aria-pressed]').length, 3);
    assert.equal(app.mutations.length, 0, "refreshing does not change mailbox state");
  } finally { await app.close(); }
});


test("phone Settings section picker switches panels without changing saved mail", async () => {
  const app = await mount(false, undefined, {}, [], 320);
  try {
    await app.click(app.button("Show sidebar"));
    await app.click(app.button("Settings"));
    const picker = app.container.querySelector<HTMLSelectElement>('select[aria-label="Settings section"]')!;
    assert.ok(picker);
    assert.equal(picker.options.length, 11);
    assert.equal(Array.from(picker.options).some(option => option.value === "contacts"), false);
    assert.ok(Array.from(picker.options).some(option => option.value === "phone-access"));
    const change = async (section: string) => {
      await act(async () => { picker.value = section; picker.dispatchEvent(new app.window.Event("change", { bubbles: true })); });
    };
    await change("appearance");
    assert.equal(app.container.querySelector(".settings-section-heading h1")?.textContent, "Appearance");
    assert.equal(app.container.querySelector("[data-interaction-settings]"), null);
    await change("interaction");
    assert.ok(app.container.querySelector("[data-interaction-settings]"));
    assert.equal(picker.value, "interaction");
    assert.equal(app.mutations.length, 0);
    await app.click(app.button("Close settings"));
    assert.ok(app.button("Show sidebar"));
  } finally { await app.close(); }
});


test("Forward shortcut prepares one draft without sending", async () => {
  const app = await mount();
  try {
    await app.key("f");
    assert.ok(app.container.querySelector(".compose-dialog"));
    assert.equal(app.container.querySelector<HTMLInputElement>('input[aria-label="To"]')!.value, "");
    assert.equal(app.container.querySelector<HTMLInputElement>('.compose-subject input')!.value, "Fwd: Alpha");
    assert.equal(app.requests.filter(url => url.endsWith("/forward")).length, 1);
    assert.equal(app.requests.filter(url => url === "/api/send").length, 0);
    await app.key("f");
    assert.equal(app.requests.filter(url => url.endsWith("/forward")).length, 1, "composer blocks forward shortcut");
  } finally { await app.close(); }
});


test("Commands lists Forward with its configured shortcut", async () => {
  const app = await mount();
  try {
    await app.click(app.button("Commands"));
    const search = app.container.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!;
    await app.input(search, "Forward message");
    assert.match(app.container.querySelector('[aria-label="Commands"]')!.textContent!, /Forward message/);
    const command = [...app.container.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.querySelector("span")?.textContent === "Forward message")!;
    assert.equal(command.querySelector("kbd")?.textContent, "F");
    await app.click(command);
    assert.ok(app.container.querySelector(".compose-dialog"));
    assert.equal(app.requests.filter(url => url.endsWith("/forward")).length, 1);
  } finally { await app.close(); }
});


for (const replacement of ["keyboard", "sidebar", "saved draft", "source removed", "account removed", "update"] as const) {
  test(`delayed Forward preserves context: ${replacement}`, async () => {
    let updateState: ((state: import("../shared/updates").UpdateState) => void) | undefined;
    const saved: Draft = { id: "saved", accountId: "a", revision: 3, updatedAt: 1, to: [], subject: "Keep this draft", body: "Synthetic text", sendUnknown: false };
    const app = await mount(false, state => { state.draftCount = 1; }, { updates: {
      state: async () => ({ phase: "current" }), command: async () => { throw new Error("No installer allowed"); },
      onState: callback => { updateState = callback; return () => {}; }, onDrain: () => () => {},
    } }, [saved]);
    const originalFetch = globalThis.fetch;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    globalThis.fetch = async (input, options) => {
      const response = await originalFetch(input, options);
      if (String(input).endsWith("/forward")) await wait;
      return response;
    };
    try {
      await app.key("f");
      if (replacement === "keyboard") await app.key("c");
      else if (replacement === "sidebar") await app.click(app.button("New message"));
      else if (replacement === "saved draft") {
        // Drafts sidebar is disabled while busy; global search remains available.
        await app.input(app.container.querySelector<HTMLInputElement>(".search input")!, "subject:Keep");
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 145)); });
        const row = app.container.querySelector<HTMLElement>(".draft-row");
        assert.ok(row, "saved draft is exposed through global search while Forward waits");
        await app.click(row);
      } else if (replacement === "update") {
        await act(async () => { updateState!({ phase: "installing", version: "0.1.7" }); });
      } else {
        if (replacement === "source removed") app.state.messages = app.state.messages.filter(mail => mail.id !== "a:1");
        else app.state.accounts = app.state.accounts.filter(account => account.id !== "a");
        const before = app.requests.filter(url => url.startsWith("/api/state")).length;
        await app.refresh();
        assert.ok(app.requests.filter(url => url.startsWith("/api/state")).length > before, "removal is published to App before resolving Forward");
      }
      await act(async () => { release(); await wait; });
      assert.equal(app.container.querySelector<HTMLInputElement>('.compose-subject input')?.value,
        replacement === "keyboard" || replacement === "sidebar" ? "" : replacement === "saved draft" ? saved.subject : undefined);
      assert.equal(app.requests.filter(url => url.endsWith("/forward")).length, 1);
      assert.equal(app.requests.filter(url => url === "/api/send").length, 0);
    } finally { release(); globalThis.fetch = originalFetch; await app.close(); }
  });
}

test("Forward admits only one request before React renders", async () => {
  const app = await mount();
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, options) => {
    const response = await originalFetch(input, options);
    if (String(input).endsWith("/forward")) await wait;
    return response;
  };
  try {
    await act(async () => {
      for (let i = 0; i < 2; i++) app.window.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "f", bubbles: true }));
    });
    assert.equal(app.requests.filter(url => url.endsWith("/forward")).length, 1);
    await act(async () => { release(); await wait; });
  } finally { release(); globalThis.fetch = originalFetch; await app.close(); }
});

test("search widening preserves query and account and Back restores exact filters", async () => {
  const app = await mount();
  try {
    await app.input(app.container.querySelector<HTMLInputElement>(".search input")!, "Alpha");
    await app.click(app.account("first@example.com"));
    await app.choose("Read status", "Unread");
    await app.choose("Relevance filter", "High relevance");
    await app.choose("Sort mail", "Oldest");
    await app.click(app.button("Filters"));
    const help = () => app.container.querySelector("#mail-search-help")!;
    // Input commits before the cached-search request's own debounce finishes.
    for (let attempt = 0; attempt < 20 && help().textContent?.startsWith("Searching"); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    }
    assert.ok(app.requests.some(url => url === "/api/messages/search?query=Alpha"), "cached fixture search completed");
    assert.match(help().textContent!, /Unread.*High relevance.*Oldest first/);
    assert.equal(help().getAttribute("role"), "status");
    await app.click(app.button("Search all cached mail in this account"));
    assert.equal(app.container.querySelector<HTMLInputElement>(".search input")!.value, "Alpha");
    assert.equal(app.activeAccount(), "first@example.com");
    assert.match(help().textContent!, /1 mail results.*All read states.*All relevance.*Oldest first/);
    await app.click(app.back());
    assert.match(help().textContent!, /0 mail results.*Unread.*High relevance.*Oldest first/);
    assert.ok(app.button("Search all cached mail in this account"));
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
});

test("account warning opens the affected private account without reconnecting on focus", async () => {
  const app = await mount(false, (state, storage) => {
    storage.setItem("privacy", "on");
    state.accounts[1].error = "password rejected by private.example.test";
    state.accounts[1].syncFailure = { kind: "auth", phase: "auth", code: "private.example.test" };
    state.accounts[1].syncWarning = { kind: "unknown", phase: "cleanup", code: "private.example.test" };
  });
  try {
    const warning = app.container.querySelector<HTMLButtonElement>(".account-warning")!;
    assert.ok(warning, "warning is a separate native button");
    assert.match(warning.getAttribute("aria-label")!, /Account 2.*needs attention.*cleanup failed/);
    assert.equal(warning.tabIndex, 0);
    await act(async () => warning.focus());
    assert.equal(app.requests.filter(url => url.endsWith("/reconnect")).length, 0);
    await app.click(warning);
    const target = app.container.querySelector<HTMLElement>("#settings-account-b")!;
    assert.equal(app.window.document.activeElement, target);
    assert.match(target.textContent!, /Connection needs attention.*cleanup failed/);
    assert.doesNotMatch(app.container.innerHTML, /private\.example\.test|password rejected|second@example\.com/);
    const retry = [...target.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Retry connection")!;
    await app.click(retry);
    assert.deepEqual(app.requests.filter(url => url.endsWith("/reconnect")), ["/api/accounts/b/reconnect"]);
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
});

test("persistent density agrees between Appearance, shortcut and Commands", async () => {
  const app = await mount();
  let saved = "";
  const density = () => app.container.querySelector('[role="radiogroup"][aria-labelledby="density-label"]')!;
  try {
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    assert.ok(density(), "Appearance exposes density");
    assert.equal(density().querySelector('[aria-checked="true"]')?.textContent, "Comfortable");
    await app.click(app.button("Compact"));
    assert.equal(app.storage.getItem("emc2.density"), "compact");
    await app.click(app.button("Close settings"));
    await act(async () => app.window.document.body.focus());
    await app.key("d");
    assert.equal(app.storage.getItem("emc2.density"), "comfortable");
    await app.click(app.button("Commands"));
    const command = [...app.container.querySelectorAll<HTMLButtonElement>(".command-option")].find(button => button.textContent?.includes("Comfortable / Compact"))!;
    assert.ok(command);
    await app.click(command);
    assert.equal(app.storage.getItem("emc2.density"), "compact");
    await app.click(app.button("Settings"));
    await app.click(app.button("Appearance"));
    assert.equal(density().querySelector('[aria-checked="true"]')?.textContent, "Compact");
    saved = app.storage.getItem("emc2.density")!;
    assert.equal(app.mutations.length, 0);
  } finally { await app.close(); }
  const restarted = await mount(false, (_state, storage) => storage.setItem("emc2.density", saved));
  try { assert.ok(restarted.container.querySelector(".list.compact")); }
  finally { await restarted.close(); }
});


test("browser update banner protects editors and work views and restores the selected mail", async () => {
  let savedNavigation = "";
  for (const mode of ["idle", "compose", "settings", "work", "drafts"] as const) {
    const app = await mount(false, undefined, {}, [], 1200);
    Object.defineProperty(app.window.document, "visibilityState", { configurable: true, value: "visible" });
    let reloads = 0;
    try {
      if (mode !== "work") await app.click(app.button("Inbox"));
      else await app.click(app.button("Today"));
      if (mode === "compose") await app.click(app.button("New message"));
      if (mode === "settings") await app.click(app.button("Settings"));
      if (mode === "drafts") await app.click(app.button("Drafts"));
      if (mode === "idle") await app.open("a:1");
      await act(async () => app.window.dispatchEvent(new app.window.CustomEvent("emc2-update-ready", { detail: "a".repeat(64) })));
      const original = globalThis.window;
      const proxy = new Proxy(original, { get(target, key) { return key === "location" ? { reload: () => { reloads++; } } : Reflect.get(target, key); } });
      try {
        Object.defineProperty(globalThis, "window", { configurable: true, value: proxy });
        await app.click(app.button("Update now"));
      } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: original }); }
      assert.equal(reloads, mode === "idle" ? 1 : 0, mode);
      if (mode === "idle") {
        const saved = JSON.parse(app.window.sessionStorage.getItem("emc2.browser-update-location")!);
        assert.equal(saved.location.view, "inbox");
        assert.equal(saved.location.selectedId, "a:1"); assert.equal(saved.location.opened, true);
        savedNavigation = JSON.stringify(saved);
      }
      if (mode === "compose") assert.ok(app.container.querySelector(".compose-dialog"));
    } finally { await app.close(); }
  }
  const restored = await mount(false, () => window.sessionStorage.setItem("emc2.browser-update-location", savedNavigation), {}, [], 1200, true);
  try { assert.equal(restored.title(), "Alpha"); assert.equal(restored.window.sessionStorage.getItem("emc2.browser-update-location"), null); }
  finally { await restored.close(); }
});

test("browser updates cannot interrupt pending reads or reload after an uncertain write", async () => {
  for (const mode of ["pending", "uncertain", "reported-unknown", "batch-unknown"] as const) {
    const app = await mount(false, undefined, {}, [], 1200);
    Object.defineProperty(app.window.document, "visibilityState", { configurable: true, value: "visible" });
    const fetchBefore = globalThis.fetch;
    try {
      if (mode === "pending") app.holdRead();
      else globalThis.fetch = async (input, options) => {
        if (options?.method === "PATCH") {
          if (mode === "reported-unknown") return Response.json({ state: "unknown" });
          if (mode === "batch-unknown") return Response.json({ results: [{ id: "a:1", accountId: "a", status: "unknown" }] });
          throw new TypeError("Synthetic disconnected write");
        }
        return fetchBefore(input, options);
      };
      await app.open("a:1");
      await act(async () => app.window.dispatchEvent(new app.window.CustomEvent("emc2-update-ready", { detail: "a".repeat(64) })));
      assert.equal(app.button("Update now").disabled, true);
      if (mode === "pending") {
        await app.finishRead();
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
        assert.equal(app.button("Update now").disabled, false, "busy indicator clears on its next activity check");
      }
      else assert.match(app.container.querySelector(".browser-update-notice")?.textContent || "", /unknown outcome/);
    } finally { globalThis.fetch = fetchBefore; await app.close(); }
  }
});


test("Contacts opens as a main view, stays outside Settings and cannot trigger mail shortcuts", async () => {
  const app = await mount();
  try {
    await app.click(app.button("Contacts"));
    assert.equal(app.container.querySelector('#sidebar button[aria-current="page"]')?.textContent?.trim(), "Contacts");
    assert.ok(app.container.querySelector('main[aria-label="Contacts"]'));
    assert.equal(app.container.querySelector('.mail-view'), null);
    assert.equal(app.container.querySelector('[aria-label="Filters"]'), null);
    await app.click(app.button("Import contacts"));
    assert.match(app.container.querySelector('main[aria-label="Contacts"]')!.textContent!, /Destination account/);
    await act(async () => { app.window.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "e", bubbles: true })); });
    assert.deepEqual(app.mutations, []);
    await app.click(app.button("Commands"));
    const archive = [...app.container.querySelectorAll('[role="option"]')].find(item => item.querySelector("span")?.textContent === "Archive")!;
    assert.equal(archive.getAttribute("aria-disabled"), "true");
    await app.click(app.button("Close dialog"));
    await app.click(app.button("Settings"));
    assert.equal(app.container.querySelector('.settings-dialog .settings-navigation')?.textContent?.includes("Contacts"), false);
    await app.click(app.button("Close settings"));
    assert.ok(app.container.querySelector('main[aria-label="Contacts"]'));
  } finally { await app.close(); }
});

test("saved search views restore query, account, filters and sort through keyboard Commands", async () => {
  const app = await mount();
  const press = async (key: string) => act(async () => { app.window.document.activeElement?.dispatchEvent(new app.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  const command = async (label: string) => {
    await app.click(app.button("Commands"));
    await app.input(app.container.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!, label);
    await press("Enter");
  };
  try {
    const search = app.container.querySelector<HTMLInputElement>('.search input')!;
    await app.input(search, "subject:first");
    await app.click(app.account("first@example.com"));
    await app.choose("Read status", "Unread");
    await app.choose("Relevance filter", "Medium relevance");
    await app.choose("Sort mail", "Oldest");
    await app.click(app.button("Filters"));
    await command("Save current view");
    const name = app.container.querySelector<HTMLInputElement>('[aria-label="Save view"] input')!;
    await app.input(name, "Private saved query");
    await act(async () => { name.closest("form")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(app.container.querySelector('[aria-label="Save view"]'), null);
    await app.click(app.button("Inbox"));
    await app.click(app.account("second@example.com"));
    await app.input(search, "different");
    await command("Open Private saved query");
    assert.equal(search.value, "subject:first");
    assert.equal(app.activeAccount(), "first@example.com");
    await app.openFilters();
    assert.equal(app.button("Read status").textContent, "Unread");
    assert.equal(app.button("Relevance filter").textContent, "Medium relevance");
    assert.equal(app.button("Sort mail").textContent, "Oldest");
    await app.click(app.button("Filters"));
    await app.click(app.button("Contacts"));
    assert.ok(app.container.querySelector('main[aria-label="Contacts"]'));
    assert.equal(app.container.querySelector(".save-view-button"), null);
    await command("Open Private saved query");
    assert.equal(app.container.querySelector('main[aria-label="Contacts"]'), null);
    assert.equal(search.value, "subject:first");
    await command("Rename Private saved query");
    const rename = app.container.querySelector<HTMLInputElement>('[aria-label="Rename saved view"] input')!;
    await app.input(rename, "Renamed search");
    await act(async () => { rename.closest("form")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })); });
    await command("Delete Renamed search");
    await app.click(app.button("Delete view"));
    await app.click(app.button("Commands"));
    assert.equal(app.container.textContent?.includes("Renamed search"), false);
    assert.equal(app.mutations.length, 0, "view actions never change mailbox state");
  } finally { await app.close(); }
});

test("saved view names and queries stay hidden in privacy mode", async () => {
  const app = await mount();
  try {
    const search = app.container.querySelector<HTMLInputElement>('.search input')!;
    await app.input(search, "body:confidential");
    await app.click(app.button("Save view"));
    const input = app.container.querySelector<HTMLInputElement>('[aria-label="Save view"] input')!;
    await app.input(input, "Confidential view");
    await act(async () => { input.closest("form")!.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true })); });
    await app.click(app.button("Hide personal information"));
    await app.click(app.button("Commands"));
    assert.equal(app.container.innerHTML.includes("Confidential view"), false);
    assert.equal(app.container.innerHTML.includes("body:confidential"), false);
    assert.ok(app.container.textContent?.includes("Open Saved view 1"));
    await app.key("Escape");
    assert.equal(search.value, "");
  } finally { await app.close(); }
});

test("selecting mail from an Inbox tab moves focus to the rail checkbox", async () => {
  const app = await mount();
  try {
    const tab = app.container.querySelector<HTMLButtonElement>(".inbox-tabs button")!;
    await act(async () => tab.focus());
    assert.equal(app.window.document.activeElement, tab);
    await app.key("a", { metaKey: true });
    const master = app.container.querySelector<HTMLButtonElement>('[aria-label="Select all visible (up to 200)"]')!;
    assert.equal(app.window.document.activeElement, master, "focus leaves the hidden tabs for the master checkbox");
  } finally { await app.close(); }
});
