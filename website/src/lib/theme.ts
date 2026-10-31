// Light and dark page themes. The head script in index.astro sets
// <html data-theme> before first paint from the saved choice or the
// system preference; this module reads it, saves the visitor's pick and
// tells the shaders and paintings when it changes.

export type Theme = "light" | "dark";

export const THEME_KEY = "emc2-theme";

export const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

const savedTheme = (): Theme | null => {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
};

const apply = (theme: Theme) => {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const frame = getComputedStyle(root).getPropertyValue("--theme-color").trim();
  if (meta && frame) meta.content = frame;
};

/* a visitor's pick is saved; without one the page follows the system */
export const setTheme = (theme: Theme) => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the pick lasts for this page view */
  }
  apply(theme);
};

export const followSystemTheme = () => {
  const query = matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", (event) => {
    if (!savedTheme()) apply(event.matches ? "dark" : "light");
  });
};

/* fires after every data-theme change on <html>, whoever made it */
export const onThemeChange = (listener: (theme: Theme) => void) => {
  let last = currentTheme();
  new MutationObserver(() => {
    const next = currentTheme();
    if (next === last) return;
    last = next;
    listener(next);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
};
