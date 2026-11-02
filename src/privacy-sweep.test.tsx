import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { JSDOM } from "jsdom";
import { compileMailSearch } from "./mail-search";
import type { ContactList, ContactSuggestion } from "../shared/contacts";
import type { Draft, Mail, State } from "../shared/types";

let closeMountedApp: (() => Promise<void>) | undefined;
afterEach(async () => { await closeMountedApp?.(); });

// Every needle is synthetic. With personal information hidden, none may remain
// in rendered text, DOM attributes or field values on an audited surface.
const NEEDLES = [
  "sample person", "sample.person", "other recipient", "other.recipient",
  "nora lane", "nora", "lane",
  "sample-account", "second-account",
  "maya lind", "maya.lind", "third party", "third.party",
  "contact person", "contact.person", "recent.person", "draft.person",
  "import person", "import.person", "renamed person", "earlier person", "rename.person", "example.test",
];

type Violation = { surface: string; needle: string; where: string };

function violations(document: Document, surface: string, blur = true): Violation[] {
  if (blur) (document.activeElement as HTMLElement | null)?.blur();
  const found: Violation[] = [];
  const scan = (text: string | null | undefined, where: string) => {
    if (!text) return;
    const lower = text.toLowerCase();
    for (const needle of NEEDLES)
      if (lower.includes(needle)) found.push({ surface, needle, where });
  };
  scan(document.body?.textContent, "text");
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.getAttributeNames())
      scan(element.getAttribute(attribute), `${element.tagName.toLowerCase()}@${attribute}`);
    if (element instanceof document.defaultView!.HTMLInputElement ||
      element instanceof document.defaultView!.HTMLTextAreaElement)
      scan(element.value, `${element.tagName.toLowerCase()} value`);
  }
  const unique = new Map<string, Violation>();
  for (const hit of found) unique.set(`${hit.surface}|${hit.needle}|${hit.where}`, hit);
  return [...unique.values()];
}

const baseMail = (id: string, accountId: string, fields: Partial<Mail> = {}): Mail => ({
  id, remoteId: id, accountId, category: "important",
  sender: "Sender", address: "sender@example.test", to: "", subject: "Mail",
  preview: "", body: "", date: 1762200000000, unread: false, relevance: 2,
  reason: "", archived: false, snoozedUntil: null, html: null, images: [],
  attachments: [], ...fields,
});

const fixtureMessages = (): Mail[] => [
  baseMail("a:1", "a", {
    sender: "Sample Person", address: "sample.person@example.test",
    to: "Nora Lane <sample-account@example.test>",
    cc: "Other Recipient <other.recipient@example.test>",
    subject: "Plan from Sample Person",
    preview: "Passing the plan to you and Other Recipient.",
    body: "Hi Nora,\nPassing the plan to you and Other Recipient.\nSample Person",
    html: '<p>Hi Nora,</p><p><a href="mailto:sample.person@example.test">Sample Person</a> sent Other Recipient the plan.</p><p><img src="https://images.example.test/photo.png" alt="Photo of Sample Person"></p>',
    images: [{ src: "https://images.example.test/photo.png", alt: "Photo of Sample Person" }],
    unread: true, messageId: "<a1@example.test>", date: 1762200000000,
  }),
  baseMail("b:1", "b", {
    sender: "Maya Lind", address: "maya.lind@example.test",
    to: "second-account@example.test",
    subject: "Maya Lind weekly", preview: "Notes from Maya Lind",
    body: "From Maya Lind", date: 1762190000000,
  }),
  baseMail("s:1", "a", {
    direction: "sent", sender: "Nora Lane", address: "sample-account@example.test",
    to: "Third Party <third.party@example.test>",
    subject: "Third Party sync", preview: "For Third Party", body: "Third Party",
    date: 1762180000000,
  }),
];

const fixtureContacts = (): ContactList => ({
  saved: [{ kind: "saved", id: "c1", accountId: "a", name: "Contact Person", email: "contact.person@example.test", updatedAt: 1 }],
  recent: [{ kind: "recent", id: "r1", accountId: "a", email: "recent.person@example.test", lastSentAt: 1 }],
});

const suggestions: ContactSuggestion[] = [
  { kind: "saved", id: "c1", accountId: "a", name: "Contact Person", email: "contact.person@example.test", updatedAt: 1 },
  { kind: "recent", id: "r1", accountId: "a", email: "recent.person@example.test", lastSentAt: 1 },
];

const fixtureDrafts: Draft[] = [{
  id: "d1", accountId: "a", revision: 1, updatedAt: 1, sendUnknown: false,
  to: ["draft.person@example.test"], subject: "Draft for Draft Person",
  // A plain body with quoted reply text carries correspondent names.
  body: "Draft reply\n\nOn 2026-11-01, Sample Person <sample.person@example.test> wrote:\n> Passing the plan to Other Recipient.",
}, {
  id: "d2", accountId: "a", revision: 1, updatedAt: 1, sendUnknown: false,
  to: ["draft.person@example.test"], subject: "Rich draft",
  body: "Rich plain part",
  html: "<p>Rich note for Sample Person via draft.person@example.test</p>",
}];

const fixtureWorkspace = {
  commitments: [{
    id: "c1", accountId: "a", sourceMailId: "a:1",
    text: "Reply to Sample Person", reason: "Sample Person asked for the plan",
    status: "needs-reply" as const, evidenceMailIds: ["a:1"],
    revision: 1, updatedAt: 1, history: [],
  }],
  projects: [{
    id: "p1", name: "Sample Person plan", sourceMailIds: ["a:1"],
    accountIds: ["a"], crossAccountConfirmed: false, revision: 1, updatedAt: 1,
  }],
  decisions: [], proposals: [], coverage: [],
};

async function mount(
  setup?: (state: State, storage: Storage) => void,
  options: { viewportWidth?: number } = {},
) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/" });
  dom.window.HTMLElement.prototype.scrollTo = function (value?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof value === "number" ? y || 0 : value?.top ?? this.scrollTop;
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
  const state: State = {
    accounts: [
      { id: "a", email: "sample-account@example.test", name: "Nora Lane", provider: "imap" },
      { id: "b", email: "second-account@example.test", provider: "imap" },
    ],
    messages: fixtureMessages(),
    labels: [], rules: [], googleConfigured: false, googleClientId: null,
    jevConfigured: false, jevProvider: "typesafe", aiConfigured: false,
    lastSync: null, syncing: false,
  };
  setup?.(state, dom.window.localStorage);
  let changed: (() => void) | undefined;
  let subscriptions = 0;
  const desktop: NonNullable<Window["desktop"]> = {
    platform: "darwin", materials: false, oauthUrl: "", windowCommand() {},
    onWindowState: () => () => {}, onAccountConnected: () => () => {},
    onMailChanged: (callback) => { changed = callback; return () => { changed = undefined; }; },
    onNavigation: () => { subscriptions++; return () => { subscriptions--; }; },
  };
  (dom.window as unknown as Window).desktop = desktop;
  if (options.viewportWidth !== undefined) {
    delete (dom.window as unknown as Window).desktop;
    const width = options.viewportWidth;
    dom.window.matchMedia = ((query: string) => ({
      matches: /min-width: (\d+)px/.test(query) ? width >= Number(query.match(/min-width: (\d+)px/)![1]) : false,
      media: query, onchange: null, addListener() {}, removeListener() {},
      dispatchEvent() { return true; }, addEventListener() {}, removeEventListener() {},
    })) as typeof dom.window.matchMedia;
  }
  const previousFetch = globalThis.fetch;
  let savedDraft: Draft | undefined;
  globalThis.fetch = async (input, options2) => {
    const url = String(input);
    if (options2?.method === "PATCH") {
      const mail = state.messages.find((item) => url.endsWith(encodeURIComponent(item.id)));
      if (mail) {
        const { action } = JSON.parse(String(options2.body));
        if (action === "read" || action === "unread") mail.unread = action === "unread";
      }
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url === "/api/contacts/import/preview" || url === "/api/contacts/import")
      return { ok: true, json: async () => ({ added: 1, changed: 1, updated: 0, unchanged: 0, missing: 0, skipped: 0,
        sample: [{ name: "Import Person", email: "import.person@example.test" }],
        changes: [{ email: "rename.person@example.test", name: "Renamed Person", previousName: "Earlier Person" }], revision: "synthetic-preview" }) } as Response;
    if (url.startsWith("/api/contacts/suggestions"))
      return { ok: true, json: async () => suggestions } as Response;
    if (url === "/api/contacts")
      return { ok: true, json: async () => fixtureContacts() } as Response;
    if (url.startsWith("/api/messages/search?")) {
      const search = compileMailSearch(new URL(url, "http://localhost").searchParams.get("query") || "", state.accounts);
      return { ok: true, json: async () => ({ mailCursor: "synthetic:0", draftToken: state.draftToken ?? "synthetic-drafts", error: search.error,
        matches: [...state.messages.filter(search.matches).map((mail) => ({ kind: "mail", id: mail.id, accountId: mail.accountId, contentVersion: "synthetic" })),
          ...fixtureDrafts.filter((draft) => { const account = state.accounts.find((a) => a.id === draft.accountId); return account && search.matchesDraft(draft, account); }).map(({ body, attachments, ...draft }) => ({ ...draft, kind: "draft", preview: body.slice(0, 200), attachmentCount: attachments?.length || 0 }))] }) } as Response;
    }
    if (url === "/api/workspace")
      return { ok: true, json: async () => structuredClone(fixtureWorkspace) } as Response;
    if (url.includes("/drafts") && ["POST", "PUT"].includes(options2?.method || "")) {
      savedDraft = { ...JSON.parse(String(options2?.body || "{}")), id: "synthetic-draft", accountId: url.split("/")[3],
        revision: (savedDraft?.revision || 0) + 1, updatedAt: 1 };
      return { ok: true, json: async () => savedDraft } as Response;
    }
    if (url.endsWith("/drafts") || url.includes("/drafts/"))
      return { ok: true, json: async () => {
        if (url.includes("/drafts/"))
          return fixtureDrafts.find((draft) => url.endsWith(`/drafts/${draft.id}`));
        const account = url.match(/\/accounts\/([^/]+)\/drafts$/)?.[1];
        return fixtureDrafts.filter((draft) => !account || draft.accountId === account);
      } } as Response;
    return { ok: true, json: async () => url === "/api/state" ? structuredClone({ ...state, csrf: "synthetic" }) :
      url === "/api/agent/grants" ? [] : url === "/api/mcp" ? { enabled: false, allowSending: false, token: null } :
      url === "/api/sync" ? { errors: [] } : url === "/api/saved-views" ? [] : {} } as Response;
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
  };
  closeMountedApp = close;
  await act(async () => root.render(<App />));
  await act(async () => {
    const inbox = [...container.querySelectorAll<HTMLButtonElement>(".sidebar button")]
      .find((button) => button.textContent?.trim().startsWith("Inbox"));
    inbox?.click();
  });
  const button = (label: string): HTMLButtonElement => {
    const found = [...container.querySelectorAll<HTMLButtonElement>(".settings-navigation button"),
      ...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.getAttribute("aria-label") === label || button.textContent?.trim() === label ||
      button.querySelector(".sidebar-name, .tab-label")?.textContent === label ||
      [...button.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim() === label);
    assert.ok(found, `button ${label}`);
    return found;
  };
  const click = async (target: HTMLElement) => { await act(async () => target.click()); };
  const key = async (value: string) => {
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true })));
  };
  const input = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = field.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  const open = async (id: string) => {
    const row = container.querySelector<HTMLElement>(`[id='mail-${id}']`)!;
    assert.ok(row, `row ${id}`);
    await click(row);
    await act(async () => row.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })));
  };
  const settle = async (ms = 200) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };
  return {
    state, storage: dom.window.localStorage, window: dom.window, container,
    button, click, key, input, open, settle,
    refresh: async () => { await act(async () => changed?.()); },
    violations: (surface: string, blur = true) => violations(dom.window.document, surface, blur),
    close,
  };
}

const privacyOn = (_state: State, storage: Storage) => {
  storage.setItem("privacy", "on");
  storage.setItem("emc2.notifications.v1", JSON.stringify({
    newMail: true, sender: true, subject: true, preview: true, openMail: true,
    duration: 0, sound: "off",
  }));
};

test("privacy sweep: no synthetic identity survives on any audited surface", { timeout: 60000 }, async () => {
  const app = await mount(privacyOn);
  const failures: Violation[] = [];
  const sweep = (surface: string, blur = true) => failures.push(...app.violations(surface, blur));
  try {
    sweep("inbox-list-wide");

    await app.open("a:1");
    sweep("reader-split");

    await app.key("r");
    sweep("reply-compose");
    await app.key("Escape");

    await app.click(app.button("New message"));
    const to = app.container.querySelector<HTMLInputElement>('input[aria-label="To"]')!;
    assert.ok(to, "To field");
    to.focus();
    await app.input(to, "Con");
    await app.settle(160);
    sweep("compose-suggestions", false);
    await act(async () => to.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await app.key("Escape");

    await app.click(app.button("Drafts"));
    sweep("drafts-list");
    // Each saved draft opens in compose; the veiled body must hide both the
    // plain textarea content (including quoted reply text) and the rich HTML.
    for (const [index, surface] of ["draft-compose-plain", "draft-compose-rich"].entries()) {
      await app.click(app.button("Drafts"));
      const row = app.container.querySelectorAll<HTMLElement>(".draft-row")[index];
      assert.ok(row, `${surface} row`);
      await app.click(row);
      await app.settle(50);
      sweep(surface);
      await app.key("Escape");
    }
    await app.click(app.button("Inbox"));
    sweep("sidebar-accounts");

    await app.click(app.button("Settings"));
    await app.click(app.button("Accounts"));
    sweep("settings-accounts");
    await app.click(app.button("Templates and signatures"));
    sweep("settings-compose");
    await app.click(app.button("Close settings"));

    await app.click(app.button("Contacts"));
    await app.settle(50);
    sweep("contacts-saved");
    await app.click(app.button("Recent recipients"));
    sweep("contacts-recent");
    await app.click(app.button("Import contacts"));
    const fileInput = app.container.querySelector<HTMLInputElement>('input[type="file"][accept*=".csv"]')!;
    assert.ok(fileInput, "import file input");
    const file = new app.window.File(["Import Person,import.person@example.test\n"], "import.csv", { type: "text/csv" });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    await act(async () => fileInput.dispatchEvent(new app.window.Event("change", { bubbles: true })));
    await app.settle();
    sweep("contacts-import-preview");

    await app.click(app.button("Today"));
    await app.settle(50);
    sweep("today");
    // The selected task's title names a correspondent; opening the detail must
    // keep it inside the source message's privacy context.
    const task = app.container.querySelector<HTMLElement>(".work-select");
    assert.ok(task, "work task row");
    await app.click(task);
    sweep("today-detail");
    const back = [...app.container.querySelectorAll<HTMLButtonElement>(".work-summary-bar button")]
      .find((item) => item.getAttribute("aria-label") === "Back to work list");
    if (back) await app.click(back);
    await app.click(app.button("Projects"));
    await app.settle(50);
    const project = [...app.container.querySelectorAll<HTMLButtonElement>(".project-filters button")][0];
    assert.ok(project, "project filter");
    await app.click(project);
    sweep("projects");

    await app.click(app.button("Inbox"));
    app.state.unreadArrivals = 1;
    app.state.mailArrivals = [{ sequence: 1, mail: { id: "a:1", sender: "Sample Person", subject: "Plan from Sample Person", preview: "Update from Other Recipient" } }];
    await app.refresh();
    sweep("arrival-toast");

    await app.click(app.button("Commands"));
    await app.settle(50);
    sweep("commands-palette");
  } finally {
    for (const hit of failures)
      console.log(`AUDIT-VIOLATION ${hit.surface} | ${hit.needle} | ${hit.where}`);
    await app.close();
  }
  assert.deepEqual(failures, [], `${failures.length} privacy leaks`);
});

test("privacy sweep: narrow list, privacy restore, reveal and re-hide", { timeout: 60000 }, async () => {
  const failures: Violation[] = [];
  const narrow = await mount(privacyOn, { viewportWidth: 600 });
  try {
    await act(async () => narrow.button("Show sidebar").click());
    failures.push(...narrow.violations("inbox-list-narrow-drawer"));
    await narrow.key("Escape");
  } finally { await narrow.close(); }

  const app = await mount();
  try {
    assert.equal(app.storage.getItem("privacy"), null, "privacy starts off");
    await app.open("a:1");
    const text = () => app.container.textContent || "";
    assert.ok(text().includes("Sample Person"), "privacy off shows the sender");
    assert.ok(text().includes("sample.person@example.test"), "privacy off shows the address");
    assert.ok(text().includes("Nora Lane"), "privacy off shows the account label");

    // Re-hide, then reveal just the sender name from the reader header.
    await app.click(app.button("Hide personal information"));
    const reveal = [...app.container.querySelectorAll<HTMLElement>('[aria-label="Reveal hidden name"]')]
      .find((item) => item.closest(".message"));
    assert.ok(reveal, "sender reveal control");
    await app.click(reveal);
    assert.ok(app.container.querySelector(".message")?.textContent?.includes("Sample Person"), "reveal shows the sender name");

    // Privacy off restores everything; turning it back on re-veils and does not
    // keep the earlier reveal.
    await app.click(app.button("Show personal information"));
    assert.ok(text().includes("Sample Person"), "privacy off restores the sender");
    await app.click(app.button("Hide personal information"));
    const message = app.container.querySelector(".message")?.textContent || "";
    assert.ok(!message.includes("Sample Person"), "re-hidden sender");
    assert.ok(!message.includes("Other Recipient"), "re-hidden recipient");
    failures.push(...app.violations("after-toggle"));
  } finally {
    for (const hit of failures)
      console.log(`AUDIT-VIOLATION ${hit.surface} | ${hit.needle} | ${hit.where}`);
    await app.close();
  }
  assert.deepEqual(failures, [], `${failures.length} privacy leaks`);
});

test("privacy shortcut veils a focused compose body and moves focus to the veil", { timeout: 30000 }, async () => {
  const app = await mount();
  const failures: Violation[] = [];
  try {
    assert.equal(app.storage.getItem("privacy"), null, "privacy starts off");
    await app.click(app.button("New message"));
    const body = app.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message body"]')!;
    assert.ok(body, "compose body");
    await act(async () => body.focus());
    await app.input(body, "Notes for Sample Person");
    // Single-key shortcuts stay with editable fields, so the privacy key is
    // dispatched from a toolbar button inside the body scope.
    const tool = app.container.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!;
    await act(async () => tool.focus());
    await act(async () => tool.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "p", bubbles: true })));
    const veil = app.container.querySelector<HTMLElement>(".compose-veiled-body")!;
    assert.ok(veil, "the focused body becomes the veil");
    assert.equal(veil.textContent, "Hidden. Focus to edit.");
    assert.ok(app.window.document.activeElement === veil, "focus moves to the veil, not the page body");
    failures.push(...app.violations("compose-privacy-toggle", false));
    assert.equal(app.container.innerHTML.includes("Sample Person"), false);
    await act(async () => veil.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const restored = app.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message body"]')!;
    assert.ok(restored, "Enter on the veil restores the editor");
    assert.equal(restored.value, "Notes for Sample Person");
  } finally {
    for (const hit of failures)
      console.log(`AUDIT-VIOLATION ${hit.surface} | ${hit.needle} | ${hit.where}`);
    await app.key("Escape");
    await app.close();
  }
  assert.deepEqual(failures, [], `${failures.length} privacy leaks`);
});
