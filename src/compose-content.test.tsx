import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMarkup, validComposeMarkup, plainComposeHtml, changeComposeText, COMPOSE_HTML_LIMIT } from "../shared/compose-content";

test("outbound formatting has a canonical safe subset and faithful text alternative", () => {
  const content = composeMarkup('<p><b>Hello</b> <i>team</i> <u>today</u></p><ul><li>First</li><li>Second</li></ul><blockquote>Quoted</blockquote><a href="https://example.com/">Details</a>');
  assert.equal(content.html, '<p><strong>Hello</strong> <em>team</em> <u>today</u></p><ul><li>First</li><li>Second</li></ul><blockquote>Quoted</blockquote><a href="https://example.com/">Details</a>');
  assert.equal(content.body, 'Hello team today\n- First\n- Second\n> Quoted\nDetails (https://example.com/)');
  assert.ok(validComposeMarkup(content));
  assert.equal(validComposeMarkup({ ...content, body: "Different" }), false);
  assert.equal(validComposeMarkup({ body: "Plain default" }), true);
  assert.equal(plainComposeHtml('<hello>\nA & B'), '&lt;hello&gt;<br>A &amp; B');
});
test("outbound markup rejects active resources, attributes, unsafe links and budgets at the trusted boundary", () => {
  for (const html of ['<script>alert(1)</script>', '<img src="https://example.com/track">', '<p onclick="x()">Text</p>', '<style>@import "https://example.com/font";</style>', '<a href="javascript:alert(1)">Unsafe</a>', '<div style="background:url(https://example.com/)">Text</div>', '<iframe src="https://example.com/"></iframe>']) {
    assert.equal(validComposeMarkup({ html, body: "Text" }), false);
    assert.doesNotMatch(composeMarkup(html).html, /script|onclick|style|img|iframe|javascript:/);
  }
  assert.throws(() => composeMarkup('x'.repeat(COMPOSE_HTML_LIMIT + 1)));
  assert.throws(() => composeMarkup('<div>'.repeat(50)+'x'+'</div>'.repeat(50)));
  assert.throws(() => composeMarkup('<br>'.repeat(4001)));
});
test("template and signature text changes preserve preceding formatting", () => {
  const value = composeMarkup('<strong>Hello</strong><br><br>-- <br>Old signature');
  const next = changeComposeText(value, value.body.replace('Old signature', 'New signature'));
  assert.match(next.html!, /<strong>Hello<\/strong>/);
  assert.equal(next.body, 'Hello\n\n-- \nNew signature');
  assert.ok(validComposeMarkup(next));
});


test("rich suffix changes preserve paragraph boundaries and intentional trailing newlines", () => {
  const value = composeMarkup('<p><strong>Hello</strong></p>');
  for (const body of ['Hello\n\n-- \nSignature', 'Hello again', 'Hello\n']) {
    const next = changeComposeText(value, body);
    assert.equal(next.body, body);
    assert.match(next.html!, /<strong>Hello<\/strong>/);
    assert.ok(validComposeMarkup(next));
  }
  assert.equal(composeMarkup(plainComposeHtml('Hello\n')).body, 'Hello\n');
  assert.ok(validComposeMarkup(composeMarkup('<span><p>Hello</p></span>')));
});

test("plain alternatives preserve inline-to-block boundaries", () => {
  for (const [html, body] of [
    ['Hello<div>World</div>', 'Hello\nWorld'],
    ['Hello<p>World</p>Again', 'Hello\nWorld\nAgain'],
    ['Hello<ul><li>World</li></ul>', 'Hello\n- World'],
    ['Hello<blockquote>World</blockquote>', 'Hello\n> World'],
  ]) assert.equal(composeMarkup(html).body, body);
});
test("ordered-list ordinals ignore whitespace nodes", () => {
  const value = composeMarkup('<ol>\n<li>First</li>\n<li>Second</li>\n</ol>');
  assert.equal(value.body, '1. First\n2. Second');
  assert.ok(validComposeMarkup(value));
});

test("template suffixes retain complete lists and quotes while explicit newlines remain visible", () => {
  for (const html of ['<ul><li>First</li><li>Second</li></ul>', '<blockquote>Quoted</blockquote>', '<p><strong>Hello</strong></p>']) {
    const value = composeMarkup(html);
    const next = changeComposeText(value, value.body + '\n\n-- \nSignature');
    assert.equal(next.body, value.body + '\n\n-- \nSignature');
    assert.ok(next.html!.startsWith(value.html));
    assert.ok(validComposeMarkup(next));
  }
  const pasted = composeMarkup('First\nSecond');
  assert.equal(pasted.html, 'First<br>Second');
  assert.equal(pasted.body, 'First\nSecond');
});
