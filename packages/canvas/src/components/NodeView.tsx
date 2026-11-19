import { MediaDownload } from "./MediaDownload";
import { MediaHistory } from "./MediaHistory";
import { useRef } from "react";
import { FileText, Image as ImageIcon, Play, Boxes, Lock, Plus } from "lucide-react";
import type { CanvasNode, ResizeHandle, Vec } from "../types";
import { NODE_HEADER_HEIGHT, NODE_MIN_HEIGHT, NODE_MIN_WIDTH, resizeRect, sizeForRatio, screenToWorld } from "../lib/geometry";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";
import { activeMediaAsset, isContentNode, patchNodeData, updateNode } from "../lib/document";
import { beginConnection, type ConnectionDrop } from "./ConnectionLayer";
import { useConnectDraft, useConnectDraftHasTarget } from "../store/connect-store";
import { TextNodeBody, MediaNodeBody } from "../nodes/node-renderers";
import { GroupControls } from "./GroupControls";
import { cancelGeneration, generateForNode } from "../ai/use-node-runtime";

const MEDIA_FRAME_INSET = 2;
const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function NodeView({
    node,
    stackIndex,
    onBeginDrag,
    onFocusPrompt,
    onEmptyConnectionDrop,
    marqueeSelected,
    groupDropTarget,
}: {
    node: CanvasNode;
    stackIndex: number;
    onBeginDrag: (event: React.PointerEvent, node: CanvasNode) => void;
    onEmptyConnectionDrop?: (drop: ConnectionDrop) => void;
    onFocusPrompt?: (id: string) => void;
    marqueeSelected?: boolean;
    groupDropTarget?: boolean;
}) {
    const { t, registry, config, mode, tokens } = useCanvasContext();
    const definition = registry.get(node.type);
    const Renderer = definition?.render;
    const canConnect = definition?.capabilities.canConnect ?? true;
    const store = useCanvasStore();
    const selected = store.selection.has(node.id);
    const editing = store.editingNodeId === node.id;
    const runtime = store.runtime[node.id];
    const isConnectTarget = useConnectDraftHasTarget(node.id);
    const connecting = useConnectDraft() !== null;
    const resizeRef = useRef<{ handle: ResizeHandle; start: Vec; mediaRatio?: number; rect: { x: number; y: number; width: number; height: number } } | null>(null);

    const isGroup = node.type === "group";
    const contentOnly = isContentNode(node);

    const media = node.data.type === "image" || node.data.type === "video" ? node.data : undefined;
    const activeAsset = media ? activeMediaAsset(media) : undefined;
    const status: string =
        runtime?.status ?? (node.data.type === "image" || node.data.type === "video" ? node.data.status : "idle");

    // ------------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------------
    const onResizePointerDown = (event: React.PointerEvent, handle: ResizeHandle) => {
        event.stopPropagation();
        event.preventDefault();
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        let mediaRatio: number | undefined;
        if (media) {
            const element = target.closest(".mf-node")?.querySelector(".mf-media-asset");
            const width = element instanceof HTMLImageElement ? element.naturalWidth
                : element instanceof HTMLVideoElement ? element.videoWidth : 0;
            const height = element instanceof HTMLImageElement ? element.naturalHeight
                : element instanceof HTMLVideoElement ? element.videoHeight : 0;
            mediaRatio = width > 0 && height > 0 ? width / height
                : activeAsset?.width && activeAsset.height && activeAsset.width > 0 && activeAsset.height > 0
                    ? activeAsset.width / activeAsset.height
                    : Math.max(1, node.width - MEDIA_FRAME_INSET) / Math.max(1, node.height - NODE_HEADER_HEIGHT - MEDIA_FRAME_INSET);
        }
        resizeRef.current = {
            mediaRatio,
            handle,
            start: screenToWorld({ x: event.clientX, y: event.clientY }, store.doc.viewport),
            rect: { x: node.position.x, y: node.position.y, width: node.width, height: node.height },
        };
    };

    const onResizePointerMove = (event: React.PointerEvent) => {
        const state = resizeRef.current;
        if (!state) return;
        store.beginGesture();
        const world = screenToWorld({ x: event.clientX, y: event.clientY }, store.doc.viewport);
        const data = node.data;
        const atInitialMinimum = data.type === "text" || ((data.type === "image" || data.type === "video") && data.assets.length === 0);
        const min = (atInitialMinimum ? definition?.defaultSize : definition?.minSize) ?? { width: NODE_MIN_WIDTH, height: NODE_MIN_HEIGHT };
        const insetWidth = media ? MEDIA_FRAME_INSET : 0;
        const insetHeight = isGroup ? 0 : NODE_HEADER_HEIGHT + insetWidth;
        const ratio = state.mediaRatio ?? ((event.shiftKey || node.aspectLocked)
            ? state.rect.width / Math.max(state.rect.height - insetHeight, 1)
            : undefined);
        const next = resizeRect(
            state.rect,
            state.handle,
            { x: world.x - state.start.x, y: world.y - state.start.y },
            {
                minWidth: min.width,
                minHeight: min.height,
                ratio,
                insetHeight,
                insetWidth,
            },
        );
        store.preview((prev) => updateNode(prev, node.id, { position: { x: next.x, y: next.y }, width: next.width, height: next.height }));
    };

    const onResizePointerUp = () => {
        if (!resizeRef.current) return;
        resizeRef.current = null;
        store.endGesture();
    };

    const title = node.title || (isGroup ? (node.data.type === "group" ? node.data.label : "") : t(definition?.labelKey ?? `node.${node.type}.label`));
    const Icon = isGroup ? Boxes : node.type === "text" ? FileText : node.type === "video" ? Play : ImageIcon;

    return (
        <>
            <div
                className="mf-node"
                data-node-id={node.id}
                data-selected={(marqueeSelected ?? selected) || undefined}
                data-connect-target={isConnectTarget || undefined}
                data-group={isGroup || undefined}
                data-group-drop-target={groupDropTarget || undefined}
                style={{
                    left: node.position.x,
                    top: node.position.y,
                    width: node.width,
                    height: node.height,
                    // Overlapping cards: the one in focus must come to the front.
                    zIndex: stackIndex,
                }}
                onPointerDown={(event) => {
                    // A press that lands in the port band (the outer 18px of either
                    // side) starts a connection instead of dragging the node, so the
                    // handle does not have to be revealed first.
                    if (event.button === 0 && !isGroup && canConnect) {
                        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        const offsetX = event.clientX - box.left;
                        const zoom = useCanvasStore.getState().doc.viewport.k;
                        const band = Math.max(18 / zoom, 10);
                        if (offsetX <= band) {
                            beginConnection(node.id, "left", event, registry, onEmptyConnectionDrop);
                            return;
                        }
                        if (box.width - offsetX <= band) {
                            beginConnection(node.id, "right", event, registry, onEmptyConnectionDrop);
                            return;
                        }
                    }
                    onBeginDrag(event, node);
                }}
                onPointerEnter={() => store.setHovered(node.id)}
                onPointerLeave={() => store.setHovered(null)}
                onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (node.data.type === "text" && node.data.role !== "prompt") {
                        if (!contentOnly) {
                            cancelGeneration(node.id, true);
                            store.commit((prev) => patchNodeData(prev, node.id, { contentOnly: true }));
                        }
                        store.setEditing(node.id);
                    }
                }}
            >
                {isGroup && node.data.type === "group" && (
                    <div className="mf-group-head">
                        <Boxes size={15} aria-hidden />
                        <span className="mf-node-title">{title}</span>
                        <GroupControls groupId={node.id} visible={selected} />
                    </div>
                )}
                {!isGroup && (
                    <div className="mf-node-head" style={{ height: NODE_HEADER_HEIGHT }}>
                        <Icon size={14} className="mf-node-icon" />
                        <span className="mf-node-title">{title}</span>
                        {!contentOnly && status !== "idle" && <span className={`mf-node-status mf-status-${status}`}>{t(`node.status.${status}`)}</span>}
                        {(node.data.type === "image" || node.data.type === "video") && <MediaHistory node={node} data={node.data} />}
                        {activeAsset && status !== "running" && status !== "error" && <MediaDownload asset={activeAsset} title={title} />}
                    </div>
                )}

                <div className="mf-node-body">
                    {Renderer ? (
                        <Renderer
                            node={node}
                            selected={selected}
                            zoom={store.doc.viewport.k}
                            t={t}
                            theme={{ mode, color: (token) => tokens[token as keyof typeof tokens] ?? "" }}
                            updateData={(patch) => store.commit((prev) => patchNodeData(prev, node.id, patch))}
                            run={(mode) => {
                                const kind = definition.capabilities.generateKind;
                                const model = config.models.find((item) => kind && item.capabilities.includes(kind));
                                if (!definition.capabilities.canGenerate || !model) return;
                                void generateForNode({
                                    nodeId: node.id, producer: config.producer, model: model.id, mode,
                                    params: { ratio: config.defaultRatio ?? "1:1", quality: config.defaultQuality ?? "standard", count: 1 },
                                });
                            }}
                            selectedAssetId={"activeAssetId" in node.data && typeof node.data.activeAssetId === "string" ? node.data.activeAssetId : undefined}
                            selectAsset={(activeAssetId) => store.commit((prev) => patchNodeData(prev, node.id, { activeAssetId }))}
                        />
                    ) : (
                        <>
                            {node.data.type === "text" && <TextNodeBody node={node} editing={editing} />}
                            {(node.data.type === "image" || node.data.type === "video") && <MediaNodeBody node={node} onFocusPrompt={onFocusPrompt} />}
                        </>
                    )}
                </div>

                {/* Circular "+" ports on both sides. Always mounted so a connection can be
                    started without selecting the node; hidden while a drag is in flight so
                    they never block the drop target. */}
                {!isGroup && (
                    <>
                        {canConnect && <>
                        <span className="mf-port mf-port-left" data-connecting={connecting || undefined}>
                            <Plus size={11} strokeWidth={2.2} />
                            <span
                                className="mf-port-hit"
                                role="button"
                                tabIndex={0}
                                aria-label={t("node.action.connect")}
                                title={t("node.action.connect")}
                                onPointerDown={(event) => beginConnection(node.id, "left", event, registry, onEmptyConnectionDrop)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        beginConnection(node.id, "left", event as unknown as React.PointerEvent, registry, onEmptyConnectionDrop);
                                    }
                                }}
                            />
                        </span>
                        <span className="mf-port mf-port-right" data-connecting={connecting || undefined}>
                            <Plus size={11} strokeWidth={2.2} />
                            <span
                                className="mf-port-hit"
                                role="button"
                                tabIndex={0}
                                aria-label={t("node.action.connect")}
                                title={t("node.action.connect")}
                                onPointerDown={(event) => beginConnection(node.id, "right", event, registry, onEmptyConnectionDrop)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        beginConnection(node.id, "right", event as unknown as React.PointerEvent, registry, onEmptyConnectionDrop);
                                    }
                                }}
                            />
                        </span>
                        </>}
                    </>
                )}
                {marqueeSelected === undefined && selected && (definition?.resizable ?? true) &&
                            HANDLES.map((handle) => (
                                <div
                                    key={handle}
                                    className={`mf-handle mf-handle-${handle}`}
                                    onPointerDown={(event) => onResizePointerDown(event, handle)}
                                    onPointerMove={onResizePointerMove}
                                    onPointerUp={onResizePointerUp}
                                    onPointerCancel={onResizePointerUp}
                                    onLostPointerCapture={onResizePointerUp}
                                />
                            ))}

                {node.aspectLocked && (
                    <span className="mf-node-locked" aria-hidden>
                        <Lock size={10} />
                    </span>
                )}
            </div>
        </>
    );
}

export function defaultSizeForRatio(ratio: string) {
    return sizeForRatio(ratio, 360);
}
