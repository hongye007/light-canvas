import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useCanvasContext } from "./context";

export function WorkspaceSettings({ onClose }: { onClose: () => void }) {
    const { config, lang, t } = useCanvasContext();
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    return (
        <dialog ref={dialog} className="mf-settings" aria-labelledby={titleId} onClose={onClose}
            onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
            <div className="mf-settings-inner">
                <header className="mf-settings-header">
                    <h2 id={titleId}>{t("toolbar.apiSettings")}</h2>
                    <button type="button" className="mf-icon-btn" aria-label={t("panel.close")}
                        onClick={() => dialog.current?.close()}><X size={16} /></button>
                </header>
                {config.renderSettings?.(lang)}
            </div>
        </dialog>
    );
}
