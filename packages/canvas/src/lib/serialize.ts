import type { CanvasDocument, CanvasNode, Edge, NodeData, PortSide } from "../types";
import { createEmptyDocument } from "./document";

export const CURRENT_VERSION = 1;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function numberOr(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string) {
    return typeof value === "string" ? value : fallback;
}

/** Structural validation: anything malformed is dropped rather than crashing the canvas. */
export function parseDocument(input: unknown): CanvasDocument {
    if (!isRecord(input)) return createEmptyDocument();
    const fallback = createEmptyDocument(stringOr(input.title, "Untitled canvas"));
    const nodes: CanvasNode[] = [];
    const seenNodeIds = new Set<string>();

    if (Array.isArray(input.nodes)) {
        for (const raw of input.nodes) {
            const node = parseNode(raw);
            if (!node || seenNodeIds.has(node.id)) continue;
            seenNodeIds.add(node.id);
            nodes.push(node);
        }
    }

    const edges: Edge[] = [];
    const seenEdgeIds = new Set<string>();
    if (Array.isArray(input.edges)) {
        for (const raw of input.edges) {
            if (!isRecord(raw)) continue;
            const from = stringOr(raw.from, "");
            const to = stringOr(raw.to, "");
            if (!seenNodeIds.has(from) || !seenNodeIds.has(to)) continue;
            const id = stringOr(raw.id, `edge_${from}_${to}`);
            if (seenEdgeIds.has(id)) continue;
            seenEdgeIds.add(id);
            edges.push({ id, from, to, fromPort: parsePort(raw.fromPort), toPort: parsePort(raw.toPort) });
        }
    }

    const viewportRaw = isRecord(input.viewport) ? input.viewport : {};
    const k = numberOr(viewportRaw.k, 1);

    return {
        version: CURRENT_VERSION,
        id: stringOr(input.id, fallback.id),
        title: stringOr(input.title, fallback.title),
        nodes,
        edges,
        viewport: { x: numberOr(viewportRaw.x, 0), y: numberOr(viewportRaw.y, 0), k: k > 0 ? k : 1 },
        background: input.background === "lines" || input.background === "blank" ? input.background : "dots",
        meta: isRecord(input.meta) ? input.meta : {},
    };
}

function parsePort(value: unknown): PortSide | undefined {
    return value === "left" || value === "right" || value === "top" || value === "bottom" ? value : undefined;
}

function parseNode(raw: unknown): CanvasNode | null {
    if (!isRecord(raw)) return null;
    const id = stringOr(raw.id, "");
    const type = stringOr(raw.type, "");
    if (!id || !type) return null;
    const position = isRecord(raw.position) ? raw.position : {};
    return {
        id,
        type,
        title: stringOr(raw.title, ""),
        position: { x: numberOr(position.x, 0), y: numberOr(position.y, 0) },
        width: Math.max(60, numberOr(raw.width, 320)),
        height: Math.max(40, numberOr(raw.height, 220)),
        data: parseNodeData(type, raw.data),
        aspectLocked: raw.aspectLocked === true || undefined,
        groupId: typeof raw.groupId === "string" ? raw.groupId : undefined,
    };
}

function parseNodeData(type: string, raw: unknown): NodeData {
    const data = isRecord(raw) ? raw : {};
    if (type === "text") {
        return {
            type: "text",
            contentOnly: typeof data.contentOnly === "boolean" ? data.contentOnly : undefined,
            text: stringOr(data.text, ""),
            prompt: typeof data.prompt === "string" ? data.prompt : undefined,
            role: data.role === "prompt" ? "prompt" : "note",
        };
    }
    if (type === "group") {
        return { type: "group", label: stringOr(data.label, "Group"), collapsed: data.collapsed === true,
            color: typeof data.color === "string" && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : undefined };
    }
    if (type === "image" || type === "video") {
        const parseAssets = (value: unknown) => Array.isArray(value)
            ? value
                  .filter(isRecord)
                  .map((asset) => ({
                      id: stringOr(asset.id, `asset_${Math.random().toString(36).slice(2, 8)}`),
                      kind: type as "image" | "video",
                      url: stringOr(asset.url, ""),
                      remoteUrl: typeof asset.remoteUrl === "string" ? asset.remoteUrl : undefined,
                      localAssetId: typeof asset.localAssetId === "string" ? asset.localAssetId : undefined,
                      width: typeof asset.width === "number" ? asset.width : undefined,
                      height: typeof asset.height === "number" ? asset.height : undefined,
                      posterUrl: typeof asset.posterUrl === "string" ? asset.posterUrl : undefined,
                      durationSec: typeof asset.durationSec === "number" ? asset.durationSec : undefined,
                  }))
                  .filter((asset) => asset.url)
            : [];
        const assets = parseAssets(data.assets);
        const generationHistory = Array.isArray(data.generationHistory) ? data.generationHistory.filter(isRecord).flatMap((batch) => {
            const assets = parseAssets(batch.assets);
            return typeof batch.id === "string" && assets.length ? [{
                id: batch.id,
                createdAt: typeof batch.createdAt === "number" && Number.isFinite(batch.createdAt) ? batch.createdAt : undefined,
                assets,
            }] : [];
        }) : undefined;
        const ratio = data.generationRatio;
        const status = data.status;
        return {
            type,
            contentOnly: typeof data.contentOnly === "boolean" ? data.contentOnly : undefined,
            assets,
            generationHistory,
            generationRatio: ratio === "1:1" || ratio === "3:4" || ratio === "4:3" || ratio === "9:16" || ratio === "16:9" ? ratio : undefined,
            generatedAt: typeof data.generatedAt === "number" ? data.generatedAt : undefined,
            activeAssetId: typeof data.activeAssetId === "string" ? data.activeAssetId : assets[0]?.id,
            prompt: stringOr(data.prompt, ""),
            status: status === "running" || status === "queued" ? "idle" : status === "success" || status === "error" ? status : "idle",
            error: typeof data.error === "string" ? data.error : undefined,
        };
    }
    // Unknown plugin node: keep whatever was stored so nothing is lost.
    return { ...data, type: "plugin" };
}

export function serializeDocument(doc: CanvasDocument): string {
    return JSON.stringify(doc, null, 2);
}

export function deserializeDocument(json: string): CanvasDocument {
    return parseDocument(JSON.parse(json) as unknown);
}

export function downloadDocument(doc: CanvasDocument) {
    const blob = new Blob([serializeDocument(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${doc.title || "canvas"}.maxflow.json`;
    link.click();
    URL.revokeObjectURL(url);
}
