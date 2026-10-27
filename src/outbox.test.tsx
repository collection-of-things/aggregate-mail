import { test } from "node:test";
import { mountedOutbox } from "./outbox-fixture";

test("mounted user Send queues, exact keyboard Undo restores the draft, and Off submits once", { timeout: 60000 }, t => mountedOutbox(t, false));
