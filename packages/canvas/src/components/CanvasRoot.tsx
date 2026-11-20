import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";
import { CanvasLayer } from "./CanvasLayer";
import { NodeView } from "./NodeView";
import { EdgeLayer } from "./EdgeLayer";
import { ConnectionLayer, type ConnectionDrop } from "./ConnectionLayer";
import { AlignmentGuides, useAlignmentGuides } from "./AlignmentGuides";
import { Minimap } from "./Minimap";
import { TopBar } from "./TopBar";
import { Rail } from "./Rail";
import { NodePromptPanel } from "./NodePromptPanel";
import { SelectionToolbar } from "./SelectionToolbar";
import { NodeSearch } from "./NodeSearch";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { ZoomControls } from "./ZoomControls";
import { ContextMenu } from "./ContextMenu";
import { themeStyle } from "../store/theme";
import { clamp, fitViewport, boundsOf, normalizeRect, rectsIntersect, nodeRect, screenToWorld, visibleWorldRect, zoomAt } from "../lib/geometry";
import { createTextNode, createMediaNode, createGroupNode, connect, disconnect, groupNodes, removeNodes, duplicateNodes, ungroupNodes, addNode, getNode, isContentNode } from "../lib/document";
import { downloadDocument, parseDocument } from "../lib/serialize";
import { pasteNodes } from "../lib/document";
import { generateForNode } from "../ai/use-node-runtime";
import type { CanvasDocument, CanvasNode, Edge, Vec } from "../types";
import { computeSnap, groupContainingNode } from "../lib/hit-testing";
import "../styles.css";

type Gesture =
    | { type: "pan"; start: Vec; origin: Vec }
    | { type: "marquee"; start: Vec; current: Vec; additive: boolean }
    | { type: "drag"; start: Vec; origin: Map<string, Vec>; moved: boolean }
    | null;

function marqueeHits(nodes: CanvasNode[], box: ReturnType<typeof normalizeRect>) {
    if (!box.width && !box.height) return [];
    return nodes.filter((node) => node.type !== "group" && rectsIntersect(nodeRect(node), box)).map((node) => node.id);
}

const ZOOM_STEP = 1.25;

export function CanvasRoot({ externalDocument, notifications }: { externalDocument?: CanvasDocument | null; notifications?: ReactNode }) {
    const { config, theme, mode, shell, t, lang } = useCanvasContext();
    const store = useCanvasStore();
    const doc = store.doc;
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [gesture, setGesture] = useState<Gesture>(null);
    const gestureRef = useRef<Gesture>(null);
    const [spaceDown, setSpaceDown] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string; connection?: ConnectionDrop } | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [drawer, setDrawer] = useState<"nodes" | "assets" | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [showZoom, setShowZoom] = useState(true);
    const [showMap, setShowMap] = useState(true);
    const [spacePanning, setSpacePanning] = useState(false);
    const lastAdoptedRef = useRef<CanvasDocument | null>(null);

    gestureRef.current = gesture;

    // ---------------------------------------------------------------------
    // Size tracking
    // ---------------------------------------------------------------------
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(element);
        setSize({ width: element.clientWidth, height: element.clientHeight });
        return () => observer.disconnect();
    }, []);

    // ---------------------------------------------------------------------
    // Space-to-pan
    // ---------------------------------------------------------------------
    useEffect(() => {
        const isTyping = (target: EventTarget | null) => {
            const element = target instanceof Element ? target : null;
            return Boolean(element?.closest("input,textarea,select,[contenteditable='true']"));
        };
        const down = (event: KeyboardEvent) => {
            if (event.code !== "Space" || isTyping(event.target)) return;
            event.preventDefault();
            setSpaceDown(true);
        };
        const up = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            setSpaceDown(false);
            setSpacePanning(false);
        };
        const blur = () => {
            setSpaceDown(false);
            setSpacePanning(false);
        };
        window.addEventListener("keydown", down);
        window.addEventListener("keyup", up);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
            window.removeEventListener("blur", blur);
        };
    }, []);

    const toLocal = (event: { clientX: number; clientY: number }): Vec => {
        const rect = containerRef.current?.getBoundingClientRect();
        return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    };

    const toWorld = (event: { clientX: number; clientY: number }): Vec => screenToWorld(toLocal(event), useCanvasStore.getState().doc.viewport);

    const zoomBy = (factor: number) => {
        const viewport = useCanvasStore.getState().doc.viewport;
        store.setViewport(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, factor));
    };

    const fitToContent = () => {
        const bounds = boundsOf(doc.nodes.filter((node) => node.type !== "group"));
        if (!bounds) return;
        store.setViewport(fitViewport(bounds, size, 120, 1));
    };

    // ---------------------------------------------------------------------
    // Wheel: scroll pans the canvas (horizontal wheel pans sideways),
    // Ctrl/Cmd + wheel zooms around the cursor — the standard editor mapping.
    // ---------------------------------------------------------------------
    const onWheel = (event: React.WheelEvent) => {
        const target = event.target as Element | null;
        if (target?.closest("[data-canvas-ignore-wheel]")) return;
        const viewport = useCanvasStore.getState().doc.viewport;

        if (event.ctrlKey || event.metaKey) {
            const factor = Math.exp(-event.deltaY * 0.0022);
            store.setViewport(zoomAt(viewport, toLocal(event), factor));
            return;
        }

        // Trackpads report both axes; a Shift + wheel reports its scroll on X.
        const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
        if (dx === 0 && dy === 0) return;
        store.setViewport({ x: viewport.x - dx, y: viewport.y - dy, k: viewport.k });
    };

    // ---------------------------------------------------------------------
    // Background pointer down: pan / marquee / deselect
    // ---------------------------------------------------------------------
    const onBackgroundPointerDown = (event: React.PointerEvent) => {
        if (event.button === 2) return;
        const target = event.target as Element | null;
        if (target?.closest("[data-canvas-no-pan]")) return;
        const tool = store.tool;
        const wantsPan = event.button === 1 || spaceDown || tool === "pan";
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

        if (wantsPan) {
            event.preventDefault();
            setSpacePanning(true);
            setGesture({ type: "pan", start: toLocal(event), origin: { x: doc.viewport.x, y: doc.viewport.y } });
            return;
        }
        const start = toWorld(event);
        setGesture({ type: "marquee", start, current: start, additive: event.shiftKey });
    };

    // ---------------------------------------------------------------------
    // Node drag (called from NodeView)
    // ---------------------------------------------------------------------
    const beginNodeDrag = (event: React.PointerEvent, target: CanvasNode) => {
        if (event.button !== 0) return;
        if (spaceDown || useCanvasStore.getState().tool === "pan") return;
        const state = useCanvasStore.getState();
        const alreadySelected = state.selection.has(target.id);
        const nextSelection = alreadySelected
            ? [...state.selection]
            : event.shiftKey
              ? [...state.selection, target.id]
              : [target.id];
        if (!alreadySelected) state.select(nextSelection);

        const origin = new Map<string, Vec>();
        for (const id of nextSelection) {
            const item = getNode(state.doc, id);
            if (item) origin.set(id, { ...item.position });
        }
        for (const item of state.doc.nodes) {
            if (item.groupId && nextSelection.includes(item.groupId)) origin.set(item.id, { ...item.position });
        }
        event.stopPropagation();
        // No pointer capture on the node: the window listeners below own the gesture,
        // which keeps drag working even when the pointer leaves the node.
        const drag: Gesture = { type: "drag", start: toWorld(event), origin, moved: false };
        gestureRef.current = drag;
        useCanvasStore.getState().beginGesture();
        setGesture(drag);
    };

    // ---------------------------------------------------------------------
    // Global pointer move / up: one driver for every gesture
    // ---------------------------------------------------------------------
    useEffect(() => {
        if (!gesture) return;

        const move = (event: PointerEvent) => {
            const current = gestureRef.current;
            if (!current) return;
            if (current.type === "pan") {
                const local = toLocal(event);
                useCanvasStore.getState().setViewport({
                    x: current.origin.x + (local.x - current.start.x),
                    y: current.origin.y + (local.y - current.start.y),
                    k: useCanvasStore.getState().doc.viewport.k,
                });
                return;
            }
            const world = toWorld(event);
            if (current.type === "drag") {
                const dx = world.x - current.start.x;
                const dy = world.y - current.start.y;
                if (!current.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
                current.moved = true;
                // Move from the positions captured at gesture start, never accumulated deltas.
                const origin = current.origin;
                const store2 = useCanvasStore.getState();

                // Snap a single moving node to the edges/centers of the others.
                let snapDx = 0;
                let snapDy = 0;
                if (origin.size === 1) {
                    const [id] = [...origin.keys()];
                    const base = origin.get(id)!;
                    const self = store2.doc.nodes.find((node) => node.id === id);
                    if (self && self.type !== "group") {
                        const others = store2.doc.nodes.filter((node) => node.id !== id && node.type !== "group");
                        const snapped = computeSnap(
                            { x: base.x + dx, y: base.y + dy, width: self.width, height: self.height },
                            others,
                            6 / Math.max(store2.doc.viewport.k, 0.2),
                        );
                        snapDx = snapped.x - (base.x + dx);
                        snapDy = snapped.y - (base.y + dy);
                        useAlignmentGuides.getState().set(snapped.guides);
                    }
                }

                store2.preview((prev) => ({
                    ...prev,
                    nodes: prev.nodes.map((item) => {
                        const base = origin.get(item.id);
                        return base ? { ...item, position: { x: Math.round(base.x + dx + snapDx), y: Math.round(base.y + dy + snapDy) } } : item;
                    }),
                }));
                return;
            }
            if (current.type === "marquee") {
                const next: Gesture = { ...current, current: world };
                gestureRef.current = next;
                setGesture(next);
            }
        };

        const up = (event: PointerEvent) => {
            const current = gestureRef.current;
            if (current?.type === "drag") {
                const store2 = useCanvasStore.getState();
                if (current.moved && event.type !== "pointercancel") {
                    store2.preview((prev) => {
                        let changed = false;
                        const nodes = prev.nodes.map((node) => {
                            if (!current.origin.has(node.id) || node.type === "group" || (node.groupId && current.origin.has(node.groupId))) return node;
                            const groupId = groupContainingNode(prev.nodes, node)?.id;
                            if (node.groupId === groupId) return node;
                            changed = true;
                            return { ...node, groupId };
                        });
                        return changed ? { ...prev, nodes } : prev;
                    });
                }
                store2.endGesture();
                useAlignmentGuides.getState().clear();
            }
            if (current?.type === "marquee" && event.type !== "pointercancel") {
                const state = useCanvasStore.getState();
                const inside = marqueeHits(state.doc.nodes, normalizeRect(current.start, toWorld(event)));
                if (inside.length || !current.additive) state.select(inside, current.additive);
            }
            gestureRef.current = null;
            setGesture(null);
            setSpacePanning(false);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
    }, [gesture, store]);

    // Retry from the node's error badge re-runs the last known prompt and params.
    useEffect(() => {
        const handler = (event: Event) => {
            const nodeId = (event as CustomEvent<string>).detail;
            const state = useCanvasStore.getState();
            const node = getNode(state.doc, nodeId);
            if (!node || (node.data.type !== "image" && node.data.type !== "video")) return;
            const retry = state.runtime[nodeId]?.retry;
            const model = retry?.model ?? config.models.find((item) => item.capabilities.some((capability) => capability === node.data.type))?.id;
            if (!model) return;
            void generateForNode({
                nodeId,
                producer: config.producer,
                model,
                prompt: node.data.prompt,
                mode: retry?.mode,
                params: retry?.params ?? { ratio: node.data.type === "video" ? "16:9" : config.defaultRatio ?? "1:1", quality: config.defaultQuality ?? "standard", count: 1 },
            });
        };
        window.addEventListener("mf:retry", handler as EventListener);
        return () => window.removeEventListener("mf:retry", handler as EventListener);
    }, [config]);

    // ---------------------------------------------------------------------
    // Host sync: notify on change, adopt documents pushed from outside.
    // The guard stops the echo loop when the host stores the doc and sends it back.
    // ---------------------------------------------------------------------
    const lastSentRef = useRef<CanvasDocument | null>(null);
    useEffect(() => {
        if (lastSentRef.current === doc) return;
        lastSentRef.current = doc;
        config.onDocumentChange?.(doc);
    }, [doc, config]);

    useEffect(() => {
        if (!externalDocument || externalDocument === lastAdoptedRef.current) return;
        const isOwnEcho = externalDocument.nodes === doc.nodes;
        if (isOwnEcho) {
            lastAdoptedRef.current = externalDocument;
            return;
        }
        lastAdoptedRef.current = externalDocument;
        lastSentRef.current = externalDocument;
        store.load(externalDocument);
    }, [externalDocument]);

    // ---------------------------------------------------------------------
    const copiedNodes = useRef<{ nodes: CanvasNode[]; edges: Edge[] } | null>(null);

    // Keyboard shortcuts
    // ---------------------------------------------------------------------
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (shell.rail && shell.showSettings && settingsOpen) return;
            const target = event.target as Element | null;
            const typing = Boolean(target?.closest("input,textarea,select,[contenteditable='true']"));
            const mod = event.metaKey || event.ctrlKey;
            const state = useCanvasStore.getState();
            const selection = [...state.selection];

            if (mod && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (event.shiftKey) state.redo();
                else state.undo();
                return;
            }
            if (mod && event.key.toLowerCase() === "y") {
                event.preventDefault();
                state.redo();
                return;
            }
            if (mod && event.key.toLowerCase() === "a" && !typing) {
                event.preventDefault();
                state.select(state.doc.nodes.filter((node) => node.type !== "group").map((node) => node.id));
                return;
            }
            if (mod && event.key.toLowerCase() === "c" && !typing && selection.length) {
                event.preventDefault();
                const nodes = state.doc.nodes.filter((node) => selection.includes(node.id));
                const edges = state.doc.edges.filter((edge) => selection.includes(edge.from) && selection.includes(edge.to));
                copiedNodes.current = { nodes, edges };
                void navigator.clipboard?.writeText(JSON.stringify(copiedNodes.current)).catch(() => {});
                return;
            }
            if (mod && event.key.toLowerCase() === "v" && !typing) {
                event.preventDefault();
                void (async () => {
                    let payload: { nodes?: CanvasNode[]; edges?: Edge[] } | null = copiedNodes.current;
                    try {
                        if (navigator.clipboard) {
                            const text = await navigator.clipboard.readText();
                            payload = JSON.parse(text);
                        }
                    } catch {
                        // The in-canvas copy is still available when the browser denies access.
                    }
                    const nodes = payload?.nodes;
                    if (!Array.isArray(nodes) || !nodes.length) return;
                    const edges = Array.isArray(payload?.edges) ? payload.edges : [];
                    const current = useCanvasStore.getState();
                    current.commit((prev) => pasteNodes(prev, nodes, 48, edges));
                    current.select(useCanvasStore.getState().doc.nodes.slice(-nodes.length).map((node) => node.id));
                })();
                return;
            }
            if (mod && event.key.toLowerCase() === "k" && !typing) {
                event.preventDefault();
                setSearchOpen(true);
                return;
            }
            if (mod && event.key.toLowerCase() === "g") {
                event.preventDefault();
                if (event.shiftKey) {
                    const group = state.doc.nodes.find((node) => selection.includes(node.id) && node.type === "group");
                    if (group) state.commit((prev) => ungroupNodes(prev, group.id));
                } else {
                    state.commit((prev) => groupNodes(prev, selection).doc);
                }
                return;
            }
            if (mod && event.key.toLowerCase() === "d" && selection.length) {
                event.preventDefault();
                state.commit((prev) => duplicateNodes(prev, selection));
                return;
            }
            if ((event.key === "Delete" || event.key === "Backspace") && !typing) {
                if (state.selectedEdgeId) {
                    event.preventDefault();
                    const edgeId = state.selectedEdgeId;
                    state.commit((prev) => disconnect(prev, edgeId));
                } else if (selection.length) {
                    event.preventDefault();
                    state.commit((prev) => removeNodes(prev, selection));
                    state.clearSelection();
                }
                return;
            }
            if (event.key === "Escape") {
                state.clearSelection();
                setMenu(null);
                return;
            }
            if (mod && (event.key === "=" || event.key === "+")) {
                event.preventDefault();
                zoomBy(ZOOM_STEP);
                return;
            }
            if (mod && event.key === "-") {
                event.preventDefault();
                zoomBy(1 / ZOOM_STEP);
                return;
            }
            if (mod && event.key === "0") {
                event.preventDefault();
                fitToContent();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    });

    // ---------------------------------------------------------------------
    // Context menu actions
    // ---------------------------------------------------------------------
    const addNodeAt = (type: "text" | "image" | "video" | "group", position: Vec, connection?: ConnectionDrop) => {
        const node = type === "group" ? createGroupNode(position, 620, 430, t("node.group.label"))
            : type === "text" ? createTextNode(position) : createMediaNode(type, position);
        if (connection) {
            if (!getNode(useCanvasStore.getState().doc, connection.draft.sourceId) || type === "group") {
                setMenu(null);
                return;
            }
            const side = connection.targetPort;
            node.position = {
                x: position.x - (side === "right" ? node.width : side === "left" ? 0 : node.width / 2),
                y: position.y - (side === "bottom" ? node.height : side === "top" ? 0 : node.height / 2),
            };
        }
        store.commit((prev) => {
            const added = addNode(prev, node);
            return connection
                ? connect(added, connection.draft.sourceId, node.id, connection.draft.sourcePort, connection.targetPort)
                : added;
        });
        store.select([node.id]);
        setMenu(null);
    };

    const onDoubleClick = (event: React.MouseEvent) => {
        const target = event.target as Element | null;
        if (target?.closest("[data-canvas-no-pan]")) return;
        const world = toWorld(event);
        setMenu({ x: event.clientX, y: event.clientY, nodeId: undefined });
        setPatchPosition(world);
    };

    const [patchPosition, setPatchPosition] = useState<Vec>({ x: 0, y: 0 });

    const viewport = doc.viewport;
    const selectionBox = gesture?.type === "marquee" ? normalizeRect(gesture.start, gesture.current) : null;
    const marqueeSelection = useMemo(() => {
        if (!selectionBox || gesture?.type !== "marquee") return null;
        return new Set([
            ...(gesture.additive ? store.selection : []),
            ...marqueeHits(doc.nodes, selectionBox),
        ]);
    }, [doc.nodes, gesture, selectionBox, store.selection]);


    // Only nodes inside the visible world area (plus margin) are mounted.
    // Selected nodes are always kept so an off-screen selection still receives
    // keyboard actions and never silently disappears mid-gesture.
    const visibleRect = useMemo(() => visibleWorldRect(viewport, size, 600), [viewport, size]);
    // The prompt panel follows the single selected generation node.
    const [referenceEdgeId, setReferenceEdgeId] = useState<string | null>(null);
    const [promptFocusRequest, setPromptFocusRequest] = useState<string | null>(null);
    const focusNodePrompt = (id: string) => {
        store.select([id]);
        setPromptFocusRequest(id);
    };
    const panelNode = useMemo(() => {
        if (store.selection.size !== 1) return null;
        const [id] = [...store.selection];
        const node = doc.nodes.find((item) => item.id === id);
        if (!node || isContentNode(node) || (node.type !== "image" && node.type !== "video" && node.type !== "text")) return null;
        return node;
    }, [store.selection, doc.nodes]);

    const nodeStack = useMemo(() => {
        const band = doc.nodes.length * 2 + 2;
        return new Map(doc.nodes.map((node, index) => {
            if (node.type === "group") return [node.id, 0];
            const selected = marqueeSelection?.has(node.id) ?? store.selection.has(node.id);
            const level = selected || store.editingNodeId === node.id ? 2 : store.hoveredNodeId === node.id ? 1 : 0;
            return [node.id, 2 + index * 2 + level * band];
        }));
    }, [doc.nodes, marqueeSelection, store.selection, store.editingNodeId, store.hoveredNodeId]);

    const nodes = useMemo(
        () =>
            doc.nodes.filter(
                (node) =>
                    node.type !== "group" &&
                    (store.selection.has(node.id) || rectsIntersect(nodeRect(node), visibleRect)),
            ),
        [doc.nodes, visibleRect, store.selection],
    );
    const groupDropTargets = useMemo(() => {
        const targets = new Set<string>();
        if (gesture?.type !== "drag" || !gesture.moved) return targets;
        for (const node of doc.nodes) {
            if (!gesture.origin.has(node.id) || node.type === "group" || (node.groupId && gesture.origin.has(node.groupId))) continue;
            const target = groupContainingNode(doc.nodes, node);
            if (target && target.id !== node.groupId) targets.add(target.id);
        }
        return targets;
    }, [doc.nodes, gesture]);
    const groups = useMemo(
        () => doc.nodes.filter((node) => node.type === "group" && rectsIntersect(nodeRect(node), visibleRect)),
        [doc.nodes, visibleRect],
    );

    return (
        <div className="mf-root" style={themeStyle(mode, theme.tokens)} data-theme={mode}>
            {shell.topBar && <TopBar />}
            <div className="mf-body">
                {shell.rail && <Rail
                    drawer={drawer}
                    onNodes={() => setDrawer((current) => current === "nodes" ? null : "nodes")}
                    onAssets={config.renderAssetLibrary ? () => setDrawer((current) => current === "assets" ? null : "assets") : undefined}
                    onImport={async (text) => {
                        const input = JSON.parse(text);
                        if (!input || !Array.isArray(input.nodes)) throw new Error("Invalid canvas document");
                        const imported = parseDocument(input);
                        store.load(config.restoreImportedAssets ? await config.restoreImportedAssets(imported) : imported);
                    }}
                    onExport={() => downloadDocument(doc)}
                    footer={config.renderRailFooter?.(lang)}
                    onSettings={config.renderSettings ? () => setSettingsOpen(true) : undefined}
                />}
                {shell.rail && drawer && (drawer === "nodes" ? shell.showNodes : shell.showAssets) && (
                    <aside className="mf-side-drawer" aria-label={t(drawer === "nodes" ? "rail.nodes" : "rail.assets")}>
                        <header className="mf-side-drawer-head">
                            <strong>{t(drawer === "nodes" ? "rail.nodes" : "rail.assets")}</strong>
                            <button type="button" className="mf-icon-btn" aria-label={t("panel.close")} onClick={() => setDrawer(null)}>
                                <X size={14} aria-hidden />
                            </button>
                        </header>
                        {drawer === "nodes" ? <NodeSearch inline onClose={() => setDrawer(null)} /> : config.renderAssetLibrary?.(lang)}
                    </aside>
                )}
                <div
                    ref={containerRef}
                    className="mf-canvas"
                    data-tool={store.tool}
                    data-panning={spacePanning || undefined}
                    onWheel={onWheel}
                    onPointerDown={onBackgroundPointerDown}
                    onDoubleClick={onDoubleClick}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        const target = event.target as Element | null;
                        const nodeId = target?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? undefined;
                        setMenu({ x: event.clientX, y: event.clientY, nodeId });
                    }}
                >
                    <GridBackground viewport={viewport} background={doc.background} />
                    <CanvasLayer viewport={viewport}>
                        <div className="mf-canvas-graph">
                            <EdgeLayer referenceEdgeId={referenceEdgeId} nodeStack={nodeStack} />
                            {groups.map((group) => (
                                <NodeView key={group.id} node={group} stackIndex={0} onBeginDrag={beginNodeDrag} groupDropTarget={groupDropTargets.has(group.id)} />
                            ))}
                            {nodes.map((node) => (
                                <NodeView key={node.id} node={node} stackIndex={nodeStack.get(node.id) ?? 2} onBeginDrag={beginNodeDrag}
                                    onFocusPrompt={focusNodePrompt} onEmptyConnectionDrop={(connection) => setMenu({ x: connection.x, y: connection.y, connection })} marqueeSelected={marqueeSelection?.has(node.id)} />
                            ))}
                        </div>
                        <ConnectionLayer pending={menu?.connection?.draft} />
                        <AlignmentGuides />
                        {!marqueeSelection && <SelectionToolbar />}
                        {panelNode && <NodePromptPanel key={panelNode.id} node={panelNode} canvasSize={size} focusRequest={promptFocusRequest === panelNode.id} onPromptFocused={setPromptFocusRequest} moving={gesture?.type === "drag" || gesture?.type === "marquee"} onReferenceEdgeChange={setReferenceEdgeId} />}
                        {selectionBox && (
                            <div
                                className="mf-marquee"
                                style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }}
                            />
                        )}
                    </CanvasLayer>

                    {!doc.nodes.length && (
                        <div className="mf-empty">
                            <div className="mf-empty-title">{t("empty.title")}</div>
                        </div>
                    )}

                    {shell.minimap && showMap && <Minimap />}
                    {shell.zoomControls && (
                        <ZoomControls
                            k={viewport.k}
                            showZoom={showZoom}
                            showMap={showMap}
                            onToggleZoom={() => setShowZoom((value) => !value)}
                            onToggleMap={shell.minimap ? () => setShowMap((value) => !value) : undefined}
                            onZoomIn={() => zoomBy(ZOOM_STEP)}
                            onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
                            onFit={fitToContent}
                            onReset={() => store.setViewport({ x: 0, y: 0, k: 1 })}
                        />
                    )}
                </div>
            </div>

            {notifications}
            {shell.rail && shell.showSettings && settingsOpen && <WorkspaceSettings onClose={() => setSettingsOpen(false)} />}
            {searchOpen && <NodeSearch onClose={() => setSearchOpen(false)} />}
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    nodeId={menu.nodeId}
                    connectionOnly={Boolean(menu.connection)}
                    onAdd={(type) => addNodeAt(type, menu.connection?.draft.point ?? (menu.nodeId ? addOffsetFor(menu.nodeId) : patchPosition), menu.connection)}
                    onClose={() => setMenu(null)}
                />
            )}
        </div>
    );

    function addOffsetFor(nodeId: string): Vec {
        const anchor = getNode(doc, nodeId);
        return anchor ? { x: anchor.position.x + anchor.width + 80, y: anchor.position.y } : patchPosition;
    }
}

function GridBackground({ viewport, background }: { viewport: { x: number; y: number; k: number }; background: string }) {
    if (background === "blank") return null;
    const step = clamp(48 * viewport.k, 12, 200);
    const x = viewport.x % step;
    const y = viewport.y % step;
    if (background === "lines") {
        return (
            <div
                className="mf-grid"
                style={{
                    backgroundImage: "linear-gradient(var(--mf-gridLine) 1px, transparent 1px), linear-gradient(90deg, var(--mf-gridLine) 1px, transparent 1px)",
                    backgroundSize: `${step}px ${step}px`,
                    backgroundPosition: `${x}px ${y}px`,
                }}
            />
        );
    }
    const dot = viewport.k < 0.3 ? 1 : 1.6;
    return (
        <div
            className="mf-grid"
            style={{
                backgroundImage: `radial-gradient(circle, var(--mf-gridDot) ${dot}px, transparent ${dot + 0.4}px)`,
                backgroundSize: `${step}px ${step}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
