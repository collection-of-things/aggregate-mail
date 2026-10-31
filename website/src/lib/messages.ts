export type AccountKey = "gmail" | "fastmail" | "yahoo";
export type Category = "primary" | "social" | "promotions" | "newsletters" | "transactions" | "updates";

export type Message = {
  id: string;
  sender: string;
  domain: string;
  address: string;
  subject: string;
  preview: string;
  time: string;
  day: "today" | "yesterday";
  category: Category;
  relevance: 1 | 2 | 3;
  reason: string;
  account: AccountKey;
  unread?: boolean;
  // Live-arrival demo mail: absent from the hero window's first render and
  // delivered by its arrival sequence instead.
  arrival?: 1 | 2 | 3;
};

// Demo mail for the page: three connected accounts, invented subjects and
// previews, filed under the app's six Inbox tabs.
const demoMessages: Message[] = [
  {
    id: "m1", sender: "GitHub", domain: "github.com", address: "hello@github.com",
    subject: "Two-factor recovery codes were regenerated",
    preview: "New recovery codes are ready; the old set no longer works.",
    time: "27m", day: "today", category: "primary", relevance: 2, reason: "Account security",
    account: "fastmail", unread: true,
  },
  {
    id: "m2", sender: "Figma", domain: "figma.com", address: "notifications@figma.com",
    subject: "Sam shared “Emc² — Settings” with you",
    preview: "Leave a comment before Friday's review. Four are open.",
    time: "1h", day: "today", category: "primary", relevance: 3, reason: "Personal",
    account: "fastmail", unread: true,
  },
  {
    id: "m3", sender: "Stripe", domain: "stripe.com", address: "receipts@stripe.com",
    subject: "A payout of $4,281.00 is on the way",
    preview: "Expected 13 October. 218 payments, $96.42 in fees.",
    time: "3h", day: "today", category: "transactions", relevance: 2, reason: "Money",
    account: "gmail",
  },
  {
    id: "m4", sender: "Linear", domain: "linear.app", address: "notifications@linear.app",
    subject: "ENG-482 moved to In Review",
    preview: "Alex attached a recording and asked Priya to review.",
    time: "4h", day: "today", category: "updates", relevance: 2, reason: "Assigned to you",
    account: "fastmail", unread: true,
  },
  {
    id: "m5", sender: "Hugging Face", domain: "huggingface.co", address: "noreply@huggingface.co",
    subject: "Your model card was accepted",
    preview: "Now public on the Hub. 138 downloads in the first hour.",
    time: "4h", day: "today", category: "updates", relevance: 1, reason: "Build result",
    account: "yahoo",
  },
  {
    id: "m6", sender: "Google", domain: "google.com", address: "no-reply@accounts.google.com",
    subject: "Security alert: new sign-in on Windows",
    preview: "A new device signed in. If this was you, no action is needed.",
    time: "5h", day: "today", category: "primary", relevance: 3, reason: "Account security",
    account: "gmail",
  },
  {
    id: "m7", sender: "Vercel", domain: "vercel.com", address: "notifications@vercel.com",
    subject: "Deployment ready: emc2.app",
    preview: "Build finished in 42 seconds with no errors.",
    time: "5h", day: "today", category: "updates", relevance: 1, reason: "Build result",
    account: "fastmail",
  },
  {
    id: "m8", sender: "Slack", domain: "slack.com", address: "feedback@slack.com",
    subject: "3 new messages in #design",
    preview: "Priya: one nit on the hover state in #design.",
    time: "6h", day: "today", category: "social", relevance: 2, reason: "Mentions your team",
    account: "fastmail",
  },
  {
    id: "m9", sender: "Sentry", domain: "sentry.io", address: "alerts@sentry.io",
    subject: "New issue: TypeError in MailList",
    preview: "Twelve events across four users. First seen in 0.1.3.",
    time: "6h", day: "today", category: "updates", relevance: 2, reason: "Error in your app",
    account: "fastmail",
  },
  {
    id: "m10", sender: "Notion", domain: "notion.so", address: "team@notion.so",
    subject: "Weekly digest: 6 pages updated",
    preview: "Six pages edited this week. Two mention your name.",
    time: "6h", day: "today", category: "newsletters", relevance: 2, reason: "Mentions you",
    account: "fastmail",
  },
  {
    id: "m11", sender: "Apple", domain: "apple.com", address: "no_reply@email.apple.com",
    subject: "Your subscription receipt",
    preview: "iCloud+ 2 TB renewed for $9.99.",
    time: "13h", day: "today", category: "transactions", relevance: 1, reason: "Receipt",
    account: "gmail",
  },
  {
    id: "m12", sender: "Calendly", domain: "calendly.com", address: "notifications@calendly.com",
    subject: "Priya booked 30 minutes on Thursday",
    preview: "Priya booked Design review, Thursday 15:30.",
    time: "8h", day: "today", category: "primary", relevance: 3, reason: "Booking with a person",
    account: "gmail",
  },
  {
    id: "m13", sender: "Supabase", domain: "supabase.com", address: "no-reply@supabase.com",
    subject: "Your project is approaching its quota",
    preview: "Database size reached 82% of the free plan.",
    time: "7h", day: "today", category: "updates", relevance: 1, reason: "Usage notice",
    account: "fastmail",
  },
  {
    id: "m14", sender: "Railway", domain: "railway.app", address: "billing@railway.app",
    subject: "Your October receipt",
    preview: "Your subscription renewed for $20.00.",
    time: "7h", day: "today", category: "transactions", relevance: 1, reason: "Receipt",
    account: "fastmail",
  },
  {
    id: "m15", sender: "Cloudflare", domain: "cloudflare.com", address: "noreply@cloudflare.com",
    subject: "Pages build succeeded for emc2",
    preview: "214 files redeployed in 31 seconds.",
    time: "7h", day: "today", category: "updates", relevance: 1, reason: "Build result",
    account: "fastmail",
  },
  {
    id: "m16", sender: "OpenAI", domain: "openai.com", address: "noreply@openai.com",
    subject: "Your API usage for September",
    preview: "41% of your monthly budget across 12 keys.",
    time: "8h", day: "today", category: "updates", relevance: 1, reason: "Usage report",
    account: "yahoo",
  },
  {
    id: "m17", sender: "Docker", domain: "docker.com", address: "billing@docker.com",
    subject: "Monthly usage summary",
    preview: "18,400 pulls this month. Storage at 6.2 of 10 GB.",
    time: "8h", day: "today", category: "updates", relevance: 1, reason: "Usage report",
    account: "fastmail",
  },
  {
    id: "m18", sender: "Todoist", domain: "todoist.com", address: "no-reply@todoist.com",
    subject: "Today: 5 tasks, 2 due",
    preview: "Nothing is overdue. Your streak is 46 days.",
    time: "12h", day: "yesterday", category: "updates", relevance: 2, reason: "Your daily plan",
    account: "gmail",
  },
  {
    id: "m19", sender: "Dropbox", domain: "dropbox.com", address: "no-reply@dropbox.com",
    subject: "A file was shared with you",
    preview: "Sam shared launch notes.docx with edit access.",
    time: "12h", day: "yesterday", category: "primary", relevance: 2, reason: "Shared with you",
    account: "gmail",
  },
  {
    id: "m20", sender: "Uber", domain: "uber.com", address: "receipts@uber.com",
    subject: "Your Thursday trip receipt",
    preview: "Trip total $12.40. Rate your driver within 24 hours.",
    time: "15h", day: "yesterday", category: "transactions", relevance: 1, reason: "Receipt",
    account: "gmail",
  },
  {
    id: "m21", sender: "Medium", domain: "medium.com", address: "noreply@medium.com",
    subject: "Your story was curated",
    preview: "Your story was added to three topics.",
    time: "16h", day: "yesterday", category: "newsletters", relevance: 2, reason: "Your own work",
    account: "gmail",
  },
  {
    id: "m22", sender: "Shopify", domain: "shopify.com", address: "payouts@shopify.com",
    subject: "Your payout has been sent",
    preview: "$1,208.44 sent to your bank ending 4417.",
    time: "8h", day: "today", category: "transactions", relevance: 1, reason: "Payout notice",
    account: "yahoo",
  },
  {
    id: "m23", sender: "npm", domain: "npmjs.com", address: "support@npmjs.com",
    subject: "emc2-cli published 2.4.1",
    preview: "Published three minutes ago. Downloads up 12%.",
    time: "9h", day: "today", category: "updates", relevance: 1, reason: "Your own release",
    account: "fastmail",
  },
  {
    id: "m24", sender: "Atlassian", domain: "atlassian.com", address: "jira@atlassian.com",
    subject: "Weekly project summary",
    preview: "Nine issues done, three in review, one slipped.",
    time: "9h", day: "today", category: "newsletters", relevance: 1, reason: "Digest",
    account: "fastmail",
  },
  {
    id: "m25", sender: "PayPal", domain: "paypal.com", address: "service@paypal.com",
    subject: "You sent a payment of $75.00",
    preview: "The payment to Bright Studio is complete.",
    time: "16h", day: "yesterday", category: "transactions", relevance: 1, reason: "Receipt",
    account: "gmail",
  },
  {
    id: "m26", sender: "Booking.com", domain: "booking.com", address: "customer.service@booking.com",
    subject: "Your stay in Lisbon is confirmed",
    preview: "Check-in 2 November from 15:00. Free cancel until 30 October.",
    time: "17h", day: "yesterday", category: "transactions", relevance: 3, reason: "Trip with a date",
    account: "gmail",
  },
  {
    id: "m27", sender: "LinkedIn", domain: "linkedin.com", address: "updates@linkedin.com",
    subject: "You appeared in 27 searches",
    preview: "27 people viewed your profile this week.",
    time: "17h", day: "yesterday", category: "social", relevance: 1, reason: "Weekly digest",
    account: "gmail",
  },
  {
    id: "m28", sender: "GitLab", domain: "gitlab.com", address: "gitlab@gitlab.com",
    subject: "Pipeline failed on main",
    preview: "test:e2e failed after 4m12s in the renderer spec.",
    time: "18h", day: "yesterday", category: "updates", relevance: 2, reason: "Build result",
    account: "fastmail",
  },
  {
    id: "m29", sender: "1Password", domain: "1password.com", address: "news@1password.com",
    subject: "Families plan: 25% off this week",
    preview: "Share vaults with up to five people. Offer ends Sunday.",
    time: "10h", day: "today", category: "promotions", relevance: 1, reason: "Promotion",
    account: "yahoo",
  },
  {
    id: "m30", sender: "DigitalOcean", domain: "digitalocean.com", address: "offers@digitalocean.com",
    subject: "$200 in credit for your next project",
    preview: "Spin up a droplet before 15 November to claim it.",
    time: "19h", day: "yesterday", category: "promotions", relevance: 1, reason: "Promotion",
    account: "gmail",
  },
  {
    id: "m31", sender: "Priya Nair", domain: "studio-north.com", address: "priya@studio-north.com",
    subject: "Can we move Thursday's review?",
    preview: "Something came up on my side. Does Friday at 10:00 work instead?",
    time: "now", day: "today", category: "primary", relevance: 3, reason: "Personal",
    account: "gmail", unread: true, arrival: 1,
  },
  {
    id: "m32", sender: "Medium Digest", domain: "medium.com", address: "digest@medium.com",
    subject: "Your week in design writing",
    preview: "Nine stories picked for you, including a long read on type systems.",
    time: "now", day: "today", category: "newsletters", relevance: 1, reason: "Digest",
    account: "yahoo", arrival: 2,
  },
  {
    id: "m33", sender: "Hetzner", domain: "hetzner.com", address: "billing@hetzner.com",
    subject: "Invoice for October is ready",
    preview: "Cloud server cx22 and one volume, €4.85 total.",
    time: "now", day: "today", category: "transactions", relevance: 1, reason: "Receipt",
    account: "fastmail", arrival: 3,
  },
];

/* minutes since arrival: "now", "27m" or "8h" */
const age = (time: string) =>
  time === "now" ? 0 : time.endsWith("h") ? parseInt(time, 10) * 60 : parseInt(time, 10);

// Newest first, today before yesterday, so the inbox's day headings appear
// once each. The sort is stable, so equal ages keep their written order.
export const messages: Message[] = [...demoMessages].sort(
  (a, b) => Number(a.day === "yesterday") - Number(b.day === "yesterday") || age(a.time) - age(b.time)
);

export const recentWith = (sender: string) => [
  `Welcome to ${sender}`,
  `Your ${sender} digest`,
  `${sender} monthly summary`,
];
