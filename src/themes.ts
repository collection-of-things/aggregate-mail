import { z } from "zod";

export const maxCustomThemes = 32;
export const maxThemeFileBytes = 64 * 1024;
export const themeColorSchema = z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i)
  .transform((color) => color.length === 4
    ? `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`.toLowerCase()
    : color.toLowerCase());

export const paletteSchema = z.strictObject({
  canvas: themeColorSchema,
  surface: themeColorSchema,
  raised: themeColorSchema,
  text: themeColorSchema,
  secondaryText: themeColorSchema,
  mutedText: themeColorSchema,
  accent: themeColorSchema,
  link: themeColorSchema,
  border: themeColorSchema,
  danger: themeColorSchema,
  reason: themeColorSchema,
  veil: themeColorSchema,
});
export const themeNameSchema = z.string().trim().min(1).max(48);
const palettesSchema = z.strictObject({ dark: paletteSchema, light: paletteSchema });
export const customThemeIdSchema = z.templateLiteral(["custom:", z.string().uuid()]);
export const customThemeSchema = z.strictObject({
  id: customThemeIdSchema,
  name: themeNameSchema,
  palettes: palettesSchema,
});
export const customThemesSchema = z.array(customThemeSchema).max(maxCustomThemes)
  .refine((themes) => new Set(themes.map(({ id }) => id)).size === themes.length);

const themeFileSchema = z.strictObject({
  format: z.literal("emc2-theme"),
  version: z.literal(1),
  name: themeNameSchema,
  palettes: palettesSchema,
});
export type Palette = z.infer<typeof paletteSchema>;
export type CustomTheme = z.infer<typeof customThemeSchema>;
export type ThemePreview = { scheme: "dark" | "light"; palette: Palette };

export const paletteFields = [
  { id: "canvas", label: "Background", variable: "--bg" },
  { id: "accent", label: "Accent", variable: "--accent" },
  { id: "surface", label: "Mail and settings", variable: "--surface" },
  { id: "raised", label: "Menus and controls", variable: "--raised" },
  { id: "text", label: "Primary text", variable: "--text" },
  { id: "secondaryText", label: "Secondary text", variable: "--text-2" },
  { id: "mutedText", label: "Muted text", variable: "--text-3" },
  { id: "link", label: "Links", variable: "--link" },
  { id: "border", label: "Borders", variable: "--line" },
  { id: "reason", label: "Sorting reasons", variable: "--reason" },
  { id: "danger", label: "Errors and destructive actions", variable: "--danger" },
  { id: "veil", label: "Privacy bars", variable: "--veil" },
] as const satisfies readonly { id: keyof Palette; label: string; variable: string }[];

function mix(first: string, second: string, amount: number): string {
  const channel = (offset: number) => Math.round(
    parseInt(first.slice(offset, offset + 2), 16) * (1 - amount) +
    parseInt(second.slice(offset, offset + 2), 16) * amount,
  ).toString(16).padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function luminance(color: string): number {
  const channel = (offset: number) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return channel(1) * 0.2126 + channel(3) * 0.7152 + channel(5) * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const brighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

// The --accent-soft / --accent-soft-ink color-mix percentages from tokens.css,
// duplicated here so the custom-palette guard computes the same resolved
// colors the stylesheet produces. Keep both sides in sync.
export const accentSoftMix = { dark: { fill: 0.22, ink: 0.38 }, light: { fill: 0.16, ink: 0.7 } } as const;

// Reproduces color-mix(in oklab, a n%, b) over sRGB hex colors.
export function oklabHex(first: string, second: string, amount: number): string {
  const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const fromLinear = (value: number) => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
  const lab = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(color.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const [la, aa, ba] = lab(first);
  const [lb, ab, bb] = lab(second);
  const l3 = la * amount + lb * (1 - amount) + 0.3963377774 * (aa * amount + ab * (1 - amount)) + 0.2158037573 * (ba * amount + bb * (1 - amount));
  const m3 = la * amount + lb * (1 - amount) - 0.1055613458 * (aa * amount + ab * (1 - amount)) - 0.0638541728 * (ba * amount + bb * (1 - amount));
  const s3 = la * amount + lb * (1 - amount) - 0.0894841775 * (aa * amount + ab * (1 - amount)) - 1.291485548 * (ba * amount + bb * (1 - amount));
  const [l, m, s] = [l3 ** 3, m3 ** 3, s3 ** 3];
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, fromLinear(value))) * 255).toString(16).padStart(2, "0");
  return `#${channel(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`;
}

export function generatePalette(canvas: string, accent: string, scheme: ThemePreview["scheme"]): Palette {
  const background = themeColorSchema.parse(canvas);
  const highlight = themeColorSchema.parse(accent);
  const surface = mix(background, "#ffffff", scheme === "light" ? 0.75 : 0.045);
  const surfaceLuminance = luminance(surface);
  const light = (surfaceLuminance + 0.05) / (luminance("#1d1d1f") + 0.05) > 1.05 / (surfaceLuminance + 0.05);
  const text = light ? "#1d1d1f" : "#ffffff";
  return {
    canvas: background, accent: highlight, surface,
    raised: mix(surface, text, light ? 0.025 : 0.06), text,
    secondaryText: mix(surface, text, light ? 0.8 : 0.65),
    mutedText: mix(surface, text, light ? 0.65 : 0.55),
    link: mix(highlight, text, light ? 0.12 : 0.28),
    border: mix(surface, text, light ? 0.16 : 0.12),
    danger: light ? "#c93434" : "#f07c7c",
    reason: light ? "#a50685" : "#fcaec2",
    veil: mix(surface, text, light ? 0.2 : 0.1),
  };
}

export function applyPalette(palette: Palette, root: HTMLElement): void {
  for (const field of paletteFields) root.style.setProperty(field.variable, palette[field.id]);
  root.style.setProperty("--text-body", palette.text);
  root.style.setProperty("--text-4", palette.mutedText);
  root.style.setProperty("--line-2", `color-mix(in srgb, ${palette.border} 80%, ${palette.text})`);
  root.style.setProperty("--line-3", `color-mix(in srgb, ${palette.border} 65%, ${palette.text})`);
  root.style.setProperty("--hover", `color-mix(in srgb, ${palette.text} 4%, transparent)`);
  root.style.setProperty("--selected", `color-mix(in srgb, ${palette.text} 7%, transparent)`);
  root.style.setProperty("--veil-hover", `color-mix(in srgb, ${palette.veil} 90%, ${palette.text})`);
  root.style.setProperty("--avatar", palette.raised);
  root.style.setProperty("--avatar-text", palette.secondaryText);
  // A pale custom accent would render --accent-soft-ink unreadable on its fill;
  // CSS can't choose a contrasting color, so pin a passing ink here. The same
  // derivation feeds --code-ink, which sits on the veil instead of the fill.
  const percentages = accentSoftMix[root.dataset.scheme === "light" ? "light" : "dark"];
  const fill = oklabHex(palette.accent, palette.surface, percentages.fill);
  const ink = oklabHex(palette.accent, palette.text, percentages.ink);
  if (contrastRatio(ink, fill) >= 4.5) root.style.removeProperty("--accent-soft-ink");
  else if (contrastRatio(palette.text, fill) >= 4.5) root.style.setProperty("--accent-soft-ink", palette.text);
  else root.style.setProperty("--accent-soft-ink", contrastRatio("#ffffff", fill) >= contrastRatio("#000000", fill) ? "#ffffff" : "#000000");
  if (contrastRatio(ink, palette.veil) >= 4.5) root.style.removeProperty("--code-ink");
  else if (contrastRatio(palette.text, palette.veil) >= 4.5) root.style.setProperty("--code-ink", palette.text);
  else root.style.setProperty("--code-ink", contrastRatio("#ffffff", palette.veil) >= contrastRatio("#000000", palette.veil) ? "#ffffff" : "#000000");
}

export function clearPalette(root: HTMLElement): void {
  for (const field of paletteFields) root.style.removeProperty(field.variable);
  for (const variable of ["--text-body", "--text-4", "--line-2", "--line-3", "--hover", "--selected", "--veil-hover", "--avatar", "--avatar-text", "--accent-soft-ink", "--code-ink"])
    root.style.removeProperty(variable);
}

export function parseThemeFile(text: string): Omit<CustomTheme, "id"> {
  if (new TextEncoder().encode(text).length > maxThemeFileBytes)
    throw new Error("Theme files must be 64 KB or smaller.");
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error("Choose a valid JSON theme file."); }
  const result = themeFileSchema.safeParse(input);
  if (!result.success)
    throw new Error("Use an Emc² version 1 theme with a name, light and dark palettes, and hex colors (#RGB or #RRGGBB).");
  return { name: result.data.name, palettes: result.data.palettes };
}

export function serializeThemeFile(theme: CustomTheme): string {
  return `${JSON.stringify(themeFileSchema.parse({ format: "emc2-theme", version: 1, name: theme.name, palettes: theme.palettes }), null, 2)}\n`;
}

export function uniqueThemeName(name: string, themes: readonly CustomTheme[]): string {
  const names = new Set(themes.map((theme) => theme.name.toLowerCase()));
  let candidate = name.slice(0, 48);
  for (let copy = 2; names.has(candidate.toLowerCase()); copy++) {
    const suffix = ` (${copy})`;
    candidate = `${name.slice(0, 48 - suffix.length)}${suffix}`;
  }
  return candidate;
}
