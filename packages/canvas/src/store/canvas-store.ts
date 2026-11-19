import { create } from "zustand";
import { History } from "../lib/history";
import { BUILTIN_NODE_SIZES } from "../lib/geometry";
import { createEmptyDocument } from "../lib/document";
import type { CanvasDocument, CanvasTool, GenerationParams, Viewport } from "../types";

export type RuntimeEntry = {
    status: "queued" | "running" | "success" | "error";
    progress: number;
    error?: string;
    startedAt: number;
    retry?: { model: string; params: GenerationParams; mode?: "generate" | "edit" };
};

export type CanvasState = {
    doc: CanvasDocument;
    canUndo: boolean;
    canRedo: boolean;

    selection: Set<string>;
    selectedEdgeId: string | null;
    tool: CanvasTool;
    editingNodeId: string | null;
    hoveredNodeId: string | null;

    /** Transient generation state: outside the document, never undone, never persisted. */
    runtime: Record<string, RuntimeEntry>;

    load: (doc: CanvasDocument) => void;
    /** One discrete change, recorded as one undo entry. */
    commit: (transform: (doc: CanvasDocument) => CanvasDocument) => void;
    /** Start a continuous gesture (drag, resize): no history entry yet. */
    beginGesture: () => void;
    /** Live gesture frame. */
    preview: (transform: (doc: CanvasDocument) => CanvasDocument) => void;
    /** Finish a gesture: records exactly one undo entry for the whole gesture. */
    endGesture: () => void;
    setViewport: (viewport: Viewport) => void;
    undo: () => void;
    redo: () => void;

    select: (ids: string[], additive?: boolean) => void;
    clearSelection: () => void;
    selectEdge: (id: string | null) => void;
    setTool: (tool: CanvasTool) => void;
    setEditing: (id: string | null) => void;
    setHovered: (id: string | null) => void;
    setRuntime: (nodeId: string, entry: RuntimeEntry | null) => void;
};

const history = new History(createEmptyDocument());

const flags = () => ({ canUndo: history.canUndo, canRedo: history.canRedo });
const live = () => history.current;

export const useCanvasStore = create<CanvasState>((set) => ({
    doc: history.current,
    canUndo: false,
    canRedo: false,
    selection: new Set(),
    selectedEdgeId: null,
    tool: "select",
    editingNodeId: null,
    hoveredNodeId: null,
    runtime: {},

    load: (input) => {
        const nodes = input.nodes.map((node) => {
            const type = node.data.type;
            if (node.type !== type || !(type === "text" || ((type === "image" || type === "video") && !node.data.assets.length))) return node;
            const initial = BUILTIN_NODE_SIZES[type];
            const legacyEmptySize = type === "image" ? node.width === 360 && node.height === 480
                : type === "video" && node.width === 420 && (node.height === 236 || node.height === 266);
            if (legacyEmptySize) return { ...node, ...initial };
            const width = Math.max(node.width, initial.width);
            const height = Math.max(node.height, initial.height);
            return width === node.width && height === node.height ? node : { ...node, width, height };
        });
        const doc = nodes.some((node, index) => node !== input.nodes[index]) ? { ...input, nodes } : input;
        history.reset(doc);
        set({ doc, selection: new Set(), selectedEdgeId: null, editingNodeId: null, runtime: {}, ...flags() });
    },

    commit: (transform) => {
        const next = transform(history.current);
        if (next === history.current) return;
        history.commit(next);
        set({ doc: next, ...flags() });
    },

    beginGesture: () => history.beginGesture(),

    preview: (transform) => {
        const next = transform(history.current);
        if (next === history.current) return;
        history.updateGesture(next);
        set({ doc: next });
    },

    endGesture: () => {
        const next = history.endGesture();
        set({ doc: next, ...flags() });
    },

    setViewport: (viewport) => {
        const next = { ...history.current, viewport };
        history.replace(next);
        set({ doc: next });
    },

    undo: () => set({ doc: history.undo() ?? history.current, selection: new Set(), selectedEdgeId: null, ...flags() }),
    redo: () => set({ doc: history.redo() ?? history.current, selection: new Set(), selectedEdgeId: null, ...flags() }),

    select: (ids, additive = false) => set((state) => ({ selection: additive ? new Set([...state.selection, ...ids]) : new Set(ids), selectedEdgeId: null })),
    clearSelection: () => set({ selection: new Set(), selectedEdgeId: null, editingNodeId: null }),
    selectEdge: (id) => set({ selectedEdgeId: id, selection: new Set() }),
    setTool: (tool) => set({ tool }),
    setEditing: (id) => set({ editingNodeId: id }),
    setHovered: (id) => set({ hoveredNodeId: id }),

    setRuntime: (nodeId, entry) =>
        set((state) => {
            const runtime = { ...state.runtime };
            if (entry) runtime[nodeId] = entry;
            else delete runtime[nodeId];
            return { runtime };
        }),
}));

/** Subscribe to the live document without React (used by producers and host callbacks). */
export function getLiveDocument() {
    return live();
}
