/**
 * Accent color system. Each preset is expressed as HSL channels so it can drive
 * the `--primary` / `--ring` / `--accent` CSS variables for both themes. The
 * picker persists the choice and re-applies it on load (see ui-store + Providers).
 */

export interface AccentPreset {
  id: string;
  name: string;
  /** "H S% L%" — used as the swatch and applied to --primary in light mode. */
  light: string;
  /** Slightly lifted lightness for dark mode legibility. */
  dark: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'indigo', name: 'Indigo', light: '243 75% 59%', dark: '243 75% 66%' },
  { id: 'violet', name: 'Violet', light: '262 83% 58%', dark: '262 83% 67%' },
  { id: 'blue', name: 'Blue', light: '217 91% 55%', dark: '217 91% 64%' },
  { id: 'cyan', name: 'Cyan', light: '189 94% 38%', dark: '189 85% 48%' },
  { id: 'emerald', name: 'Emerald', light: '160 84% 33%', dark: '160 70% 44%' },
  { id: 'amber', name: 'Amber', light: '32 95% 44%', dark: '38 92% 55%' },
  { id: 'rose', name: 'Rose', light: '347 77% 50%', dark: '347 85% 62%' },
  { id: 'slate', name: 'Graphite', light: '215 25% 27%', dark: '215 20% 72%' },
];

export const DEFAULT_ACCENT = 'indigo';

/** Apply an accent to the document root for the current theme. */
export function applyAccent(accentId: string, isDark: boolean) {
  const preset = ACCENT_PRESETS.find((p) => p.id === accentId) ?? ACCENT_PRESETS[0]!;
  const value = isDark ? preset.dark : preset.light;
  const root = document.documentElement;
  root.style.setProperty('--primary', value);
  root.style.setProperty('--ring', value);
  root.style.setProperty('--accent', value);
  root.style.setProperty('--sidebar-accent', value);
}
