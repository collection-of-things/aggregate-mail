import { useRef, useState } from "react";
import type { Perform } from "./api";

// Each background submission names the resource it can change. Never use the
// aggregate pending bit to disable navigation or unrelated forms.
export type ActionScope =
  | { kind: "account"; accountId: string }
  | { kind: "settings"; section: "connection" | "backup" | "sorting" | "privacy" | "branding" | "mcp" | "compose" }
  | { kind: "connect" };
export type ScopedPerform = (scope: ActionScope, ...args: Parameters<Perform>) => ReturnType<Perform>;

export const exclusiveScope = (scope: ActionScope) => scope.kind === "settings" &&
  (scope.section === "connection" || scope.section === "backup");
const key = (scope: ActionScope) => JSON.stringify(scope.kind === "account" ? [scope.kind, scope.accountId] :
  scope.kind === "settings" ? [scope.kind, scope.section] : [scope.kind]);
const backup = (scope: ActionScope) => scope.kind === "settings" && scope.section === "backup";
const providerWork = (scope: ActionScope) => scope.kind !== "settings" ||
  scope.section === "connection" || scope.section === "sorting";
const conflicts = (a: ActionScope, b: ActionScope) => key(a) === key(b) || backup(a) || backup(b) ||
  (exclusiveScope(a) && providerWork(b)) || (exclusiveScope(b) && providerWork(a));

export function createBackgroundActions(changed: () => void) {
  const active = new Map<string, ActionScope>();
  const blocked = (scope: ActionScope) => [...active.values()].some(item => conflicts(item, scope));
  const blocksMail = (accountId: string) => [...active.values()].some(scope => exclusiveScope(scope) ||
    scope.kind === "account" && scope.accountId === accountId);
  const run = async <T,>(scope: ActionScope, task: () => Promise<T>): Promise<T> => {
    if (blocked(scope)) throw new Error("An action for this resource is already in progress.");
    const id = key(scope);
    active.set(id, scope); changed();
    try { return await task(); }
    finally { active.delete(id); changed(); }
  };
  return { get pending() { return active.size > 0; }, blocked, blocksMail, run };
}

export function useBackgroundActions() {
  const [, changed] = useState(0);
  const actions = useRef<ReturnType<typeof createBackgroundActions> | null>(null);
  if (!actions.current) actions.current = createBackgroundActions(() => changed(value => value + 1));
  return actions.current;
}
