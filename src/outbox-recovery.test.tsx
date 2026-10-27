import { test } from "node:test";
import { mountedOutbox } from "./outbox-fixture";

test("mounted delayed Undo preserves a newer composer and the recoverable source", { timeout: 60000 }, t => mountedOutbox(t, true));
