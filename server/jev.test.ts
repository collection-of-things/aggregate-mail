import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, sortMail, SortingUnavailable } from "./sorting.js";

const mail = {
  address: "no-reply@accounts.google.com",
  subject: "Security alert for you@example.com",
  preview: "A new sign-in on Windows. If this wasn't you, reset your password.",
};

const answer = (answers: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: "jev-1.13.0",
    answers,
    usage: { input_tokens: 120, output_tokens: 24 },
  }),
});

// The three answer shapes documented for POST /v1/systemone.
const choice = (value: string) => ({
  type: "choice",
  choice: value,
  confidence: 0.88,
  probabilities: { [value]: 0.88 },
});
const score = (value: number) => ({
  type: "score",
  score: value,
  confidence: 0.35,
  legend: { "0": "bulk", "1": "routine", "2": "urgent" },
  probabilities: { "0": 0, "1": 0.57, "2": 0.43 },
});

function mockJev(t: { mock: { method: Function } }, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return typeof body === "function" ? body() : answer(body);
    }) as unknown as typeof fetch,
  );
  return calls;
}

test("a Jev answer becomes a classification", async (t) => {
  process.env.TYPESAFE_API_KEY = "test-jev-key";
  delete process.env.OPENAI_API_KEY;
  const calls = mockJev(t, {
    category: choice("important"),
    relevance: score(2),
    reason: choice("Security alert"),
  });

  assert.deepEqual(await classify(mail, []), {
    category: "important",
    relevance: 3,
    reason: "Security alert",
  });

  const [call] = calls;
  assert.equal(call.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(
    (call.init.headers as Record<string, string>).Authorization,
    "Bearer test-jev-key",
  );
  const body = JSON.parse(String(call.init.body));
  assert.equal(body.model, "jev-latest");
  assert.match(body.state, /^From: no-reply@accounts\.google\.com\n/);
  assert.match(body.state, /\nSubject: Security alert/);
  assert.equal(body.questions.category.type, "choice");
  assert.equal(body.questions.relevance.type, "score");
  assert.deepEqual(Object.keys(body.questions.category.criteria), [
    "important",
    "other",
  ]);
  assert.equal(body.questions.relevance.criteria.length, 3);
  assert.ok(body.questions.reason.criteria["Needs a reply"]);
});

test("a fractional score rounds to a relevance level", async (t) => {
  process.env.TYPESAFE_API_KEY = "test-jev-key";
  mockJev(t, {
    category: choice("other"),
    relevance: score(1.43),
    reason: choice("Receipt"),
  });
  assert.deepEqual(await classify(mail, []), {
    category: "other",
    relevance: 2,
    reason: "Receipt",
  });
});

test("the provider picks the endpoint and model, and both can be overridden", async (t) => {
  process.env.TYPESAFE_API_KEY = "test-jev-key";
  const calls = mockJev(t, {
    category: choice("other"),
    relevance: score(1),
    reason: choice("Newsletter"),
  });
  const target = async (index: number) => ({
    url: calls[index].url,
    model: JSON.parse(String(calls[index].init.body)).model,
  });

  process.env.TYPESAFE_PROVIDER = "typesafe";
  assert.equal((await classify(mail, [])).relevance, 2);
  assert.deepEqual(await target(0), {
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
  });

  // OpenRouter runs the same decision shapes at a different path.
  process.env.TYPESAFE_PROVIDER = "openrouter";
  await classify(mail, []);
  assert.deepEqual(await target(1), {
    url: "https://openrouter.ai/api/alpha/decisions",
    model: "typesafe/jev-1.13",
  });

  // The gateway keeps the path but not the model name.
  process.env.TYPESAFE_PROVIDER = "vercel";
  await classify(mail, []);
  assert.deepEqual(await target(2), {
    url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    model: "typesafe-ai/jev",
  });

  // Anything else can be named outright, including a local endpoint.
  delete process.env.TYPESAFE_PROVIDER;
  process.env.TYPESAFE_ENDPOINT = "http://127.0.0.1:4599/v1/systemone";
  process.env.TYPESAFE_MODEL = "my-model";
  await classify(mail, []);
  assert.deepEqual(await target(3), {
    url: "http://127.0.0.1:4599/v1/systemone",
    model: "my-model",
  });

  process.env.TYPESAFE_ENDPOINT = "ws://127.0.0.1:4599";
  await assert.rejects(classify(mail, []), (error: Error) => {
    assert.match(error.message, /requires HTTPS/);
    return true;
  });

  delete process.env.TYPESAFE_PROVIDER;
  delete process.env.TYPESAFE_ENDPOINT;
  delete process.env.TYPESAFE_MODEL;
});

test("sender rules still outrank Jev, and an unreadable answer falls back", async (t) => {
  process.env.TYPESAFE_API_KEY = "test-jev-key";
  const calls = mockJev(t, {});
  const rules = [
    {
      id: "r",
      sender: mail.address,
      instruction: "Always important",
      category: "important" as const,
      relevance: 3 as const,
    },
  ];
  assert.deepEqual(await classify(mail, rules), {
    category: "important",
    relevance: 3,
    reason: "Always important",
  });
  assert.equal(calls.length, 0);

  t.mock.restoreAll();
  mockJev(t, { category: choice("other") });
  await assert.rejects(classify(mail, []), (error: Error) => {
    assert.ok(error instanceof SortingUnavailable);
    assert.match(error.message, /could not read/);
    return true;
  });
});

test("a rejected key and a rejected request are reported", async (t) => {
  process.env.TYPESAFE_API_KEY = "test-jev-key";
  let status = 401;
  mockJev(t, () => ({ ok: false, status, json: async () => ({}) }));

  await assert.rejects(classify(mail, []), (error: Error) => {
    assert.ok(error instanceof SortingUnavailable);
    assert.match(error.message, /rejected the API key/);
    return true;
  });

  status = 529;
  await assert.rejects(classify(mail, []), (error: Error) => {
    assert.match(error.message, /HTTP 529/);
    return true;
  });
});

test("without a key the heuristics run and nothing is sent", async (t) => {
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const calls = mockJev(t, {});
  assert.deepEqual(await classify(mail, []), sortMail(mail, []));
  assert.equal(calls.length, 0);
});


test("remote plaintext classification endpoints never receive credentials", async t => {
  process.env.TYPESAFE_API_KEY = "synthetic-key";
  const calls = mockJev(t, {});
  try {
    for (const endpoint of ["http://model.example.test/v1", "http://localhost.example.test/v1", "https://user:pass@model.example.test/v1"]) {
      process.env.TYPESAFE_ENDPOINT = endpoint;
      await assert.rejects(classify(mail, []), SortingUnavailable);
    }
    assert.equal(calls.length, 0);
  } finally { delete process.env.TYPESAFE_ENDPOINT; }
});
