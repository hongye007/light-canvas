import { removeReferenceMentions } from "./mentions";
import { createId } from "./id";
import { boundsOf, BUILTIN_NODE_SIZES, NODE_HEADER_HEIGHT, NODE_MIN_HEIGHT, NODE_MIN_WIDTH, sizeForRatio } from "./geometry";
import type { Asset, CanvasDocument, CanvasNode, Edge, MediaNodeData, NodeData, TextNodeData, Viewport } from "../types";

export function createEmptyDocument(title = "Untitled canvas"): CanvasDocument {
    return {
        version: 1,
        id: createId("doc"),
        title,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, k: 1 },
        background: "dots",
        meta: {},
    };
}

export function createTextNode(position: { x: number; y: number }, text = "", role: TextNodeData["role"] = "note"): CanvasNode {
    return {
        id: createId("node"),
        type: "text",
        title: role === "prompt" ? "" : "",
        position,
        ...BUILTIN_NODE_SIZES.text,
        data: { type: "text", text, role },
    };
}

export function createMediaNode(kind: "image" | "video", position: { x: number; y: number }, ratio?: string): CanvasNode {
    const initial = BUILTIN_NODE_SIZES[kind];
    const requested = ratio ? sizeForRatio(ratio, initial.width) : initial;
    const size = { width: Math.max(requested.width, initial.width), height: Math.max(requested.height, initial.height) };
    const data: MediaNodeData = { type: kind, assets: [], prompt: "", status: "idle" };
    return { id: createId("node"), type: kind, title: "", position, width: size.width, height: size.height, data };
}

export function createGroupNode(position: { x: number; y: number }, width: number, height: number, label = "Group"): CanvasNode {
    return {
        id: createId("node"),
        type: "group",
        title: label,
        position,
        width,
        height,
        data: { type: "group", label, collapsed: false },
    };
}

export function emptyDocument(): CanvasDocument {
    return createEmptyDocument();
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

export function getNode(doc: CanvasDocument, id: string) {
    return doc.nodes.find((node) => node.id === id);
}

/** Uploaded and handwritten nodes supply content without a generation panel. */
export function isContentNode(node: CanvasNode): boolean {
    const data = node.data;
    if (data.type === "text") return data.contentOnly ?? (data.role === "note" && Boolean(data.text.trim()) && !data.prompt?.trim());
    if (data.type === "image" || data.type === "video") {
        const asset = activeMediaAsset(data);
        return data.contentOnly ?? Boolean(asset?.url.startsWith("blob:"));
    }
    return false;
}

export function updateNode(doc: CanvasDocument, id: string, patch: Partial<CanvasNode>): CanvasDocument {
    return { ...doc, nodes: doc.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) };
}

export function patchNodeData(doc: CanvasDocument, id: string, patch: Partial<NodeData>): CanvasDocument {
    return {
        ...doc,
        nodes: doc.nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } as NodeData } : node)),
    };
}

export function moveNode(doc: CanvasDocument, id: string, position: { x: number; y: number }): CanvasDocument {
    return updateNode(doc, id, { position });
}

export function addNode(doc: CanvasDocument, node: CanvasNode, atIndex?: number): CanvasDocument {
    const nodes = [...doc.nodes];
    nodes.splice(atIndex ?? nodes.length, 0, node);
    return { ...doc, nodes };
}

function removeEdges(doc: CanvasDocument, shouldRemove: (edge: Edge) => boolean): CanvasDocument {
    const removed = new Map<string, Set<string>>();
    const edges = doc.edges.filter((edge) => {
        if (!shouldRemove(edge)) return true;
        const sources = removed.get(edge.to) ?? new Set<string>();
        sources.add(encodeURIComponent(edge.from));
        removed.set(edge.to, sources);
        return false;
    });
    if (!removed.size) return doc;
    for (const edge of edges) removed.get(edge.to)?.delete(encodeURIComponent(edge.from));
    const nodes = doc.nodes.map((node) => {
        const sources = removed.get(node.id);
        const data = node.data;
        if (!sources?.size || !("prompt" in data) || typeof data.prompt !== "string") return node;
        const prompt = removeReferenceMentions(data.prompt, (id) => sources.has(id));
        return prompt === data.prompt ? node : { ...node, data: { ...data, prompt } };
    });
    return { ...doc, edges, nodes };
}

export function removeNodes(doc: CanvasDocument, ids: string[]): CanvasDocument {
    const removing = new Set(ids);
    const next = removeEdges(doc, (edge) => removing.has(edge.from) || removing.has(edge.to));
    return { ...next, nodes: next.nodes.filter((node) => !removing.has(node.id)) };
}

export function duplicateNodes(doc: CanvasDocument, ids: string[], offset = 32): CanvasDocument {
    const set = new Set(ids);
    const source = doc.nodes.filter((node) => set.has(node.id));
    if (!source.length) return doc;
    const idMap = new Map<string, string>();
    const copies = source.map((node) => {
        const id = createId("node");
        idMap.set(node.id, id);
        const groupId = node.groupId && set.has(node.groupId) ? idMap.get(node.groupId) : node.groupId;
        return { ...structuredCloneNode(node), id, position: { x: node.position.x + offset, y: node.position.y + offset }, groupId };
    });
    const edges = doc.edges
        .filter((edge) => set.has(edge.from) && set.has(edge.to))
        .map((edge) => ({ id: createId("edge"), from: idMap.get(edge.from)!, to: idMap.get(edge.to)! }));
    return { ...doc, nodes: [...doc.nodes, ...copies], edges: [...doc.edges, ...edges] };
}

function structuredCloneNode(node: CanvasNode): CanvasNode {
    return { ...node, position: { ...node.position }, data: JSON.parse(JSON.stringify(node.data)) as NodeData };
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** True when adding from -> to would create a cycle (to already reaches from). */
export function wouldCreateCycle(doc: CanvasDocument, from: string, to: string): boolean {
    if (from === to) return true;
    const seen = new Set<string>();
    const stack = [to];
    while (stack.length) {
        const current = stack.pop()!;
        if (current === from) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const edge of doc.edges) if (edge.from === current) stack.push(edge.to);
    }
    return false;
}

export const MEDIA_REFERENCE_LIMIT = 5;

export function remainingReferenceSlots(doc: CanvasDocument, target: CanvasNode) {
    if (target.type !== "image" && target.type !== "video") return Infinity;
    return Math.max(0, MEDIA_REFERENCE_LIMIT - doc.edges.filter((edge) => edge.to === target.id).length);
}

export function connect(
    doc: CanvasDocument,
    from: string,
    to: string,
    fromPort: Edge["fromPort"] = "right",
    toPort: Edge["toPort"] = "left",
): CanvasDocument {
    if (from === to) return doc;
    if (doc.edges.some((edge) => edge.from === from && edge.to === to)) return doc;
    if (wouldCreateCycle(doc, from, to)) return doc;
    const target = getNode(doc, to);
    const origin = getNode(doc, from);
    if (!target || !origin || target.type === "group" || origin.type === "group" || remainingReferenceSlots(doc, target) === 0) return doc;
    const edge: Edge = { id: createId("edge"), from, to, fromPort, toPort };
    return { ...doc, edges: [...doc.edges, edge] };
}

export function disconnect(doc: CanvasDocument, edgeId: string): CanvasDocument {
    return removeEdges(doc, (edge) => edge.id === edgeId);
}

/**
 * Inserting a node on an edge: A -> B becomes A -> C -> B.
 * Used by the "add node here" affordance on connections.
 */
export function insertNodeOnEdge(doc: CanvasDocument, edgeId: string, node: CanvasNode): CanvasDocument {
    const edge = doc.edges.find((item) => item.id === edgeId);
    if (!edge) return addNode(doc, node);
    const next = disconnect(doc, edgeId);
    const edges = [...next.edges];
    edges.push({ id: createId("edge"), from: edge.from, to: node.id });
    edges.push({ id: createId("edge"), from: node.id, to: edge.to });
    return { ...next, nodes: [...next.nodes, node], edges };
}

/** Upstream nodes of a node, breadth-first, ordered nearest first. */
export function upstreamNodes(doc: CanvasDocument, nodeId: string): CanvasNode[] {
    const result: CanvasNode[] = [];
    const seen = new Set<string>([nodeId]);
    let frontier = doc.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
    while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier) {
            if (seen.has(id)) continue;
            seen.add(id);
            const node = getNode(doc, id);
            if (node) result.push(node);
            for (const edge of doc.edges) if (edge.to === id) next.push(edge.from);
        }
        frontier = next;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export function groupNodes(doc: CanvasDocument, ids: string[]): { doc: CanvasDocument; groupId: string | null } {
    const members = doc.nodes.filter((node) => ids.includes(node.id) && node.type !== "group");
    if (members.length < 2) return { doc, groupId: null };
    const bounds = boundsOf(members)!;
    const pad = 32;
    const topPad = 64;
    const group = createGroupNode({ x: bounds.x - pad, y: bounds.y - topPad }, bounds.width + pad * 2, bounds.height + topPad + pad);
    const groupId = group.id;
    const nodes = doc.nodes.map((node) => (members.some((member) => member.id === node.id) ? { ...node, groupId } : node));
    return { doc: { ...doc, nodes: [...nodes, group] }, groupId };
}

export function arrangeGroup(doc: CanvasDocument, groupId: string, layout: "grid" | "horizontal" | "vertical"): CanvasDocument {
    const group = getNode(doc, groupId);
    const members = doc.nodes.filter((node) => node.groupId === groupId);
    if (!group || !members.length) return doc;
    const columns = layout === "horizontal" ? members.length : layout === "vertical" ? 1 : Math.ceil(Math.sqrt(members.length));
    const gap = 24;
    const columnWidths = Array.from({ length: columns }, (_, col) =>
        Math.max(...members.filter((_, index) => index % columns === col).map((node) => node.width)));
    const positions = new Map<string, CanvasNode["position"]>();
    let y = group.position.y + 62;
    for (let start = 0; start < members.length; start += columns) {
        const row = members.slice(start, start + columns);
        let x = group.position.x + gap;
        row.forEach((node, col) => {
            positions.set(node.id, { x, y });
            x += columnWidths[col] + gap;
        });
        y += Math.max(...row.map((node) => node.height)) + gap;
    }
    const width = Math.max(520, columnWidths.reduce((sum, value) => sum + value + gap, gap));
    const height = Math.max(360, y - group.position.y);
    return {
        ...doc,
        nodes: doc.nodes.map((node) => {
            const position = positions.get(node.id);
            if (position) return { ...node, position };
            return node.id === groupId ? { ...node, width, height } : node;
        }),
    };
}

export function ungroupNodes(doc: CanvasDocument, groupId: string): CanvasDocument {
    return {
        ...doc,
        nodes: doc.nodes.filter((node) => node.id !== groupId).map((node) => (node.groupId === groupId ? { ...node, groupId: undefined } : node)),
    };
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

export function archiveGeneration(node: CanvasNode, data: MediaNodeData) {
    const history = data.generationHistory ?? [];
    return data.assets.length && !isContentNode(node)
        ? [{ id: createId("batch"), createdAt: data.generatedAt, assets: data.assets }, ...history]
        : history;
}

export function activeMediaAsset(data: MediaNodeData): Asset | undefined {
    return data.assets.find((asset) => asset.id === data.activeAssetId)
        ?? data.generationHistory?.flatMap((batch) => batch.assets).find((asset) => asset.id === data.activeAssetId)
        ?? data.assets[0];
}

export function setNodeMedia(doc: CanvasDocument, nodeId: string, patch: Partial<MediaNodeData> & { assets?: Asset[] }): CanvasDocument {
    return {
        ...doc,
        nodes: doc.nodes.map((node) => {
            if (node.id !== nodeId) return node;
            if (node.data.type !== "image" && node.data.type !== "video") return node;
            const next: MediaNodeData = { ...node.data, ...patch };
            if (patch.assets?.length && !patch.activeAssetId) next.activeAssetId = patch.assets[0].id;
            return { ...node, data: next };
        }),
    };
}

export function resizeNodeToAsset(doc: CanvasDocument, nodeId: string, asset: Asset): CanvasDocument {
    if (!asset.width || !asset.height) return doc;
    const node = getNode(doc, nodeId);
    if (!node) return doc;
    const currentArea = Math.max(300 * 210, node.width * Math.max(1, node.height - NODE_HEADER_HEIGHT));
    const minWidth = node.type === "video" ? 240 : 200;
    const minHeight = node.type === "video" ? 160 : 200;
    const minScale = Math.max((minWidth - 2) / asset.width, (minHeight - NODE_HEADER_HEIGHT - 2) / asset.height);
    const scale = Math.min(Math.max(minScale, Math.sqrt(currentArea / (asset.width * asset.height))), 500 / Math.max(asset.width, asset.height));
    return updateNode(doc, nodeId, {
        width: Math.max(minWidth, Math.round(asset.width * scale) + 2),
        height: Math.max(minHeight, Math.round(asset.height * scale) + NODE_HEADER_HEIGHT + 2),
    });
}

export function setViewport(doc: CanvasDocument, viewport: Viewport): CanvasDocument {
    return { ...doc, viewport };
}

export function nodeMinSize() {
    return { minWidth: NODE_MIN_WIDTH, minHeight: NODE_MIN_HEIGHT };
}

/**
 * Paste nodes copied from this canvas (or another one).
 * Fresh ids are assigned and the internal edges are rebuilt so a copied
 * sub-graph keeps its wiring; edges pointing outside the copied set are dropped.
 */
export function pasteNodes(doc: CanvasDocument, incoming: CanvasNode[], offset = 48, incomingEdges: Edge[] = []): CanvasDocument {
    if (!incoming.length) return doc;
    const idMap = new Map(incoming.map((node) => [node.id, createId("node")]));
    const nodes = incoming.map((node) => {
        const id = idMap.get(node.id)!;
        return {
            ...node,
            id,
            position: { x: node.position.x + offset, y: node.position.y + offset },
            groupId: node.groupId && idMap.has(node.groupId) ? idMap.get(node.groupId) : undefined,
            data: JSON.parse(JSON.stringify(node.data)) as NodeData,
        };
    });
    const edges = incomingEdges.flatMap((edge) => {
        const from = idMap.get(edge.from);
        const to = idMap.get(edge.to);
        return from && to ? [{ ...edge, id: createId("edge"), from, to }] : [];
    });
    return { ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] };
}
