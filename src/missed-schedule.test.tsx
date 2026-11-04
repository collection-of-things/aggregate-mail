import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { Window as DOMWindow } from "happy-dom";
import { OutboxNotices } from "./compose/OutboxNotices";
import type { Api } from "./api";
import type { OutboxStatus } from "../shared/types";

const hour = 3600000;
const entry = (id: string, value: Partial<OutboxStatus>): OutboxStatus => ({ id, accountId: "a", sourceDraftId: `00000000-0000-4000-8000-00000000000${id}`,
  sourceRevision: 1, state: "pending", createdAt: 1, updatedAt: 1, dueAt: 1, review: true, ...value });

async function mount(entries: OutboxStatus[], scheduledOnly: boolean) {
  const dom = new DOMWindow({ url: "http://localhost/", settings: {
    enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
    enableImageFileLoading: false, navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
  } });
  const globals = { window: dom, document: dom.document, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const prior = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const requests: string[] = [];
  const missed: number[] = [];
  const api = (async (url: string, method = "GET") => {
    requests.push(`${method} ${url}`);
    return structuredClone(entries);
  }) as Api;
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const render = async (refreshKey: number) => {
    await act(async () => root.render(<OutboxNotices api={api} enabled blocked={false} refreshKey={refreshKey} scheduledOnly={scheduledOnly}
      onScheduled={() => {}} onMissed={(count) => missed.push(count)} onEdit={() => {}} onNotice={() => {}} onChanged={() => {}} />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  };
  await render(0);
  return { container, requests, missed, render,
    button: (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === name),
    close: async () => {
      await act(async () => root.unmount());
      await dom.happyDOM.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("missed schedules raise one grouped, content-free alert that persists until dismissed", async () => {
  const now = Date.now();
  const entries = [
    entry("1", { scheduledFor: now - 2 * hour, dueAt: now - 2 * hour }),
    entry("2", { scheduledFor: now - hour, dueAt: now - hour }),
    entry("3", { scheduledFor: now + hour, dueAt: now + hour }),
    entry("4", { scheduledFor: now - hour, dueAt: now - hour, state: "unknown" }),
  ];
  const ui = await mount(entries, false);
  try {
    const alert = () => ui.container.querySelector('[role="alert"]')?.textContent;
    assert.equal(alert(), "2 scheduled messages were missed and not sent. Nothing is sent without Send now.");
    assert.deepEqual(ui.missed, [2], "one grouped desktop alert, not one per message");
    await ui.render(1);
    assert.deepEqual(ui.missed, [2], "repeated polls do not repeat the alert");
    assert.ok(alert(), "the alert is persistent, not a timed toast");
    await act(async () => ui.button("Dismiss")!.click());
    assert.equal(alert(), undefined);
    assert.match(ui.container.textContent!, /Scheduled mail needs review/);
    await ui.render(2);
    assert.equal(alert(), undefined, "dismissal holds while the same messages stay missed");
    entries.push(entry("5", { scheduledFor: now - 60000, dueAt: now - 60000 }));
    await ui.render(3);
    assert.equal(alert(), "3 scheduled messages were missed and not sent. Nothing is sent without Send now.");
    assert.deepEqual(ui.missed, [2, 3]);
    entries.splice(0, entries.length, entries[2]);
    await ui.render(4);
    assert.equal(alert(), undefined, "resolving every missed message clears the alert");
    assert.ok(ui.requests.every((request) => request === "GET /outbox"), "nothing is sent automatically");
  } finally { await ui.close(); }
});

test("Scheduled labels overdue held entries Missed with the original local time and keeps future holds distinct", async () => {
  const now = Date.now();
  const due = now - 2 * hour, later = now + hour;
  const ui = await mount([
    entry("1", { scheduledFor: due, dueAt: due }),
    entry("3", { scheduledFor: later, dueAt: later }),
  ], true);
  try {
    const [missed, future] = [...ui.container.querySelectorAll(".toast")];
    assert.equal(missed.querySelector(".toast-title")!.textContent, "Missed");
    assert.match(missed.textContent!, new RegExp(`Scheduled for ${new Date(due).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(missed.textContent!, /Missed its scheduled time and was not sent/);
    assert.deepEqual([...missed.querySelectorAll("button")].map((button) => button.textContent), ["Send now", "Edit", "Reschedule", "Cancel schedule", "Discard"]);
    assert.equal(future.querySelector(".toast-title")!.textContent, "Scheduled message");
    assert.doesNotMatch(future.textContent!, /Missed/);
    assert.deepEqual(ui.missed, [], "the Scheduled list does not raise its own alert");
    assert.ok(ui.requests.every((request) => request === "GET /outbox"));
  } finally { await ui.close(); }
});
