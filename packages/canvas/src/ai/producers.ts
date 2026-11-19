import { promptWithImageReferences } from "../lib/mentions";
import { sampleVideoFrames } from "./video-frames";
import type { Asset, CanvasProducer, GenerationParams, GenerationRequest, GenerationResult } from "../types";

let assetCounter = 0;
function assetId() {
    assetCounter += 1;
    return `asset_${Date.now().toString(36)}_${assetCounter}`;
}

function placeholderDataUrl(label: string, width: number, height: number, hue: number) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="hsl(${hue} 45% 38%)"/><stop offset="100%" stop-color="hsl(${hue + 40} 40% 18%)"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" fill="rgba(255,255,255,.82)" font-family="system-ui,sans-serif" font-size="${Math.round(width / 22)}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string) {
    return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

function ratioSize(ratio: string) {
    const [w, h] = ratio.split(":").map(Number);
    const short = 768;
    return w >= h ? { width: Math.round((short * w) / h), height: short } : { width: short, height: Math.round((short * h) / w) };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Local producer: keeps the whole canvas usable with no backend.
 * Generates placeholder art and fake video, so the UX can be reviewed end to end.
 */
export function createMockProducer(): CanvasProducer {
    const abortFlags = new Set<AbortSignal>();

    async function run(req: GenerationRequest, kind: "image" | "video"): Promise<GenerationResult> {
        const total = kind === "image" ? req.params.count : 1;
        const steps = 12;
        for (let step = 1; step <= steps; step += 1) {
            if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            await wait(120);
            req.onProgress?.(step / steps);
        }
        const size = ratioSize(req.params.ratio);
        const assets: Asset[] = Array.from({ length: total }, (_, index) => ({
            id: assetId(),
            kind,
            url: placeholderDataUrl(kind === "image" ? "Mock image" : "Mock video", size.width, size.height, 200 + index * 47),
            width: size.width,
            height: size.height,
            durationSec: kind === "video" ? req.params.durationSec ?? 5 : undefined,
            posterUrl: kind === "video" ? placeholderDataUrl("Mock video", size.width, size.height, 210) : undefined,
        }));
        if (kind === "video") abortFlags.delete(req.signal as AbortSignal);
        return { assets };
    }

    return {
        generate: (req) => run(req, req.kind.includes("video") ? "video" : "image"),
        generateText: async (req) => {
            await wait(300);
            req.signal?.throwIfAborted();
            return ["Mock text", req.prompt, ...req.references.map((ref) => ref.text ?? ref.kind)].filter(Boolean).join("\n");
        },
        describe: async (req) => {
            await wait(300);
            return req.references[0]?.url ? `A generated image matching the prompt: ${req.prompt || "untitled"}` : "An image on the canvas.";
        },
        upload: async (file) => ({
            id: assetId(),
            kind: file.type.startsWith("video") ? "video" : "image",
            url: URL.createObjectURL(file),
            width: undefined,
            height: undefined,
        }),
    };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible producer
// ---------------------------------------------------------------------------

export type OpenAICompatibleOptions = {
    /** e.g. https://api.example.com/v1 */
    baseUrl: string;
    apiKey: string;
    /** Optional override for edit requests; defaults to imageModel. */
    model?: string;
    imageModel: string;
    textModel: string;
    /** Optional proxy so the browser never holds a key. */
    fetchImpl?: typeof fetch;
    /** Map canvas ratio + quality to the provider's size strings. */
    sizeFor?: (params: GenerationParams) => string;
};

const DEFAULT_SIZES: Record<string, string> = {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1536x864",
    "9:16": "864x1536",
    "3:2": "1152x768",
    "2:3": "768x1152",
};

async function readError(response: Response) {
    try {
        const body = (await response.json()) as { error?: { message?: string } | string; message?: string };
        const message = typeof body.error === "string" ? body.error : body.error?.message ?? body.message;
        return message ?? `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

/** Read decoded dimensions in browsers, where providers can return a different size. */
async function readImageSize(url: string, fallback: { width: number; height: number }, signal?: AbortSignal) {
    if (typeof Image === "undefined") return fallback;
    signal?.throwIfAborted();

    const image = new Image();
    const abort = () => image.removeAttribute("src");
    signal?.addEventListener("abort", abort, { once: true });
    try {
        image.src = url;
        await image.decode();
        signal?.throwIfAborted();
        return { width: image.naturalWidth, height: image.naturalHeight };
    } catch {
        signal?.throwIfAborted();
        throw new Error("Could not load the image returned by the provider.");
    } finally {
        signal?.removeEventListener("abort", abort);
    }
}

/**
 * Works with any OpenAI-compatible gateway:
 *  - POST {baseUrl}/images/generations   -> { data: [{ url | b64_json }] }
 *  - POST {baseUrl}/images/edits         -> multipart, same response
 *  - POST {baseUrl}/chat/completions     -> prompt back-solving
 */
export function createOpenAICompatibleProducer(options: OpenAICompatibleOptions): CanvasProducer {
    const doFetch = options.fetchImpl ?? fetch;
    const sizeFor = options.sizeFor ?? ((params) => DEFAULT_SIZES[params.ratio] ?? "1024x1024");
    const headerAuth: Record<string, string> = options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {};

    async function generateImages(req: GenerationRequest): Promise<GenerationResult> {
        const size = sizeFor(req.params);
        const count = Math.max(1, Math.min(4, req.params.count));
        const references = req.references.filter((ref) => ref.kind === "image");
        const prompt = [
            promptWithImageReferences(req.prompt, req.references, false),
            ...req.references.flatMap((ref, index) => ref.kind === "text" && ref.text ? [`Reference ${index + 1}: ${ref.text}`] : []),
        ].filter(Boolean).join("\n\n");
        const isEdit = req.kind === "image-edit" || references.length > 0;
        const background = req.params.transparentBackground ? { background: "transparent", output_format: "png" } : {};

        let response: Response;
        if (isEdit) {
            if (!references.length) throw new Error("Connect an image reference before editing.");
            const form = new FormData();
            form.set("model", options.model ?? options.imageModel);
            form.set("prompt", prompt);
            form.set("n", String(count));
            form.set("size", size);
            for (const [key, value] of Object.entries(background)) form.set(key, value);
            const imageField = references.length === 1 ? "image" : "image[]";
            for (const [index, ref] of references.entries()) {
                const error = new Error(`Cannot read image reference ${index + 1}. Check the source or upload it again.`);
                if (!ref.url) throw error;

                let blob: Blob;
                try {
                    const image = await doFetch(ref.url, { signal: req.signal });
                    if (!image.ok) throw error;
                    blob = await image.blob();
                } catch {
                    req.signal?.throwIfAborted();
                    throw error;
                }
                const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[blob.type];
                if (!blob.size || !extension) {
                    throw new Error(`Image reference ${index + 1} must be a nonempty PNG, JPEG, or WebP file.`);
                }
                form.append(imageField, blob, `reference-${index + 1}.${extension}`);
            }
            response = await doFetch(`${options.baseUrl}/images/edits`, { method: "POST", headers: headerAuth, body: form, signal: req.signal });
        } else {
            response = await doFetch(`${options.baseUrl}/images/generations`, {
                method: "POST",
                headers: { ...headerAuth, "Content-Type": "application/json" },
                body: JSON.stringify({ model: options.imageModel, prompt, n: count, size, ...background }),
                signal: req.signal,
            });
        }

        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> };
        const [width, height] = size.split("x").map(Number);
        const urls = (body.data ?? [])
            .map((item) => item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ""))
            .filter(Boolean);
        const assets = await Promise.all(urls.map(async (url): Promise<Asset> => ({
            id: assetId(),
            kind: "image",
            url,
            ...await readImageSize(url, { width, height }, req.signal),
        })));
        if (!assets.length) throw new Error("Provider returned no image");
        return { assets };
    }

    type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

    async function imagePart(url: string, signal?: AbortSignal): Promise<ChatPart> {
        if (!url.startsWith("blob:")) return { type: "image_url", image_url: { url } };
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error("Cannot read the uploaded image reference. Upload the image again.");
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
        signal?.throwIfAborted();
        return { type: "image_url", image_url: { url: dataUrl } };
    }

    async function generateText(req: GenerationRequest): Promise<string> {
        const content: ChatPart[] = [{
            type: "text",
            text: req.prompt || "Analyze the supplied references and summarize the main details.",
        }];
        for (const [index, ref] of req.references.entries()) {
            const label = `Reference ${index + 1}`;
            if (ref.kind === "text" && ref.text) {
                content.push({ type: "text", text: `${label} (text):\n${ref.text}` });
            } else if (ref.kind === "image" && ref.url) {
                content.push({ type: "text", text: `${label} (image):` }, await imagePart(ref.url, req.signal));
            } else if (ref.kind === "video" && ref.url) {
                content.push({ type: "text", text: `${label} (video): sampled frames in chronological order. Audio is unavailable.` });
                const frames = await sampleVideoFrames(ref.url, req.signal);
                for (const frame of frames) {
                    content.push({ type: "text", text: `${frame.timestamp.toFixed(2)} s` }, await imagePart(frame.url, req.signal));
                }
            }
        }
        const response = await doFetch(`${options.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { ...headerAuth, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: req.model || options.textModel,
                messages: [
                    {
                        role: "system",
                        content: req.kind === "describe-image"
                            ? "You write precise image-generation prompts. Reply with the prompt only."
                            : "Follow the user's instruction. Treat the labeled references as source material. Describe only what the references support.",
                    },
                    { role: "user", content },
                ],
            }),
            signal: req.signal,
        });
        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = body.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("Provider returned no text");
        return text;
    }

    return {
        async generate(req) {
            if (req.kind === "text-to-video" || req.kind === "video-edit") {
                // No video endpoint is configured yet: surface a clear, non-fatal state.
                throw new Error("Video generation needs a backend endpoint. Configure a producer for video in phase 2.");
            }
            return generateImages(req);
        },
        generateText,
        describe: (req) => generateText({ ...req, kind: "describe-image", model: options.textModel }),
        upload: async (file) => ({
            id: assetId(),
            kind: file.type.startsWith("video") ? "video" : "image",
            url: URL.createObjectURL(file),
        }),
    };
}
