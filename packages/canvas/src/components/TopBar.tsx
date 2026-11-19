import { Moon, PanelLeft, Redo2, Sun, Undo2 } from "lucide-react";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";

export function TopBar() {
    const { t, shell } = useCanvasContext();
    const title = useCanvasStore((state) => state.doc.title);
    const commit = useCanvasStore((state) => state.commit);
    const undo = useCanvasStore((state) => state.undo);
    const redo = useCanvasStore((state) => state.redo);
    const canUndo = useCanvasStore((state) => state.canUndo);
    const canRedo = useCanvasStore((state) => state.canRedo);

    return (
        <div className="mf-topbar">
            {shell.showTitle ? <div className="mf-topbar-left">
                <PanelLeft size={15} className="mf-topbar-logo" />
                <input
                    className="mf-title-input"
                    value={title}
                    spellCheck={false}
                    onChange={(event) => commit((prev) => ({ ...prev, title: event.target.value }))}
                />
            </div> : <span />}
            <div className="mf-topbar-right">
                {shell.showHistory && shell.showUndo && <button type="button" className="mf-icon-btn" aria-label={t("toolbar.undo")} title={t("toolbar.undo")} disabled={!canUndo} onClick={undo}>
                    <Undo2 size={16} />
                </button>}
                {shell.showHistory && shell.showRedo && <button type="button" className="mf-icon-btn" aria-label={t("toolbar.redo")} title={t("toolbar.redo")} disabled={!canRedo} onClick={redo}>
                    <Redo2 size={16} />
                </button>}
                {shell.showThemeToggle && <ThemeToggle />}
                {shell.showLanguageToggle && <LanguageToggle />}
            </div>
        </div>
    );
}

function ThemeToggle() {
    const { t, mode, setMode } = useCanvasContext();
    return (
        <button type="button" className="mf-icon-btn" title={t("toolbar.theme")} onClick={() => setMode(mode === "dark" ? "light" : "dark")}>
            {mode === "dark" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
    );
}

function LanguageToggle() {
    const { t, lang, setLang } = useCanvasContext();
    return (
        <button type="button" className="mf-icon-btn mf-language-toggle" title={t("toolbar.language")}
            lang={lang} onClick={() => setLang(lang === "zh-CN" ? "en-US" : "zh-CN")}>
            {lang === "zh-CN" ? "中" : "EN"}
        </button>
    );
}
