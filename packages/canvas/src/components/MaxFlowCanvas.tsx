import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CanvasConfig, CanvasLocale, CanvasTheme, CanvasThemeMode, CanvasProfile, CanvasShellOptions } from "../types";
import { NodeRegistry, builtinRegistry } from "../lib/registry";
import { createTranslator } from "../lib/i18n";
import { CanvasContext, type CanvasContextValue, type ShellFlags } from "./context";
import { CanvasRoot } from "./CanvasRoot";
import { resolveTheme } from "../store/theme";
import { useCanvasStore } from "../store/canvas-store";
import type { CanvasDocument } from "../types";

export type MaxFlowCanvasProps = {
    config: CanvasConfig;
    /** Extra node types, merged over the built-ins. */
    registry?: NodeRegistry;
    /** `full` renders the whole workbench, `generator` keeps only the canvas and composer. */
    profile?: CanvasProfile;
    shell?: CanvasShellOptions;
    locale?: CanvasLocale;
    theme?: CanvasTheme;
    /** Initial document; later values are adopted by the canvas when they change. */
    initialDocument?: CanvasDocument;
    className?: string;
};

/**
 * Public entry point.
 *
 * ```tsx
 * <MaxFlowCanvas
 *   profile="full"
 *   config={{ producer, models }}
 *   onDocumentChange={(doc) => save(doc)}
 * />
 * ```
 */
export function MaxFlowCanvas(props: MaxFlowCanvasProps): ReactNode {
    const { config, profile = "full", locale, theme, shell: overrides } = props;
    const [mode, setMode] = useState<CanvasThemeMode>(theme?.mode ?? "dark");
    const [lang, setLang] = useState<CanvasLocale["lang"]>(locale?.lang ?? "zh-CN");
    const [toasts, setToasts] = useState<Array<{ id: string; message: string; kind: "info" | "error" | "success" }>>([]);

    // The host owns these props: follow them when they change, keep them switchable otherwise.
    useEffect(() => {
        if (theme?.mode) setMode(theme.mode);
    }, [theme?.mode]);

    useEffect(() => {
        if (locale?.lang) setLang(locale.lang);
    }, [locale?.lang]);

    const registry = useMemo(
        () => props.registry ? new NodeRegistry([...builtinRegistry.list(), ...props.registry.list()]) : builtinRegistry,
        [props.registry],
    );

    // Load the initial document exactly once, before the first paint of the canvas.
    useState(() => {
        if (props.initialDocument) useCanvasStore.getState().load(props.initialDocument);
        return true;
    });

    const toast = useCallback(
        (message: string, kind: "info" | "error" | "success" = "info") => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            setToasts((current) => [...current, { id, message, kind }]);
            window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
        },
        [],
    );

    const value = useMemo<CanvasContextValue>(() => {
        const t = createTranslator({ lang, messages: locale?.messages });
        const shell: ShellFlags = {
            rail: profile === "full",
            topBar: profile === "full",
            composer: true,
            minimap: profile === "full",
            zoomControls: true,
            showTitle: true,
            showHistory: true,
            showUndo: true,
            showRedo: true,
            showThemeToggle: true,
            showLanguageToggle: true,
            showNodes: true,
            showAssets: true,
            showImport: true,
            showExport: true,
            showSettings: true,
            ...overrides,
        };
        return {
            config,
            registry,
            t,
            theme: { mode, tokens: theme?.tokens },
            mode,
            tokens: resolveTheme(mode, theme?.tokens).tokens,
            shell,
            toast,
            lang,
            setLang,
            setMode,
        };
    }, [config, registry, lang, locale?.messages, theme?.tokens, mode, profile, overrides, toast]);

    return (
        <CanvasContext.Provider value={value}>
            <div className={props.className}>
                <CanvasRoot externalDocument={props.initialDocument} notifications={toasts.length > 0 && (
                    <div className="mf-toasts" aria-live="polite">
                        {toasts.map((item) => (
                            <div key={item.id} className={`mf-toast mf-toast-${item.kind}`}>{item.message}</div>
                        ))}
                    </div>
                )} />
            </div>
        </CanvasContext.Provider>
    );
}
