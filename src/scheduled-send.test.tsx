import { test } from "node:test";
import { mountedScheduled } from "./scheduled-send-fixture";

test("mounted Send later preserves custom time, reschedule, cancel and exact edit recovery", { timeout: 60000 }, mountedScheduled);
