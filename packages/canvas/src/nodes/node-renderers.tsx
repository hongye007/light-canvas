import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Play, Replace, Upload, Wand2 } from "lucide-react";
import type { Asset, CanvasNode, MediaNodeData, TextNodeData } from "../types";
import { useCanvasContext } from "../components/context";
import { useCanvasStore } from "../store/canvas-store";
import { readMediaMetadata } from "../ai/media-metadata";
import { activeMediaAsset, archiveGeneration, isContentNode, patchNodeData, resizeNodeToAsset, setNodeMedia } from "../lib/document";
import { cancelGeneration, useNodeRuntime } from "../ai/use-node-runtime";

function NodeGenerating({ progress = 0 }: { progress?: number }) {
    const { t } = useCanvasContext();
    return <div className="mf-node-generating" role="status">
        <Loader2 className="mf-spin" size={24} aria-hidden />
        <span>{t("node.status.running")}{progress > 0 && ` · ${progress}%`}</span>
    </div>;
}

export function TextNodeBody({ node, editing }: { node: CanvasNode; editing: boolean }) {
    const { t } = useCanvasContext();
    const store = useCanvasStore();
    const data = node.data as TextNodeData;
    const runtime = useNodeRuntime(node.id);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing) ref.current?.focus();
    }, [editing]);

    if (runtime?.status === "running") return <NodeGenerating progress={Math.round((runtime.progress ?? 0) * 100)} />;

    if (editing) {
        return (
            <textarea
                ref={ref}
                className="mf-text-input"
                data-canvas-ignore-wheel
                data-canvas-no-pan
                onPointerDown={(event) => event.stopPropagation()}
                value={data.text}
                placeholder={t("node.text.placeholder")}
                onChange={(event) => store.preview((prev) => patchNodeData(prev, node.id, { text: event.target.value } as never))}
                onBlur={() => {
                    store.endGesture();
                    store.setEditing(null);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        store.endGesture();
                        store.setEditing(null);
                    }
                }}
            />
        );
    }

    if (!data.text) {
        return (
            <div className="mf-empty-card mf-text-empty">
                <div className="mf-empty-glyph"><FileText size={24} aria-hidden /></div>
                <div className="mf-empty-hint">{t("node.text.emptyHint")}</div>
            </div>
        );
    }

    return <div data-canvas-ignore-wheel className={`mf-text-body ${data.role === "prompt" ? "mf-text-prompt" : ""}`}>{data.text}</div>;
}

export function MediaNodeBody({ node, onFocusPrompt }: { node: CanvasNode; onFocusPrompt?: (id: string) => void }) {
    const { t, config, toast } = useCanvasContext();
    const store = useCanvasStore();
    const data = node.data as MediaNodeData;
    const runtime = useNodeRuntime(node.id);
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const isImage = data.type === "image";
    const contentOnly = isContentNode(node);
    const active = activeMediaAsset(data);
    const running = runtime?.status === "running";
    const progress = running ? Math.round((runtime.progress ?? 0) * 100) : 0;

    const upload = async (file: File) => {
        const producer = config.producer;
        if (busy || !producer.upload || !file.type.startsWith(`${data.type}/`)) return;
        const docId = useCanvasStore.getState().doc.id;
        setBusy(true);
        try {
            const asset = await readMediaMetadata(await producer.upload(file));
            const current = useCanvasStore.getState();
            if (current.doc.id !== docId || !current.doc.nodes.some((item) => item.id === node.id)) return;
            cancelGeneration(node.id, true);
            store.commit((prev) => {
                const target = prev.nodes.find((item) => item.id === node.id);
                if (!target || (target.data.type !== "image" && target.data.type !== "video")) return prev;
                const updated = setNodeMedia(prev, node.id, {
                    assets: [asset], activeAssetId: asset.id, status: "success", contentOnly: true, error: undefined, progress: undefined,
                    generatedAt: undefined, generationHistory: archiveGeneration(target, target.data),
                });
                return resizeNodeToAsset(updated, node.id, asset);
            });
        } catch (error) {
            toast(error instanceof Error ? error.message : t("error.unknown"), "error");
        } finally {
            setBusy(false);
        }
    };

    if (running) return <NodeGenerating progress={progress} />;

    if (runtime?.status === "error" || (!runtime && data.status === "error")) {
        return (
            <div className="mf-media-error-state" data-canvas-ignore-wheel>
                <div className="mf-error" role="alert">{runtime?.error ?? data.error ?? t("error.unknown")}</div>
                {runtime?.retry && (
                    <button type="button" className="mf-btn" data-canvas-no-pan
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => window.dispatchEvent(new CustomEvent("mf:retry", { detail: node.id }))}>
                        {t("node.action.retry")}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="mf-media" onDoubleClick={(event) => {
            if (!contentOnly || !active || !config.producer.upload || busy || (event.target as Element).closest("button")) return;
            event.stopPropagation();
            inputRef.current?.click();
        }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            const file = event.dataTransfer.files?.[0];
            if (file) {
                event.preventDefault();
                event.stopPropagation();
                void upload(file);
            }
        }}>
            {active ? (
                node.type === "video" ? (
                    <video className="mf-media-asset" src={active.url} poster={active.posterUrl} controls />
                ) : (
                    <img className="mf-media-asset" src={active.url} alt={data.prompt} draggable={false} />
                )
            ) : (
                <div className="mf-media-empty">
                    <button type="button" className="mf-media-empty-action" data-canvas-no-pan
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => onFocusPrompt?.(node.id)}>
                        <span className="mf-empty-glyph">{isImage ? <Wand2 size={24} aria-hidden /> : <Play size={24} aria-hidden />}</span>
                        <span>{t(isImage ? "node.action.generateImage" : "node.action.generateVideo")}</span>
                    </button>
                    <button type="button" className="mf-media-empty-action" data-canvas-no-pan
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => inputRef.current?.click()} disabled={busy || !config.producer.upload}>
                        <span className="mf-empty-glyph"><Upload size={24} aria-hidden /></span>
                        <span>{t("node.action.upload")}</span>
                    </button>

                </div>
            )}

            <input
                ref={inputRef}
                type="file"
                accept={isImage ? "image/*" : "video/*"}
                hidden
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void upload(file);
                }}
            />
            {contentOnly && active && config.producer.upload && (
                <button type="button" className="mf-icon-btn mf-media-replace" data-canvas-no-pan
                    title={t("node.action.replace")} aria-label={t("node.action.replace")} disabled={busy}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => inputRef.current?.click()}>
                    <Replace size={15} aria-hidden />
                </button>
            )}

            {data.assets.length > 0 && !contentOnly && (
                <div className="mf-asset-strip" data-canvas-no-pan data-canvas-ignore-wheel onPointerDown={(event) => event.stopPropagation()}>
                    {data.assets.map((asset, index) => (
                        <button
                            key={asset.id}
                            type="button"
                            className="mf-asset-thumb"
                            data-active={asset.id === active?.id || undefined}
                            title={`#${index + 1}`}
                            onClick={() =>
                                store.commit((prev) => patchNodeData(prev, node.id, { activeAssetId: asset.id } as never))
                            }
                        >
                            {node.type === "video" ? (
                                <video src={asset.url} poster={asset.posterUrl} muted />
                            ) : (
                                <img src={asset.url} alt="" />
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export type { Asset };
