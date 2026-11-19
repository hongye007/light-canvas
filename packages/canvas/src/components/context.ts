import { createContext, useContext } from "react";
import type { CanvasConfig, CanvasLocale, CanvasShellOptions, CanvasTheme, CanvasThemeMode, CanvasThemeTokens, Translate } from "../types";
import type { NodeRegistry } from "../lib/registry";

export type ShellFlags = Required<CanvasShellOptions>;

export type CanvasContextValue = {
    config: CanvasConfig;
    registry: NodeRegistry;
    t: Translate;
    theme: CanvasTheme;
    mode: CanvasThemeMode;
    tokens: CanvasThemeTokens;
    shell: ShellFlags;
    toast: (message: string, kind?: "info" | "error" | "success") => void;
    lang: CanvasLocale["lang"];
    setLang: (lang: CanvasLocale["lang"]) => void;
    setMode: (mode: CanvasThemeMode) => void;
};

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvasContext(): CanvasContextValue {
    const value = useContext(CanvasContext);
    if (!value) throw new Error("[maxflow] canvas components must render inside <MaxFlowCanvas>");
    return value;
}

export function useT(): Translate {
    return useCanvasContext().t;
}
