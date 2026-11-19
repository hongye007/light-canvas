import { type CanvasProducer, type GenerationRequest, type GenerationResult, type ModelInfo } from "@infranic/light-canvas";

type TaskResult = GenerationResult | { text: string };
type Task = { id: string; status: "running" | "completed" | "failed" | "cancelled"; progress: number; result?: TaskResult; error?: string };
type BackendConfig = { descriptors: ModelInfo[] };

export const MOCK_MODELS: ModelInfo[] = [
    { id: "mock-text", label: "Mock Text", capabilities: ["text", "describe"] },
    { id: "mock-image", label: "Mock Image", capabilities: ["image"] },
];

export async function readBackendConfig(signal: AbortSignal): Promise<BackendConfig | null> {
    const response = await fetch("/api/config", { signal, cache: "no-store" });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return null;
    const config = await response.json() as BackendConfig;
    return Array.isArray(config.descriptors) ? config : null;
}

async function getTask(response: Response): Promise<Task> {
    const task = await response.json();
    if (!response.ok) throw new Error(task.error?.message ?? `Request failed (${response.status}).`);
    return task;
}

function sleep(signal: AbortSignal, ms: number) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, ms);
        signal.addEventListener("abort", abort, { once: true });
    });
}

export function createHttpProducer(): CanvasProducer {
    async function run(request: GenerationRequest): Promise<TaskResult> {
        const signal = request.signal ?? new AbortController().signal;
        const form = new FormData();
        const { kind, model, prompt, params } = request;
        const references = await Promise.all(request.references.map(async (ref, index) => {
            const url = ref.remoteUrl ?? ref.url;
            if (ref.url && ref.kind !== "text") {
                try {
                    const response = await fetch(ref.url, { signal });
                    if (!response.ok) throw new Error();
                    const blob = await response.blob();
                    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[blob.type];
                    form.set(`reference-${index}`, blob, extension ? `reference-${index}.${extension}` : `reference-${index}`);
                } catch {
                    signal.throwIfAborted();
                    if (!url || !/^https?:\/\//i.test(url)) throw new Error("A reference file could not be read.");
                }
            }
            return { nodeId: ref.nodeId, kind: ref.kind, text: ref.text,
                remoteUrl: url && /^https?:\/\//i.test(url) ? url : undefined };
        }));
        form.set("request", JSON.stringify({ kind, model, prompt, params, references }));
        let task = await getTask(await fetch("/api/tasks", { method: "POST", body: form, signal }));
        const path = `/api/tasks/${encodeURIComponent(task.id)}`;
        try {
            while (task.status === "running") {
                request.onProgress?.(task.progress);
                await sleep(signal, 900);
                task = await getTask(await fetch(path, { signal, cache: "no-store" }));
            }
            signal.throwIfAborted();
            if (task.status !== "completed" || !task.result) throw new Error(task.error ?? "The generation task did not complete.");
            return task.result;
        } finally {
            if (signal.aborted) void fetch(path, { method: "DELETE", keepalive: true }).catch(() => {});
        }
    }

    const text = async (request: GenerationRequest) => {
        const result = await run(request);
        if (!("text" in result)) throw new Error("The generation task returned no text.");
        return result.text;
    };
    return {
        async generate(request) {
            const result = await run(request);
            if (!("assets" in result)) throw new Error("The generation task returned no media.");
            return result;
        },
        generateText: text,
        describe: request => text({ ...request, kind: "describe-image" }),
    };
}
