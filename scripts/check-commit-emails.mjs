// Fails when a commit in the given range would publish a personal email
// address. Checks authors, committers and Co-authored-by trailers. Allowed:
// GitHub noreply addresses, GitHub's own web-flow committer, and fixed
// no-reply addresses of tools that co-author commits.
//
// Usage: node scripts/check-commit-emails.mjs <base>..<head>
import { execFileSync } from "node:child_process";

const allowed = [
  /^(\d+\+)?[A-Za-z0-9-]+(\[bot\])?@users\.noreply\.github\.com$/,
  /^noreply@github\.com$/,
  /^noreply@anthropic\.com$/,
];

// CI logs are public, so a rejected address is shown masked.
export const mask = (email) => email.replace(/^([^@]?)[^@]*(@.*)?$/, (_, first, domain = "") => `${first}*****${domain}`);

export function emailProblems(log) {
  const problems = [];
  for (const record of log.split("\x1e").map((entry) => entry.trim()).filter(Boolean)) {
    const [sha, author, committer, body = ""] = record.split("\x00");
    const trailers = [...body.matchAll(/^co-authored-by:[^<\n]*<([^>\n]+)>/gim)].map((match) => match[1]);
    for (const [role, email] of [["author", author], ["committer", committer], ...trailers.map((value) => ["co-author", value])]) {
      if (!allowed.some((pattern) => pattern.test(email.trim()))) problems.push(`${sha.slice(0, 7)} ${role} ${mask(email.trim())}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const range = process.argv[2];
  // Git receives the range as one argument without a shell; refuse options.
  if (!range || !/^[^\s-][^\s]*\.\.[^\s]+$/.test(range)) {
    console.error("Usage: node scripts/check-commit-emails.mjs <base>..<head>, e.g. origin/main..HEAD");
    process.exit(2);
  }
  const log = execFileSync("git", ["log", "--format=%H%x00%ae%x00%ce%x00%B%x1e", range], { encoding: "utf8" });
  const problems = emailProblems(log);
  if (problems.length) {
    console.error("These commits would publish email addresses that are not GitHub noreply addresses:");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error("Turn on GitHub's \"Keep my email addresses private\" setting, set git user.email to your");
    console.error("<id>+<login>@users.noreply.github.com address, then rewrite these commits.");
    process.exit(1);
  }
  console.log(`Commit emails in ${range}: all noreply.`);
}
