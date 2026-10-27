import assert from "node:assert/strict";
import { test } from "node:test";
import { contactImportSchema, MAX_CONTACT_FILE_BYTES, parseContactImport } from "./contact-import.js";

test("Google CSV accepts BOM, quoted names, multiple emails and skips repeated or invalid addresses", () => {
  const result = parseContactImport('\uFEFFName,E-mail 1 - Value,E-mail 2 - Value\r\n"Person, A",a@example.test,b@example.test\r\nAgain,A@example.test,invalid\r\n"Line\nbreak",c@example.test,\r\nNo email,,', "csv");
  assert.deepEqual(result, { contacts: [{ name: "Person, A", email: "a@example.test" }, { name: "Person, A", email: "b@example.test" }], skipped: 4 });
});

test("Yahoo and Outlook CSV headers produce names and supported email columns", () => {
  assert.deepEqual(parseContactImport('First Name,Middle Name,Last Name,Email,Alternate Email 1\nA,B,C,a@example.test,b@example.test', "csv").contacts, [{ name: "A B C", email: "a@example.test" }, { name: "A B C", email: "b@example.test" }]);
  assert.equal(parseContactImport('First Name,Last Name,E-mail Address,E-mail 2 Address\nA,B,a@example.test,b@example.test', "csv").contacts.length, 2);
  assert.equal(parseContactImport('First Name,Last Name,Email 1 - Value\nA,B,a@example.test', "csv").contacts[0].name, "A B");
});

test("vCard supports Apple grouped properties, folded UTF-8 names, escaped separators and multiple emails", () => {
  const result = parseContactImport('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Person\\,\r\n  A\r\nitem1.EMAIL;type=INTERNET:a@example.test\r\nEMAIL:b@example.test\r\nPHOTO;VALUE=URI:https://example.test/photo\r\nEND:VCARD\r\nBEGIN:VCARD\nVERSION:4.0\nN:Family;Given;Middle;;\nEMAIL:mailto:c@example.test\nEND:VCARD', "vcf");
  assert.deepEqual(result.contacts, [{ name: "Person, A", email: "a@example.test" }, { name: "Person, A", email: "b@example.test" }, { name: "Given Middle Family", email: "c@example.test" }]);
});

test("malformed, binary, oversized and encoded imports fail closed", () => {
  for (const input of ['Name,Email\n"unfinished,a@example.test', 'Name,Email\n"A"oops,a@example.test', 'Unknown\na@example.test', '\0Email\na@example.test']) assert.throws(() => parseContactImport(input, "csv"));
  for (const input of ['BEGIN:VCARD\nFN:Missing end', 'BEGIN:VCARD\nBEGIN:VCARD\nEND:VCARD', 'BEGIN:VCARD\nFN;ENCODING=QUOTED-PRINTABLE:Person\nEND:VCARD']) assert.throws(() => parseContactImport(input, "vcf"));
  assert.throws(() => parseContactImport('x'.repeat(MAX_CONTACT_FILE_BYTES + 1), "csv"));
  assert.throws(() => parseContactImport('Name,Email\n' + 'A,a@example.test\n'.repeat(5001), "csv"));
  assert.equal(contactImportSchema.safeParse({ accountId: "a", format: "csv", content: "é".repeat(MAX_CONTACT_FILE_BYTES) }).success, false);
});
