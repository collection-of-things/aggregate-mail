export const GITHUB_REPO = "https://github.com/collection-of-things/aggregate-mail";
export const CAFE_REPO = "https://git.cafe/collection-of-devs/aggregate-mail";
export const RELEASES = `${GITHUB_REPO}/releases/latest`;

export const TITLE = "Emc² · One inbox. Every desktop.";
export const DESCRIPTION =
  "A free, open-source email client for Windows, macOS and Linux. Gmail, iCloud, Fastmail, Yahoo or any IMAP server in one inbox that sorts itself and stays encrypted on your own machine.";

// When the site has no canonical URL configured, point social cards at the
// committed image on the main branch.
export const ogImageUrl = (site: URL | undefined) =>
  site
    ? new URL("/og.png", site).href
    : "https://raw.githubusercontent.com/collection-of-things/aggregate-mail/main/website/public/og.png";
