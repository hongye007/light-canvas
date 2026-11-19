import { promptMentionRect } from "./prompt-editor";
import { Check, ChevronRight, FileText, Folder, Image as ImageIcon, Play, Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Asset, CanvasDocument, CanvasNode } from "../types";
import { activeMediaAsset, wouldCreateCycle } from "../lib/document";
import { useCanvasContext } from "./context";

const categories = [
    { kind: "image", icon: ImageIcon },
    { kind: "video", icon: Play },
    { kind: "text", icon: FileText },
] as const;
type Category = typeof categories[number]["kind"] | "assets";

export function ReferencePicker({ anchor, mentionStart, initialQuery, doc, target, canAttach, onClose, onSelect, onAsset }: {
    anchor: HTMLElement;
    mentionStart: number;
    initialQuery: string;
    canAttach: boolean;
    doc: CanvasDocument;
    target: CanvasNode;
    onClose: () => void;
    onSelect: (nodeId: string, label: string) => void;
    onAsset: (asset: Asset) => void;
}) {
    const { config, lang, registry, t } = useCanvasContext();
    const [category, setCategory] = useState<Category | null>(null);
    const [searchQuery, setSearchQuery] = useState<string | null>(null);
    const query = searchQuery ?? initialQuery;
    const expanded = category !== null || Boolean(searchQuery?.trim());
    const [style, setStyle] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 8, top: 8, width: 0, maxHeight: 0 });
    const panel = useRef<HTMLDivElement>(null);
    const active = useRef<HTMLButtonElement | null>(null);
    const column = useRef<"nav" | "list">("nav");
    const enterList = useRef(false);

    useLayoutEffect(() => {
        if (!expanded || !enterList.current) return;
        enterList.current = false;
        const first = panel.current?.querySelector<HTMLButtonElement>(".mf-reference-picker-list button:not(:disabled)");
        if (first) highlight(first);
    });

    function highlight(button: HTMLButtonElement | null) {
        active.current?.removeAttribute("data-keyboard-active");
        active.current = button;
        if (!button) return;
        column.current = button.closest(".mf-reference-picker-list") ? "list" : "nav";
        button.dataset.keyboardActive = "true";
        button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    useLayoutEffect(() => {
        const navigate = (event: KeyboardEvent) => {
            if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
            const searching = event.target instanceof HTMLInputElement;
            const list = panel.current?.querySelector(".mf-reference-picker-list");
            const nav = panel.current?.querySelector(".mf-reference-picker-nav");
            const focus = active.current?.isConnected ? active.current : null;
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                anchor.focus();
                return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const scope = searching || column.current === "list" ? list ?? nav : nav;
                const rows = Array.from(scope?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
                if (!rows.length) return;
                event.preventDefault();
                const index = focus ? rows.indexOf(focus) : -1;
                const step = event.key === "ArrowDown" ? 1 : -1;
                highlight(rows[index < 0 ? (step === 1 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length]);
                return;
            }
            if (event.key === "ArrowLeft" && !searching && focus?.closest(".mf-reference-picker-list")) {
                event.preventDefault();
                const categoryButton = nav?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
                column.current = "nav";
                highlight(categoryButton ?? null);
                return;
            }
            if (event.key === "ArrowRight" && !searching && focus?.hasAttribute("aria-pressed")) {
                event.preventDefault();
                const first = focus.getAttribute("aria-pressed") === "true"
                    ? list?.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
                if (first) highlight(first);
                else {
                    enterList.current = true;
                    focus.click();
                }
                return;
            }
            if (event.key !== "Enter") return;
            const button = focus ?? (searching ? list?.querySelector<HTMLButtonElement>("button:not(:disabled)") : null);
            if (!button) return;
            event.preventDefault();
            if (button.hasAttribute("aria-pressed")) {
                const first = button.getAttribute("aria-pressed") === "true"
                    ? list?.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
                if (first) {
                    highlight(first);
                    return;
                }
                enterList.current = true;
            }
            button.click();
        };
        const popup = panel.current;
        anchor.addEventListener("keydown", navigate);
        popup?.addEventListener("keydown", navigate);
        return () => {
            anchor.removeEventListener("keydown", navigate);
            popup?.removeEventListener("keydown", navigate);
        };
    }, [anchor, onClose]);

    useLayoutEffect(() => {
        const place = () => {
            const editorRect = anchor.getBoundingClientRect();
            const anchorRect = promptMentionRect(anchor, mentionStart) ?? editorRect;
            const fullWidth = Math.min(416, window.innerWidth - 16);
            const width = expanded ? fullWidth : Math.min(192, fullWidth);
            const left = Math.min(Math.max(8, anchorRect.left), window.innerWidth - width - 8);
            const top = Math.max(editorRect.top, Math.min(anchorRect.top, editorRect.bottom));
            const bottom = Math.max(top, Math.min(anchorRect.bottom, editorRect.bottom));
            const below = window.innerHeight - bottom - 14;
            const above = top - 14;
            const upwards = below < 360 && above > below;
            setStyle({
                left,
                ...(upwards ? { bottom: window.innerHeight - top + 6 } : { top: bottom + 6 }),
                width,
                maxHeight: Math.max(92, Math.min(420, upwards ? above : below)),
            });
        };
        place();
        const followEditor = (event: Event) => {
            if (event.target === document || (event.target instanceof Node && event.target.contains(anchor))) place();
        };
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !anchor.contains(event.target) && !panel.current?.contains(event.target)) onClose();
        };
        document.addEventListener("pointerdown", outside);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", followEditor, true);
        const observer = new ResizeObserver(place);
        observer.observe(anchor);
        return () => {
            document.removeEventListener("pointerdown", outside);
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", followEditor, true);
            observer.disconnect();
        };
    }, [anchor, doc.viewport, expanded, mentionStart, onClose]);

    const linked = new Set(doc.edges.filter((edge) => edge.to === target.id).map((edge) => edge.from));
    const candidates = doc.nodes.filter((node) => node.id !== target.id &&
        categories.some(({ kind }) => kind === node.data.type) &&
        registry.get(node.type)?.capabilities.canConnect !== false);
    const name = (node: CanvasNode) => node.title || t(registry.get(node.type)?.labelKey ?? `node.${node.type}.label`);
    const term = query.trim().toLowerCase();
    const results = candidates.filter((node) => {
        if (!term) return node.data.type === category;
        return `${name(node)} ${node.data.type === "text" ? node.data.text : ""}`.toLowerCase().includes(term);
    });

    const preview = (node: CanvasNode) => {
        const data = node.data;
        const Icon = data.type === "text" ? FileText : data.type === "video" ? Play : ImageIcon;
        const asset = data.type === "image" || data.type === "video"
            ? activeMediaAsset(data)
            : undefined;
        const url = asset?.kind === "image" ? asset.url : asset?.posterUrl;
        return <span className="mf-reference-preview">
            <Icon size={14} aria-hidden />
            {url && <img src={url} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
        </span>;
    };

    const showCategory = (value: Category) => {
        setCategory(value);
        if (searchQuery !== null) setSearchQuery("");
    };
    const host = anchor.closest(".mf-root") ?? document.body;
    return createPortal(
        <div className="mf-reference-picker" data-expanded={expanded || undefined} ref={panel} style={style} role="dialog" aria-label={t("panel.references")}
            data-canvas-no-pan data-canvas-ignore-wheel
            onPointerDown={(event) => event.stopPropagation()}>
            <div className="mf-reference-picker-nav">
                <label className="mf-reference-search">
                    <Search size={14} aria-hidden />
                    <input value={query} onChange={(event) => {
                        highlight(null);
                        setSearchQuery(event.target.value);
                    }} placeholder={t("panel.referenceSearch")} aria-label={t("panel.referenceSearch")} />
                </label>
                {linked.size > 0 && <>
                    <div className="mf-reference-label">{t("panel.alreadyReferenced")}</div>
                    {candidates.filter((node) => linked.has(node.id)).map((node) => (
                        <button type="button" className="mf-reference-row" key={node.id} onClick={() => onSelect(node.id, name(node))}>
                            {preview(node)}<span>{name(node)}</span><Check size={14} aria-hidden />
                        </button>
                    ))}
                </>}
                <div className="mf-reference-label">{t("panel.referenceSources")}</div>
                {categories.map(({ kind, icon: Icon }) => (
                    <button type="button" className="mf-reference-row" key={kind}
                        aria-pressed={category === kind} onPointerEnter={() => { highlight(null); column.current = "list"; showCategory(kind); }} onClick={() => showCategory(kind)}>
                        <Icon size={16} aria-hidden /><span>{t(`node.${kind}.label`)}</span><ChevronRight size={13} aria-hidden />
                    </button>
                ))}
                {canAttach && config.renderAssetLibrary && <button type="button" className="mf-reference-row"
                    aria-pressed={category === "assets"} onPointerEnter={() => { highlight(null); column.current = "list"; showCategory("assets"); }} onClick={() => showCategory("assets")}>
                    <Folder size={16} aria-hidden /><span>{t("rail.assets")}</span><ChevronRight size={13} aria-hidden />
                </button>}
            </div>
            {expanded && <div className="mf-reference-picker-list">
                {category === "assets"
                    ? config.renderAssetLibrary?.(lang, onAsset)
                    : results.length ? results.map((node) => (
                        <button type="button" className="mf-reference-row" key={node.id}
                            disabled={!linked.has(node.id) && (!canAttach || wouldCreateCycle(doc, node.id, target.id))}
                            onClick={() => onSelect(node.id, name(node))} title={name(node)}>
                            {preview(node)}<span>{name(node)}</span>{linked.has(node.id) && <Check size={14} aria-hidden />}
                        </button>
                    )) : <div className="mf-reference-label">{t("panel.referenceNoMatches")}</div>}
            </div>}
        </div>, host);
}
