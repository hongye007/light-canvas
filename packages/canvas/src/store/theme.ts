import type { CanvasThemeMode, CanvasThemeTokens } from "../types";

export const darkTokens: Required<CanvasThemeTokens> = {
    surface: "#101011",
    surfaceRaised: "#18181a",
    surfaceSunken: "#0b0b0c",
    border: "#2a2a2e",
    borderStrong: "#3d3d43",
    textPrimary: "#f2f2f3",
    textSecondary: "#a4a4ad",
    textMuted: "#6c6c76",
    accent: "#2b6de8",
    accentSoft: "rgba(43,109,232,.16)",
    accentText: "#ffffff",
    danger: "#e5484d",
    success: "#3fb950",
    gridDot: "rgba(255,255,255,.16)",
    gridLine: "rgba(255,255,255,.06)",
    edge: "#6b7280",
    edgeActive: "#2b6de8",
    shadow: "0 12px 32px rgba(0,0,0,.55)",
};

export const lightTokens: Required<CanvasThemeTokens> = {
    surface: "#fbfbfc",
    surfaceRaised: "#ffffff",
    surfaceSunken: "#f1f1f3",
    border: "#e2e2e6",
    borderStrong: "#cfcfd6",
    textPrimary: "#17171a",
    textSecondary: "#56565f",
    textMuted: "#8d8d97",
    accent: "#2b6de8",
    accentSoft: "rgba(43,109,232,.10)",
    accentText: "#ffffff",
    danger: "#d1242f",
    success: "#1a7f37",
    gridDot: "rgba(0,0,0,.18)",
    gridLine: "rgba(0,0,0,.06)",
    edge: "#a3a3ad",
    edgeActive: "#2b6de8",
    shadow: "0 8px 24px rgba(20,20,30,.12)",
};

export type ResolvedTheme = {
    mode: CanvasThemeMode;
    tokens: Required<CanvasThemeTokens>;
    /** Value usable directly in CSS: `var(--mf-<token>)`. */
    varName: (token: keyof CanvasThemeTokens) => string;
};

export function resolveTheme(mode: CanvasThemeMode, overrides: CanvasThemeTokens = {}): ResolvedTheme {
    const base = mode === "dark" ? darkTokens : lightTokens;
    const tokens = { ...base, ...overrides } as Required<CanvasThemeTokens>;
    return {
        mode,
        tokens,
        varName: (token) => `var(--mf-${token})`,
    };
}

/** CSS custom properties for the canvas root. Scoped, never leaks to the host page. */
export function themeStyle(mode: CanvasThemeMode, overrides: CanvasThemeTokens = {}): Record<string, string> {
    const { tokens } = resolveTheme(mode, overrides);
    const style: Record<string, string> = { colorScheme: mode };
    for (const [key, value] of Object.entries(tokens)) {
        style[`--mf-${key}`] = value;
    }
    return style;
}
