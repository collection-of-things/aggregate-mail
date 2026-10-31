// Made-up accounts and mail for interface work (`npm run dev:demo`). The fake
// provider replaces every IMAP-family provider, so the real sync, parsing,
// sorting and storage paths run without contacting a mail server. Read,
// archive, trash and send are remembered in demo-state.json beside the store.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { createDraft } from "./drafts.js";
import { parse, providers, type Incoming, type SendInput } from "./providers.js";
import { get, put, type StoredAccount } from "./store.js";
import type { Mail, Provider } from "../shared/types.js";

type ComposerOptions = ConstructorParameters<typeof MailComposer>[0];
type DemoMessage = {
  account: string;
  uid: number;
  minutesAgo: number;
  from: string;
  subject: string;
  text: string;
  html?: string;
  unread?: boolean;
  to?: string;
  cc?: string;
  inReplyTo?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; contentType: string; content: string }[];
  // Starts `inDays` after the demo was created, at `hour` local time.
  invite?: { title: string; inDays: number; hour: number; minutes: number; location: string };
};
type DemoState = {
  createdAt: number;
  read: string[];
  removed: string[];
  sent: { accountId: string; uid: number; date: number; source: string }[];
  // Drafts and workspace records are seeded once, so what the user deletes stays deleted.
  draftsSeeded?: boolean;
  workspaceSeeded?: boolean;
};

const hour = 60;
const day = 24 * hour;
export const demoAccounts: StoredAccount[] = [
  { id: "demo-work", email: "alex@northwind.example", name: "Northwind", provider: "fastmail", credentials: {} },
  { id: "demo-personal", email: "alex.rivera@icloud.example", name: "Personal", provider: "icloud", credentials: {} },
  { id: "demo-studio", email: "hello@pinecone-studio.example", name: "Studio", provider: "imap", credentials: {} },
];
const messageId = (account: string, uid: number, sent = false) => `<demo-${account}-${sent ? "sent-" : ""}${uid}@emc2.demo>`;
const unsubscribe = { "List-Unsubscribe": "<https://example.com/unsubscribe>" };

export const demoMessages: DemoMessage[] = [
  // Northwind (work)
  {
    account: "demo-work", uid: 1, minutesAgo: 4, unread: true,
    from: "Priya Shah <priya@northwind.example>",
    subject: "Can you review the Q4 launch plan before Thursday?",
    text: "Hi Alex,\n\nI've attached the latest launch plan. The big open question is whether we hold the pricing change until after the holiday freeze or ship it with the launch.\n\nCould you look at the timeline tab and tell me if the QA window looks realistic? I'd like to send this to leadership on Thursday morning.\n\nThanks!\nPriya",
    attachments: [{ filename: "q4-launch-plan.csv", contentType: "text/csv", content: "Milestone,Owner,Date\nFeature freeze,Priya,2026-11-04\nQA window,Marcus,2026-11-05\nLaunch,Alex,2026-11-18\n" }],
  },
  {
    account: "demo-work", uid: 2, minutesAgo: 22, unread: true,
    from: "Linear <notifications@linear.app>",
    subject: "NW-482 Checkout button jumps on slow networks",
    text: "Marcus Bell moved NW-482 from In Progress to In Review.\n\nCheckout button jumps on slow networks\nPriority: High · Cycle 41\n\nView issue: https://linear.app/northwind/issue/NW-482",
  },
  {
    account: "demo-work", uid: 3, minutesAgo: 48, unread: true,
    from: "GitHub <notifications@github.com>",
    subject: "[northwind/web] Fix flaky checkout test (#1287)",
    text: "@samlee requested your review on: northwind/web#1287 Fix flaky checkout test.\n\nThe test waited on a fixed timeout. It now waits for the checkout frame to report ready.\n\n3 files changed, 41 additions, 18 deletions.",
  },
  {
    account: "demo-work", uid: 4, minutesAgo: 95, unread: true,
    from: "Marcus Bell <marcus@northwind.example>",
    subject: "Re: Pricing page copy",
    inReplyTo: messageId("demo-work", 1, true),
    text: "Love the new headline. Two small things:\n\n1. \"Unlimited seats\" should be \"Unlimited viewers\" — editors are still per-seat.\n2. Can we move the FAQ above the comparison table? Most support tickets come from people who never scrolled that far.\n\nOtherwise ship it.\n\nOn Thu, Alex Rivera wrote:\n> Here's the draft for the new pricing page. Let me know what you think.",
  },
  {
    account: "demo-work", uid: 5, minutesAgo: 2 * hour,
    from: "Dana Okafor <dana@northwind.example>",
    subject: "Invitation: Design review",
    text: "Let's walk through the checkout redesign together. Bring your questions about the mobile flow.",
    invite: { title: "Design review", inDays: 1, hour: 15, minutes: 45, location: "Room 4B" },
  },
  {
    account: "demo-work", uid: 6, minutesAgo: 3 * hour,
    from: "Stripe <receipts@stripe.com>",
    subject: "Your receipt from Northwind Cloud #2291-4410",
    text: "Receipt from Northwind Cloud\n\nAmount paid: $1,240.00\nDate paid: today\nPayment method: Visa ending in 4242\n\nTeam plan (20 seats) — $1,240.00",
    html: "<h2>Receipt from Northwind Cloud</h2><p>Receipt #2291-4410</p><table><tr><td>Team plan (20 seats)</td><td><strong>$1,240.00</strong></td></tr><tr><td>Payment method</td><td>Visa ending in 4242</td></tr></table><p>Questions? Reply to this email.</p>",
  },
  {
    account: "demo-work", uid: 7, minutesAgo: 5 * hour,
    from: "Vercel <notifications@vercel.com>",
    subject: "Failed production deployment on northwind-web",
    text: "The deployment of northwind-web to production failed.\n\nBuild error: Type error in src/checkout/Summary.tsx line 88.\nCommit: 4f2a9c1 \"Tidy summary totals\"",
  },
  {
    account: "demo-work", uid: 8, minutesAgo: day + 2 * hour,
    from: "Priya Shah <priya@northwind.example>",
    subject: "Notes from Tuesday's sync",
    text: "Notes from Tuesday's sync\n\nDecisions\n- Launch stays on November 18.\n- Pricing change ships with the launch.\n\nOpen questions\n- Do we need a migration email for annual customers?\n- Who owns the status page during launch week?\n\nAction items\n- Alex: review the launch plan\n- Marcus: finish checkout QA\n- Dana: share the final designs",
    html: "<h2>Notes from Tuesday's sync</h2><h3>Decisions</h3><ul><li>Launch stays on <strong>November 18</strong>.</li><li>Pricing change ships with the launch.</li></ul><h3>Open questions</h3><ul><li>Do we need a migration email for annual customers?</li><li>Who owns the status page during launch week?</li></ul><h3>Action items</h3><table><tr><th>Owner</th><th>Task</th></tr><tr><td>Alex</td><td>Review the launch plan</td></tr><tr><td>Marcus</td><td>Finish checkout QA</td></tr><tr><td>Dana</td><td>Share the final designs</td></tr></table><p>Full doc: <a href=\"https://example.com/northwind/sync-notes\">Tuesday sync notes</a></p>",
  },
  {
    account: "demo-work", uid: 9, minutesAgo: day + 4 * hour,
    from: "Figma <no-reply@figma.com>",
    subject: "Leo commented on Checkout v3",
    text: "Leo Martins commented on Checkout v3:\n\n\"The address step feels long on mobile. Could we collapse the optional fields?\"",
  },
  {
    account: "demo-work", uid: 10, minutesAgo: 2 * day,
    from: "Okta <noreply@okta.com>",
    subject: "New sign-in to your Northwind account",
    text: "We noticed a new sign-in to your Northwind account.\n\nDevice: Safari on macOS\nLocation: Berlin, Germany\n\nIf this was you, there's nothing to do. If not, reset your password right away.",
  },
  {
    account: "demo-work", uid: 11, minutesAgo: 3 * day,
    from: "Jordan Kim <jordan@acme-logistics.example>",
    subject: "Contract renewal — two questions",
    cc: "Priya Shah <priya@northwind.example>",
    text: "Hi Alex,\n\nWe're preparing the renewal for next year and have two questions:\n\n1. Can we switch to an annual contract mid-term?\n2. Is the API rate limit on the Business plan per workspace or per account?\n\nA quick answer before Friday would help us close this out.\n\nBest,\nJordan",
  },
  {
    account: "demo-work", uid: 12, minutesAgo: 6 * day,
    from: "Notion <notify@mail.notion.so>",
    subject: "Weekly digest: 12 updates in Northwind HQ",
    headers: unsubscribe,
    text: "Here's what changed in Northwind HQ this week.\n\n- Launch plan (edited by Priya)\n- Checkout QA checklist (edited by Marcus)\n- Brand guidelines (new comments)",
  },
  {
    account: "demo-work", uid: 13, minutesAgo: 12 * day,
    from: "People Team <people@northwind.example>",
    subject: "Reminder: submit your expenses by Friday",
    text: "A friendly reminder that October expenses are due this Friday. Anything older than 60 days can't be reimbursed.",
  },
  {
    account: "demo-work", uid: 14, minutesAgo: 21 * day,
    from: "Marcus Bell <marcus@northwind.example>",
    subject: "Offsite photos",
    text: "Finally got around to uploading the offsite photos. The one of the boat is my favourite.",
    html: "<p>Finally got around to uploading the offsite photos. The one of the boat is my favourite.</p><p><img src=\"https://picsum.photos/seed/emc2-offsite/640/360\" alt=\"Team on a boat at the offsite\" width=\"640\" height=\"360\"></p><p><a href=\"https://example.com/offsite-album\">See the full album</a></p>",
  },

  // Personal
  {
    account: "demo-personal", uid: 1, minutesAgo: 9, unread: true,
    from: "Linda Rivera <linda.rivera@example.com>",
    subject: "Sunday dinner?",
    text: "Hi sweetheart,\n\nAre you and Sam free for dinner on Sunday? Dad wants to try the new lasagna recipe. Let me know by Friday so I can shop.\n\nLove,\nMom",
  },
  {
    account: "demo-personal", uid: 2, minutesAgo: 35, unread: true,
    from: "Acme Bank <alerts@acmebank.example>",
    subject: "Your sign-in code",
    text: "Your one-time code is 482913. It expires in 10 minutes. Never share this code with anyone.",
  },
  {
    account: "demo-personal", uid: 3, minutesAgo: hour, unread: true,
    from: "LinkedIn <notifications-noreply@linkedin.com>",
    subject: "Maya Chen mentioned you in a comment",
    text: "Maya Chen mentioned you in a comment: \"@Alex Rivera ran the best launch retro I've been part of.\"",
  },
  {
    account: "demo-personal", uid: 4, minutesAgo: 2 * hour,
    from: "X <notify@x.com>",
    subject: "@devrel_sam replied to your post",
    text: "@devrel_sam replied to your post: \"Totally agree, small PRs are underrated.\"",
  },
  {
    account: "demo-personal", uid: 5, minutesAgo: 4 * hour, unread: true,
    from: "Lenny's Newsletter <lenny@substack.com>",
    subject: "How the best teams run planning",
    headers: unsubscribe,
    text: "How the best teams run planning\n\nThis week: what 40 product teams told us about quarterly planning, and the three habits the best ones share.",
    html: "<h1>How the best teams run planning</h1><p>This week: what 40 product teams told us about quarterly planning, and the three habits the best ones share.</p><ol><li><strong>Write the bets down.</strong> Every team that hit its goals had a one-page list of bets.</li><li><strong>Plan in pencil.</strong> They revisited the plan every two weeks.</li><li><strong>Cut early.</strong> Stopping a bet was treated as a win, not a failure.</li></ol><p><a href=\"https://example.com/planning\">Read the full post</a></p>",
  },
  {
    account: "demo-personal", uid: 6, minutesAgo: 7 * hour,
    from: "Fieldwork Supply <orders@fieldwork.example>",
    subject: "Your order #FW-20931 has shipped",
    text: "Good news! Your order #FW-20931 has shipped.\n\n1 × Waxed canvas tote\n1 × Field notebook (3-pack)\n\nTracking number: 1Z999AA10123456784",
  },
  {
    account: "demo-personal", uid: 7, minutesAgo: 20 * hour,
    from: "Fieldwork Supply <hello@fieldwork.example>",
    subject: "Last chance: 30% off everything ends tonight",
    headers: unsubscribe,
    text: "Our fall sale ends at midnight. Take 30% off everything with code FALL30.",
    html: "<h1>30% off everything</h1><p>Our fall sale ends at midnight. Use code <strong>FALL30</strong> at checkout.</p><p><a href=\"https://example.com/shop\">Shop now</a></p>",
  },
  {
    account: "demo-personal", uid: 8, minutesAgo: 2 * day,
    from: "Spotify <no-reply@spotify.com>",
    subject: "Your Premium payment went through",
    text: "Thanks for your payment of €10.99 for Spotify Premium Individual. Your next billing date is November 24.",
  },
  {
    account: "demo-personal", uid: 9, minutesAgo: 4 * day,
    from: "Discord <notifications@discord.com>",
    subject: "New messages in #design-club",
    text: "You have 14 unread messages in #design-club on Pixel Pals.",
  },
  {
    account: "demo-personal", uid: 10, minutesAgo: 5 * day,
    from: "Sam Ortiz <sam.ortiz@example.com>",
    subject: "Fwd: Cabin options for March",
    text: "Found three cabins that fit everyone. The lake one is my pick but it's the priciest. Thoughts?\n\n---------- Forwarded message ---------\nFrom: Pine Lodge Rentals\nSubject: Cabin options for March\n\nHere are the cabins available for March 13–16.",
    attachments: [{ filename: "cabins.txt", contentType: "text/plain", content: "Lake House — sleeps 8 — €1,450\nForest A-frame — sleeps 6 — €980\nRidge Cabin — sleeps 7 — €1,120\n" }],
  },
  {
    account: "demo-personal", uid: 11, minutesAgo: 9 * day,
    from: "The Browser <editor@thebrowser.example>",
    subject: "Issue #214: Five things worth your time",
    headers: unsubscribe,
    text: "Five things worth your time this week: an essay on slow software, a history of the paperclip, and three more.",
  },
  {
    account: "demo-personal", uid: 12, minutesAgo: 15 * day,
    from: "Lingo <reminders@lingo.example>",
    subject: "Reminder: your 120-day streak is about to end",
    text: "Five minutes of Spanish today keeps your streak alive.",
  },
  {
    account: "demo-personal", uid: 13, minutesAgo: 40 * day,
    from: "Riverside Dental <frontdesk@riverside-dental.example>",
    subject: "Appointment reminder for November 3",
    text: "This is a reminder of your cleaning appointment on November 3 at 9:30. Reply C to confirm.",
  },

  // Studio
  {
    account: "demo-studio", uid: 1, minutesAgo: 15, unread: true,
    from: "Elena Novak <elena@novak-ceramics.example>",
    subject: "New project inquiry: brand refresh",
    text: "Hello Pinecone team,\n\nI run a small ceramics studio and we're ready for a brand refresh: logo, packaging and a simple shop site. Our budget is around €12k and we'd love to launch before spring.\n\nWould you have time for a call next week? Tuesday or Wednesday afternoon works best.\n\nWarmly,\nElena",
  },
  {
    account: "demo-studio", uid: 2, minutesAgo: 3 * hour,
    from: "Stripe <receipts@stripe.com>",
    subject: "Payment received for invoice #0042",
    text: "Novak Ceramics paid invoice #0042 for €3,600.00. The funds will arrive in your bank account in 2 business days.",
  },
  {
    account: "demo-studio", uid: 3, minutesAgo: day,
    from: "Dribbble <no-reply@dribbble.com>",
    subject: "You have 3 new followers",
    text: "Kai, Mira and Tomás started following Pinecone Studio.",
  },
  {
    account: "demo-studio", uid: 4, minutesAgo: 3 * day,
    from: "Webflow Support <support@webflow.com>",
    subject: "Re: Support ticket #58213 — custom domain SSL",
    text: "Hi there,\n\nThanks for your patience. The SSL certificate for pinecone-studio.example has been reissued and should be active within the hour. Let us know if the warning persists.\n\nBest,\nRuth from Webflow Support",
  },
  {
    account: "demo-studio", uid: 5, minutesAgo: 8 * day,
    from: "Framer <hello@framer.com>",
    subject: "Exclusive: save $120 on Framer Pro",
    headers: unsubscribe,
    text: "For one week only, save $120 on a year of Framer Pro. Limited time offer.",
  },
  {
    account: "demo-studio", uid: 6, minutesAgo: 14 * day,
    from: "Sidebar <hello@sidebar.example>",
    subject: "This week in design: 5 links",
    headers: unsubscribe,
    text: "The five best design links of the week, hand-picked.",
  },
];

// Sent copies, so the Sent view and threads have the user's side too.
export const demoSent: DemoMessage[] = [
  {
    account: "demo-work", uid: 1, minutesAgo: day + 6 * hour,
    from: "Alex Rivera <alex@northwind.example>", to: "Marcus Bell <marcus@northwind.example>",
    subject: "Pricing page copy",
    text: "Here's the draft for the new pricing page. Let me know what you think.",
  },
  {
    account: "demo-work", uid: 2, minutesAgo: day,
    from: "Alex Rivera <alex@northwind.example>", to: "Priya Shah <priya@northwind.example>",
    subject: "Re: Notes from Tuesday's sync",
    inReplyTo: messageId("demo-work", 8),
    text: "Thanks Priya. I'll own the status page during launch week.",
  },
];

// Saved drafts, stored through the real encrypted draft store.
export const demoDrafts: { account: string; to: string; subject: string; body: string; inReplyTo?: string; attachments?: { filename: string; contentType: string; content: string }[] }[] = [
  {
    account: "demo-work", to: "marcus@northwind.example", subject: "Re: Pricing page copy", inReplyTo: messageId("demo-work", 4),
    body: "Good catches. I've changed it to \"Unlimited viewers\" and moved the FAQ up. Will push the copy this afternoon.",
  },
  {
    account: "demo-work", to: "jordan@acme-logistics.example", subject: "Re: Contract renewal — two questions", inReplyTo: messageId("demo-work", 11),
    body: "Hi Jordan,\n\n1. Yes, you can switch to an annual contract mid-term; we'll prorate the difference.\n2. The rate limit is per workspace.",
  },
  {
    account: "demo-personal", to: "linda.rivera@example.com", subject: "Re: Sunday dinner?", inReplyTo: messageId("demo-personal", 1),
    body: "We'd love to! Sam will bring dessert. What time should we come?",
  },
  {
    account: "demo-personal", to: "", subject: "Cabin trip packing list",
    body: "Boots, rain jackets, board games, coffee beans, the good knife.",
  },
  {
    account: "demo-studio", to: "elena@novak-ceramics.example", subject: "Proposal: brand refresh for Novak Ceramics",
    body: "Hi Elena,\n\nThanks for reaching out. Attached is a first outline of scope, timeline and budget. Tuesday at 15:00 works for a call.",
    attachments: [{ filename: "proposal-outline.txt", contentType: "text/plain", content: Buffer.from("Logo, packaging, shop site — 8 weeks — €11.5k\n").toString("base64") }],
  },
];

/** Today items, calendar events and a project for the workspace pages, tied to demo mail. */
function seedWorkspace() {
  const now = Date.now();
  const at = (days: number, hour: number, minute = 0) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, minute, 0, 0); return date.toISOString(); };
  const isoDate = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  const commitments: [string, string, string, "needs-reply" | "needs-work" | "waiting" | "done", number?][] = [
    ["demo-work", "demo-work:1:1", "Review the Q4 launch plan for Priya", "needs-reply", 1],
    ["demo-work", "demo-work:1:11", "Answer Jordan's renewal questions", "needs-reply", 2],
    ["demo-studio", "demo-studio:1:1", "Send Elena a proposal outline", "needs-work", 3],
    ["demo-work", "demo-work:1:7", "Fix the failed production deploy", "needs-work"],
    ["demo-personal", "demo-personal:1:6", "Fieldwork order arriving", "waiting"],
    ["demo-personal", "demo-personal:1:13", "Confirm the dentist appointment", "done"],
  ];
  for (const [accountId, sourceMailId, text, status, dueIn] of commitments) {
    const id = randomUUID();
    const dueDate = dueIn === undefined ? undefined : isoDate(dueIn);
    put("commitment", id, { id, accountId, sourceMailId, text, reason: "Added from an email.", status, evidenceMailIds: [], revision: 1, updatedAt: now,
      ...(dueDate ? { dueDate, dueAt: Date.parse(`${dueDate}T12:00:00Z`) } : {}), history: [{ at: now, status, reason: "Added from an email.", text, evidenceMailIds: [] }] });
  }
  const events: { title: string; start: string; end: string; allDay?: boolean; location?: string; accountId?: string }[] = [
    { title: "Design review", start: at(1, 15), end: at(1, 15, 45), location: "Room 4B", accountId: "demo-work" },
    { title: "Launch QA window", start: isoDate(4), end: isoDate(5), allDay: true, accountId: "demo-work" },
    { title: "Call with Elena Novak", start: at(2, 15), end: at(2, 15, 30), location: "Video call", accountId: "demo-studio" },
    { title: "Sunday dinner", start: at(3, 18, 30), end: at(3, 21), location: "Mom & Dad's", accountId: "demo-personal" },
    { title: "Team standup", start: at(-1, 9, 30), end: at(-1, 9, 45), accountId: "demo-work" },
  ];
  for (const event of events) {
    const id = randomUUID();
    put("calendarEvent", id, { id, source: "local", allDay: false, attendees: [], revision: 1, updatedAt: now, ...event });
  }
  const project = randomUUID();
  put("project", project, { id: project, name: "Q4 launch", sourceMailIds: ["demo-work:1:1", "demo-work:1:8"], accountIds: ["demo-work"], crossAccountConfirmed: false, revision: 1, updatedAt: now });
  const decision = randomUUID();
  put("decision", decision, { id: decision, projectId: project, text: "Pricing change ships with the launch on November 18.", sourceMailIds: ["demo-work:1:8"], createdAt: now });
}

const icsTime = (time: number) => new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function invitation(message: DemoMessage, account: StoredAccount, createdAt: number) {
  const invite = message.invite!;
  const date = new Date(createdAt);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + invite.inDays, invite.hour).getTime();
  const organizer = /<([^>]+)>/.exec(message.from)![1];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Emc2//Demo//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
    `UID:demo-${message.account}-${message.uid}@emc2.demo`, `DTSTAMP:${icsTime(createdAt)}`,
    `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(start + invite.minutes * 60000)}`,
    `SUMMARY:${invite.title}`, `LOCATION:${invite.location}`, `ORGANIZER:mailto:${organizer}`,
    `ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${account.email}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

function compose(message: DemoMessage, account: StoredAccount, createdAt: number, sent = false): Promise<Buffer> {
  const options: ComposerOptions = {
    from: message.from,
    to: message.to ?? account.email,
    cc: message.cc,
    subject: message.subject,
    text: message.text,
    html: message.html,
    date: new Date(createdAt - message.minutesAgo * 60000),
    messageId: messageId(message.account, message.uid, sent),
    inReplyTo: message.inReplyTo,
    references: message.inReplyTo,
    headers: message.headers,
    attachments: message.attachments,
    icalEvent: message.invite ? { method: "REQUEST", content: invitation(message, account, createdAt) } : undefined,
  };
  return new MailComposer(options).compile().build();
}

const sentPath = "Sent";
const sentRemoteId = (uid: number) => `sent:${Buffer.from(sentPath).toString("base64url")}:1:${uid}`;

/** Seeds the demo accounts and swaps the IMAP-family providers for the fake mailbox. */
export function installDemoMailbox(dataDir: string) {
  const statePath = path.join(dataDir, "demo-state.json");
  const state: DemoState = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { createdAt: Date.now(), read: [], removed: [], sent: [] };
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  save();
  for (const account of demoAccounts) if (!get("account", account.id)) put("account", account.id, account);
  if (!get("compose", "preferences")) put("compose", "preferences", { templates: [], signatures: {
    "demo-work": "Alex Rivera\nProduct Lead, Northwind",
    "demo-personal": "Alex",
    "demo-studio": "Alex Rivera · Pinecone Studio\npinecone-studio.example",
  } });
  if (!state.workspaceSeeded) {
    seedWorkspace();
    state.workspaceSeeded = true;
    save();
  }
  if (!state.draftsSeeded) {
    for (const { account, ...draft } of demoDrafts) createDraft(account, draft);
    state.draftsSeeded = true;
    save();
  }

  const find = (a: StoredAccount, remoteId: string) =>
    demoMessages.find((m) => m.account === a.id && `1:${m.uid}` === remoteId);
  const sentMessages = async (a: StoredAccount) => [
    ...await Promise.all(demoSent.filter((m) => m.account === a.id)
      .map(async (m) => ({ uid: m.uid, source: await compose(m, a, state.createdAt, true) }))),
    ...state.sent.filter((m) => m.accountId === a.id).map((m) => ({ uid: m.uid, source: Buffer.from(m.source, "base64") })),
  ];
  const content = async (a: StoredAccount, m: Mail) => {
    const sent = (await sentMessages(a)).find((item) => sentRemoteId(item.uid) === m.remoteId);
    const message = find(a, m.remoteId);
    const source = sent?.source ?? (message && await compose(message, a, state.createdAt));
    if (!source) throw new Error("This demo email no longer exists.");
    const parsed = await parse(a, m.remoteId, source, m.unread);
    return { html: parsed.html ?? null, images: parsed.images ?? [], attachments: parsed.attachments, ...(parsed.invitation ? { invitation: parsed.invitation } : {}) };
  };
  const fake: (typeof providers)["imap"] = {
    async sent(a, bound) {
      const items = (await sentMessages(a)).slice(-bound);
      const messages = await Promise.all(items.map(async (item) => ({
        ...(await parse(a, sentRemoteId(item.uid), item.source, false)),
        direction: "sent" as const,
        mailbox: { path: sentPath, uidValidity: "1", uid: item.uid },
      })));
      return { messages, truncated: false };
    },
    async list(a, cached, onBatch) {
      const result: Incoming[] = [];
      for (const message of demoMessages.filter((m) => m.account === a.id)) {
        const id = `${a.id}:1:${message.uid}`;
        if (state.removed.includes(id)) continue;
        const unread = !!message.unread && !state.read.includes(id);
        const previous = cached.get(id);
        result.push(previous
          ? { ...previous, unread }
          : await parse(a, `1:${message.uid}`, await compose(message, a, state.createdAt), unread));
      }
      onBatch?.(result);
      return result;
    },
    async images(a, m) {
      return (await content(a, m)).images;
    },
    content,
    async update(a, m, action) {
      const list = action === "read" ? state.read : state.removed;
      if (!list.includes(m.id)) list.push(m.id);
      save();
    },
    async send(a, input: SendInput) {
      const uid = Math.max(demoSent.length, ...state.sent.map((m) => m.uid)) + 1;
      const source = await new MailComposer({
        from: a.email, to: input.to, cc: input.cc, subject: input.subject, text: input.body,
        inReplyTo: input.inReplyTo, references: input.references || input.inReplyTo,
        attachments: input.attachments?.map((attachment) => ({ ...attachment, content: Buffer.from(attachment.content, "base64") })),
      }).compile().build();
      state.sent.push({ accountId: a.id, uid, date: Date.now(), source: source.toString("base64") });
      save();
      console.log(`Demo: kept "${input.subject}" locally instead of sending it.`);
    },
  };
  for (const provider of Object.keys(providers) as Provider[]) if (provider !== "gmail") providers[provider] = fake;
}
