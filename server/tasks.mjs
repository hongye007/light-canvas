import { randomUUID } from "node:crypto";
import { setTimeout as expire } from "node:timers";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const categories = { "text-to-image": "image", "image-edit": "image", "text-to-video": "video",
    "video-edit": "video", "generate-text": "text", "describe-image": "text" };
const maxBytes = 64 * 1024 * 1024;
const ttl = 15 * 60 * 1000;

export function createTaskRouter({ models, descriptors, adapters, json, failure }) {
    const tasks = new Map();
    let pending = 0;
    let reading = 0;
    const clean = task => {
        tasks.delete(task.id);
        if (task.dir) void rm(task.dir, { recursive: true, force: true }).catch(() => {});
    };
    const view = ({ id, status, progress, result, error }) => ({ id, status, progress, result, error });

    async function submit(request, response) {
        if (pending + reading >= 4 || tasks.size >= 32) return failure(response, 429, "The generation queue is full.");
        if (Number(request.headers["content-length"]) > maxBytes) return failure(response, 413, "Request exceeds 64 MiB.");
        reading++;
        try {
            const pieces = [];
            let total = 0;
            for await (const chunk of request.iterator({ destroyOnReturn: false })) {
                total += chunk.length;
                if (total > maxBytes) {
                    response.setHeader("connection", "close");
                    return failure(response, 413, "Request exceeds 64 MiB.");
                }
                pieces.push(chunk);
            }
            const type = request.headers["content-type"] ?? "";
            let input, form;
            try {
                const body = Buffer.concat(pieces, total);
                if (/^multipart\/form-data;/i.test(type)) {
                    form = await new Response(body, { headers: { "content-type": type } }).formData();
                    input = JSON.parse(form.get("request"));
                } else if (/^application\/json(?:;|$)/i.test(type)) input = JSON.parse(body.toString("utf8"));
                else return failure(response, 415, "Expected JSON or multipart form data.");
            } catch {
                return failure(response, 400, "Invalid generation request.");
            }
            if (!input || !Object.hasOwn(categories, input.kind) || typeof input.prompt !== "string" ||
                !input.params || typeof input.params !== "object" || !Array.isArray(input.references) ||
                input.references.length > 16 || input.references.some(ref => !ref || !["image", "text", "video"].includes(ref.kind))) {
                return failure(response, 400, "Invalid generation request.");
            }
            const kind = categories[input.kind];
            if (!models[kind]) return failure(response, 503, "This model capability is not configured.");
            if (input.model && input.model !== models[kind]) return failure(response, 400, "Unknown model for this capability.");
            const references = input.references.map((ref, index) => {
                const file = form?.get(`reference-${index}`);
                return { ...ref, file: file instanceof File ? file : undefined };
            });
            const id = randomUUID();
            const task = { id, status: "running", progress: 0, controller: new AbortController(), assets: [] };
            tasks.set(id, task);
            pending++;
            json(response, 202, view(task));
            const signal = AbortSignal.any([task.controller.signal, AbortSignal.timeout(600_000)]);
            const ctx = {
                signal,
                progress: value => { if (typeof value === "number") task.progress = Math.max(0, Math.min(0.99, value / 100)); },
                async save(buffer, mime) {
                    if (buffer.length > maxBytes) throw new Error("Generated asset exceeds 64 MiB.");
                    task.dir ??= await mkdtemp(join(tmpdir(), "maxflow-job-"));
                    const file = join(task.dir, String(task.assets.length));
                    await writeFile(file, buffer, { signal });
                    const index = task.assets.push({ file, mime }) - 1;
                    return `/api/tasks/${id}/assets/${index}`;
                },
                async saveResponse(remote, mime) {
                    task.dir ??= await mkdtemp(join(tmpdir(), "maxflow-job-"));
                    const file = join(task.dir, String(task.assets.length));
                    let total = 0;
                    const limit = new Transform({
                        transform(chunk, _encoding, done) {
                            total += chunk.length;
                            if (total > 256 * 1024 * 1024) done(new Error("Generated asset exceeds 256 MiB."));
                            else done(null, chunk);
                        },
                    });
                    await pipeline(Readable.fromWeb(remote.body), limit, createWriteStream(file), { signal });
                    const index = task.assets.push({ file, mime }) - 1;
                    return `/api/tasks/${id}/assets/${index}`;
                },
            };
            void Promise.resolve().then(() => adapters[kind]({ kind: input.kind, model: models[kind], prompt: input.prompt, params: input.params, references }, ctx))
                .then(result => {
                    signal.throwIfAborted();
                    task.result = result;
                    task.progress = 1;
                    task.status = "completed";
                }).catch(error => {
                    if (task.status === "cancelled") return;
                    task.status = "failed";
                    task.error = error instanceof Error ? error.message : "Generation failed.";
                }).finally(() => {
                    pending--;
                    expire(() => clean(task), ttl).unref();
                });
        } finally {
            reading--;
        }
    }

    return async function route(request, response, pathname) {
        if (pathname === "/api/config" && request.method === "GET") {
            json(response, 200, { models, descriptors });
            return true;
        }
        if (pathname === "/api/tasks" && request.method === "POST") {
            await submit(request, response);
            return true;
        }
        const match = pathname.match(/^\/api\/tasks\/([\w-]+)(?:\/assets\/(\d+))?$/);
        if (!match) return false;
        const task = tasks.get(match[1]);
        if (!task) failure(response, 404, "Task not found or expired.");
        else if (match[2] !== undefined && request.method === "GET") {
            const asset = task.status === "completed" && task.assets[Number(match[2])];
            if (!asset) failure(response, 404, "Asset not found.");
            else {
                response.writeHead(200, { "content-type": asset.mime, "x-content-type-options": "nosniff",
                    "content-security-policy": "sandbox",
                    "content-length": (await stat(asset.file)).size });
                await pipeline(createReadStream(asset.file), response);
            }
        } else if (match[2] === undefined && request.method === "GET") json(response, 200, view(task));
        else if (match[2] === undefined && request.method === "DELETE") {
            if (task.status === "running") {
                task.status = "cancelled";
                task.controller.abort();
            }
            json(response, 200, view(task));
        } else failure(response, 405, "Method not allowed.");
        return true;
    };
}
