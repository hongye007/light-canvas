import { Check, ChevronDown, Grip, Grid2X2, Map, Maximize2, Minus, Plus, Square, ZoomIn } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "./context";
import { useCanvasStore } from "../store/canvas-store";

export function ZoomControls({
    k, showZoom, showMap, onToggleZoom, onToggleMap, onZoomIn, onZoomOut, onFit, onReset,
}: {
    k: number;
    showZoom: boolean;
    showMap: boolean;
    onToggleZoom: () => void;
    onToggleMap?: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFit: () => void;
    onReset: () => void;
}) {
    const t = useT();

    return (
        <div className="mf-zoom" data-canvas-no-pan data-canvas-ignore-wheel>
            {showZoom && <div className="mf-zoom-cluster">
                <button type="button" className="mf-icon-btn" onClick={onZoomOut} aria-label={t("toolbar.zoomOut")} title={t("toolbar.zoomOut")}><Minus size={14} /></button>
                <button type="button" className="mf-zoom-value" onClick={onReset} title={t("toolbar.resetZoom")}>{Math.round(k * 100)}%</button>
                <button type="button" className="mf-icon-btn" onClick={onZoomIn} aria-label={t("toolbar.zoomIn")} title={t("toolbar.zoomIn")}><Plus size={14} /></button>
                <button type="button" className="mf-icon-btn" onClick={onFit} aria-label={t("toolbar.fit")} title={t("toolbar.fit")}><Maximize2 size={14} /></button>
            </div>}
            <BackgroundPicker />
            <button type="button" className="mf-icon-btn mf-view-toggle" aria-label={t("toolbar.zoomControls")} title={t("toolbar.zoomControls")}
                aria-pressed={showZoom} onClick={onToggleZoom}><ZoomIn size={15} /></button>
            {onToggleMap && <button type="button" className="mf-icon-btn mf-view-toggle" aria-label={t("toolbar.minimap")} title={t("toolbar.minimap")}
                aria-pressed={showMap} onClick={onToggleMap}><Map size={15} /></button>}
        </div>
    );
}


const patterns = [
    { value: "dots", icon: Grip },
    { value: "lines", icon: Grid2X2 },
    { value: "blank", icon: Square },
] as const;

function BackgroundPicker() {
    const t = useT();
    const background = useCanvasStore((state) => state.doc.background);
    const commit = useCanvasStore((state) => state.commit);
    const [open, setOpen] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const Icon = patterns.find((item) => item.value === background)?.icon ?? Grip;

    useEffect(() => {
        if (!open) return;
        container.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", outside);
        return () => document.removeEventListener("pointerdown", outside);
    }, [open]);

    const close = () => {
        setOpen(false);
        trigger.current?.focus();
    };

    return (
        <div className="mf-background-picker" ref={container}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
            onKeyDown={(event) => {
                if (!open) return;
                if (event.key === "Escape") {
                    event.stopPropagation();
                    close();
                }
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
                    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
                }
            }}>
            <button type="button" className="mf-icon-btn mf-background-trigger" ref={trigger}
                title={t("toolbar.background")} aria-label={`${t("toolbar.background")} · ${t(`background.${background}`)}`}
                aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((value) => !value)}>
                <Icon size={14} aria-hidden />
                <span>{t(`background.${background}`)}</span>
                <ChevronDown size={12} aria-hidden />
            </button>
            {open && (
                <div className="mf-background-menu" id={menuId} role="menu" aria-label={t("toolbar.background")}>
                    {patterns.map(({ value, icon: PatternIcon }) => (
                        <button type="button" className="mf-background-option" key={value}
                            role="menuitemradio" aria-checked={value === background}
                            onClick={() => {
                                if (value !== background) commit((prev) => ({ ...prev, background: value }));
                                close();
                            }}>
                            <PatternIcon size={15} aria-hidden />
                            <span>{t(`background.${value}`)}</span>
                            {value === background && <Check size={14} className="mf-background-check" aria-hidden />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
