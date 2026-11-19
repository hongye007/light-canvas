import { useEffect, useRef } from "react";
import { useCanvasStore } from "../store/canvas-store";
import { activeMediaAsset, archiveGeneration, getNode, MEDIA_REFERENCE_LIMIT, patchNodeData, resizeNodeToAsset, setNodeMedia } from "../lib/document";
import { readMediaMetadata } from "./media-metadata";
import { resolveReferenceMentions } from "../lib/mentions";
import { createId } from "../lib/id";
import type { Asset, CanvasProducer, GenerationRequest, GenerationParams } from "../types";

/** Task status for a single node, kept outside the document so it is never undone or persisted. */
export function useNodeRuntime(nodeId: string) {
    return useCanvasStore((state) => state.runtime[nodeId]);
}

/** Aborts in-flight generation when the node unmounts. */
export function useAbortOnUnmount(signalRef: { current: AbortController | null }) {
    useEffect(() => () => signalRef.current?.abort(), [signalRef]);
}

/** Gathers only directly connected references in connection order. */
export function collectReferences(doc: ReturnType<typeof useCanvasStore.getState>["doc"], nodeId: string) {
    const sources = new Set(doc.edges.filter((edge) => edge.to === nodeId && edge.from !== nodeId).map((edge) => edge.from));
    const refs = Array.from(sources, (id) => getNode(doc, id))
        .map((node) => {
            if (!node) return null;
            if (node.data.type === "text") {
                return node.data.text ? { nodeId: node.id, kind: "text" as const, text: node.data.text } : null;
            }
            if (node.data.type === "image" || node.data.type === "video") {
                const data = node.data;
                const asset: Asset | undefined = activeMediaAsset(data);
                if (!asset) return null;
                return { nodeId: node.id, kind: data.type, assetId: asset.id, url: asset.url, remoteUrl: asset.remoteUrl };
            }
            return null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    const target = getNode(doc, nodeId);
    return target?.type === "image" || target?.type === "video" ? refs.slice(0, MEDIA_REFERENCE_LIMIT) : refs;
}

/** In-flight generations, so the composer can cancel the one it started. */
const inFlight = new Map<string, AbortController>();

export function cancelGeneration(nodeId: string, discard = false) {
    const controller = inFlight.get(nodeId);
    if (discard) {
        inFlight.delete(nodeId);
        useCanvasStore.getState().setRuntime(nodeId, null);
    }
    controller?.abort();
}

export function isGenerating(nodeId: string) {
    return inFlight.has(nodeId);
}

export type RunOptions = {
    nodeId: string;
    producer: CanvasProducer;
    model: string;
    prompt?: string;
    params: GenerationParams;
    mode?: "generate" | "edit";
};

/**
 * Runs one generation for one node: progress goes to the transient runtime store,
 * the result is committed to the document as a single undo entry.
 */
export async function generateForNode(options: RunOptions): Promise<boolean> {
    const store = useCanvasStore.getState();
    const node = getNode(store.doc, options.nodeId);
    if (!node || node.data.type === "group" || node.data.type === "plugin") return false;

    const connected = collectReferences(store.doc, options.nodeId);
    const keyframe = node.data.type === "video" && options.params.videoReferenceMode === "keyframe";
    const references = keyframe ? connected.filter((ref) => ref.kind !== "video") : connected;
    const prompt = options.prompt ?? node.data.prompt ?? "";
    const isText = node.data.type === "text";
    const isVideo = node.data.type === "video";
    const kind: GenerationRequest["kind"] = isText ? "generate-text" : isVideo
        ? options.mode === "edit"
            ? "video-edit"
            : "text-to-video"
        : references.some((ref) => ref.kind === "image") || options.mode === "edit"
          ? "image-edit"
          : "text-to-image";

    inFlight.get(options.nodeId)?.abort();
    const controller = new AbortController();
    inFlight.set(options.nodeId, controller);
    store.setRuntime(options.nodeId, { status: "running", progress: 0, startedAt: Date.now() });
    const isCurrent = () => inFlight.get(options.nodeId) === controller &&
        useCanvasStore.getState().doc.id === store.doc.id &&
        Boolean(getNode(useCanvasStore.getState().doc, options.nodeId));
    if (!isText) store.commit((prev) => setNodeMedia(prev, options.nodeId, { status: "running", error: undefined, progress: 0, prompt }));

    try {
        const request: GenerationRequest = {
            kind,
            model: options.model,
            prompt: resolveReferenceMentions(prompt, references),
            references,
            params: options.params,
            signal: controller.signal,
            onProgress: (progress) => {
                if (isCurrent() && !controller.signal.aborted) {
                    store.setRuntime(options.nodeId, { status: "running", progress, startedAt: Date.now() });
                }
            },
        };
        if (isText) {
            if (!options.producer.generateText) throw new Error("Text generation is unavailable");
            const text = (await options.producer.generateText(request)).trim();
            controller.signal.throwIfAborted();
            if (!isCurrent()) return false;
            if (!text) throw new Error("Provider returned no text");
            store.commit((prev) => patchNodeData(prev, options.nodeId, { text, contentOnly: false }));
            store.setRuntime(options.nodeId, null);
            return true;
        }
        const result = await options.producer.generate(request);
        controller.signal.throwIfAborted();
        if (!isCurrent()) return false;
        const assets = result.assets.map((asset) => ({ ...asset, id: asset.id || createId("asset") }));
        if (assets[0]?.kind === "video" && (!assets[0].width || !assets[0].height)) {
            assets[0] = await readMediaMetadata(assets[0], controller.signal);
        }
        controller.signal.throwIfAborted();
        if (!isCurrent()) return false;
        if (!assets.length) throw new Error("Provider returned no asset");
        const store2 = useCanvasStore.getState();
        const createdAt = Date.now();
        store2.commit((prev) => {
            const target = getNode(prev, options.nodeId);
            if (!target || (target.data.type !== "image" && target.data.type !== "video")) return prev;
            const data = target.data;
            return resizeNodeToAsset(setNodeMedia(prev, options.nodeId, {
                status: "success", assets, activeAssetId: assets[0].id, prompt, progress: 1,
                contentOnly: false, generatedAt: createdAt, generationHistory: archiveGeneration(target, data),
            }), options.nodeId, assets[0]);
        });
        store2.setRuntime(options.nodeId, { status: "success", progress: 1, startedAt: Date.now() });
        const success = useCanvasStore.getState().runtime[options.nodeId];
        window.setTimeout(() => {
            if (useCanvasStore.getState().runtime[options.nodeId] === success) store.setRuntime(options.nodeId, null);
        }, 900);
        return true;
    } catch (error) {
        if (!isCurrent()) return false;
        if (controller.signal.aborted || (error as Error)?.name === "AbortError") {
            useCanvasStore.getState().setRuntime(options.nodeId, null);
            if (!isText) useCanvasStore.getState().commit((prev) => {
                const current = getNode(prev, options.nodeId)?.data;
                if (current?.type !== "image" && current?.type !== "video") return prev;
                return setNodeMedia(prev, options.nodeId, {
                    status: activeMediaAsset(current) ? "success" : "idle",
                    error: undefined, progress: undefined,
                });
            });
            return false;
        }
        const message = error instanceof Error ? error.message : String(error);
        const store2 = useCanvasStore.getState();
        if (!isText) store2.commit((prev) => setNodeMedia(prev, options.nodeId, { status: "error", error: message }));
        store2.setRuntime(options.nodeId, {
            status: "error", progress: 0, error: message, startedAt: Date.now(),
            retry: { model: options.model, params: options.params, mode: options.mode },
        });
        return false;
    } finally {
        if (inFlight.get(options.nodeId) === controller) inFlight.delete(options.nodeId);
    }
}

/**
 * Prompt back-solving: asks the producer to describe the node's active image,
 * then creates a linked, read-only text node to its right.
 */
export async function describeNodeImage(options: { nodeId: string; producer: CanvasProducer; model: string }): Promise<void> {
    const store = useCanvasStore.getState();
    const node = getNode(store.doc, options.nodeId);
    if (!node || node.data.type !== "image" || !options.producer.describe) return;
    const data = node.data;
    const asset = activeMediaAsset(data);
    if (!asset) return;

    store.setRuntime(options.nodeId, { status: "running", progress: 0, startedAt: Date.now() });
    try {
        const text = await options.producer.describe({
            kind: "describe-image",
            model: options.model,
            prompt: "Describe this image as a detailed generation prompt.",
            references: [{ nodeId: node.id, kind: "image", assetId: asset.id, url: asset.url, remoteUrl: asset.remoteUrl }],
            params: { ratio: "1:1", quality: "standard", count: 1 },
        });
        if (!text) throw new Error("Empty description");
        const promptNodeId = createId("node");
        store.commit((prev) => ({
            ...prev,
            nodes: [
                ...prev.nodes,
                {
                    id: promptNodeId,
                    type: "text",
                    title: "",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: 340,
                    height: 280,
                    data: { type: "text", text, role: "prompt" },
                },
            ],
            edges: [...prev.edges, { id: createId("edge"), from: node.id, to: promptNodeId }],
        }));
        useCanvasStore.getState().select([promptNodeId]);
        useCanvasStore.getState().setRuntime(options.nodeId, null);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        useCanvasStore.getState().setRuntime(options.nodeId, { status: "error", progress: 0, error: message, startedAt: Date.now() });
    }
}

export function useAbortController() {
    return useRef<AbortController | null>(null);
}
