import { Download, Images, ListTree, Settings, Upload } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useCanvasContext } from "./context";

export function Rail({ onNodes, onAssets, drawer, onImport, onExport, onSettings, footer }: {
    onNodes: () => void;
    onAssets?: () => void;
    drawer: "nodes" | "assets" | null;
    onImport: (text: string) => void | Promise<void>;
    onExport: () => void;
    onSettings?: () => void;
    footer?: ReactNode;
}) {
    const { t, toast, shell } = useCanvasContext();
    const fileInput = useRef<HTMLInputElement>(null);

    return (
        <aside className="mf-rail">
            {shell.showNodes && <button type="button" className="mf-rail-btn" aria-label={t("rail.nodes")} title={t("rail.nodes")} aria-expanded={drawer === "nodes"} onClick={onNodes}>
                <ListTree size={17} aria-hidden />
            </button>}
            {shell.showAssets && onAssets && <button type="button" className="mf-rail-btn" aria-label={t("rail.assets")} title={t("rail.assets")}
                aria-expanded={drawer === "assets"} onClick={onAssets}>
                <Images size={17} aria-hidden />
            </button>}
            {shell.showImport && <>
            <button type="button" className="mf-rail-btn" aria-label={t("toolbar.import")} title={t("toolbar.import")} onClick={() => fileInput.current?.click()}>
                <Upload size={17} aria-hidden />
            </button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                if (!file) return;
                try {
                    await onImport(await file.text());
                } catch {
                    toast(t("error.import"), "error");
                }
            }} />
            </>}
            {shell.showExport && <button type="button" className="mf-rail-btn" aria-label={t("toolbar.exportJson")} title={t("toolbar.exportJson")} onClick={onExport}>
                <Download size={17} aria-hidden />
            </button>}
            {shell.showSettings && onSettings && <button type="button" className="mf-rail-btn mf-rail-settings" aria-label={t("toolbar.settings")} title={t("toolbar.settings")} onClick={onSettings}>
                <Settings size={17} aria-hidden />
            </button>}
            {footer}
        </aside>
    );
}
