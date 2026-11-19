import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History, Play, X } from "lucide-react";
import type { Asset, CanvasNode, MediaNodeData } from "../types";
import { addNode, createMediaNode, getNode, resizeNodeToAsset, setNodeMedia, updateNode } from "../lib/document";
import { nodeRect, rectsIntersect } from "../lib/geometry";
import { useCanvasStore } from "../store/canvas-store";
import { useCanvasContext } from "./context";

export function MediaHistory({ node, data }: { node: CanvasNode; data: MediaNodeData }) {
    const { lang, t } = useCanvasContext();
    const store = useCanvasStore();
    const batches = data.generationHistory ?? [];
    const [previewId, setPreviewId] = useState<string>();
    const trigger = useRef<HTMLButtonElement>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const heading = useId();
    const title = t("mediaHistory.title");
    const preview = batches.flatMap((batch) => batch.assets).find((asset) => asset.id === previewId);
    const host = trigger.current?.closest(".mf-root");

    useLayoutEffect(() => {
        if (preview && !dialog.current?.open) dialog.current?.showModal();
    }, [preview]);

    function selectAsset(asset: Asset) {
        store.commit((prev) => resizeNodeToAsset(setNodeMedia(prev, node.id, { activeAssetId: asset.id }), node.id, asset));
    }

    function copyAsset(asset: Asset) {
        store.commit((prev) => {
            const source = getNode(prev, node.id);
            if (!source) return prev;
            const copy = createMediaNode(data.type, { x: source.position.x + source.width + 36, y: source.position.y });
            copy.data = { type: data.type, assets: [asset], activeAssetId: asset.id, prompt: "", status: "success", contentOnly: true };
            const next = resizeNodeToAsset(addNode(prev, copy), copy.id, asset);
            const sized = getNode(next, copy.id) ?? copy;
            const bounds = nodeRect(sized);
            for (const occupied of prev.nodes.filter((item) => item.type !== "group").map(nodeRect).sort((a, b) => a.y - b.y)) {
                if (rectsIntersect(bounds, occupied)) bounds.y = occupied.y + occupied.height + 24;
            }
            return bounds.y === sized.position.y ? next : updateNode(next, copy.id, { position: { x: bounds.x, y: bounds.y } });
        });
        dialog.current?.close();
    }

    if (!batches.length) return null;
    const dateFormat = new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "short" });
    return <>
        <button ref={trigger} type="button" className="mf-icon-btn mf-history-trigger" aria-label={title} title={title}
            aria-haspopup="dialog" data-canvas-no-pan onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setPreviewId(batches[0].assets[0]?.id)}>
            <History size={14} aria-hidden />
        </button>
        {preview && host && createPortal(
            <dialog ref={dialog} className="mf-media-history" aria-labelledby={heading} data-canvas-no-pan data-canvas-ignore-wheel
                onClose={() => {
                    setPreviewId(undefined);
                    trigger.current?.focus({ preventScroll: true });
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    if (event.target === event.currentTarget) dialog.current?.close();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}>
                <div className="mf-history-content">
                    <header>
                        <h2 id={heading}>{title}</h2>
                        <button type="button" className="mf-icon-btn" aria-label={t("mediaHistory.close")} onClick={() => dialog.current?.close()}>
                            <X size={17} aria-hidden />
                        </button>
                    </header>
                    <div className="mf-history-preview">
                        {preview.kind === "image" ? <img src={preview.url} alt={t("mediaHistory.preview")} />
                            : <video key={preview.id} src={preview.url} poster={preview.posterUrl} controls />}
                    </div>
                    <div className="mf-history-actions">
                        <button type="button" className="mf-btn" onClick={() => copyAsset(preview)}>{t("mediaHistory.copy")}</button>
                        <button type="button" className="mf-btn" disabled={data.activeAssetId === preview.id}
                            onClick={() => selectAsset(preview)}>{t(data.activeAssetId === preview.id ? "mediaHistory.current" : "mediaHistory.activate")}</button>
                    </div>
                    <div className="mf-history-batches">
                        {batches.map((batch) => <section key={batch.id}>
                            <h3>{batch.createdAt && !Number.isNaN(new Date(batch.createdAt).getTime())
                                ? dateFormat.format(batch.createdAt) : t("mediaHistory.previousBatch")}</h3>
                            <div className="mf-history-assets">
                                {batch.assets.map((asset, index) => <button type="button" key={asset.id}
                                    className="mf-asset-thumb" data-active={asset.id === preview.id || undefined}
                                    aria-pressed={asset.id === preview.id} aria-label={t("mediaHistory.result", { index: index + 1 })}
                                    onClick={() => setPreviewId(asset.id)}>
                                    {asset.kind === "image" || asset.posterUrl ? <img src={asset.posterUrl || asset.url} alt="" />
                                        : <Play size={18} aria-hidden />}
                                </button>)}
                            </div>
                        </section>)}
                    </div>
                </div>
            </dialog>, host)}
    </>;
}
