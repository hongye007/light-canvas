import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { videoFrames } from "./video-frames.mjs";

const sizes = { "1:1": "1024x1024", "3:4": "864x1152", "4:3": "1152x864", "9:16": "864x1536", "16:9": "1536x864", "2:3": "768x1152", "3:2": "1152x768" };

export function createAdapters({ api, video }) {
    async function request(connection, path, signal, body) {
        const response = await fetch(connection.base + path, {
            method: body ? "POST" : "GET", redirect: "error", signal,
            headers: { Authorization: `Bearer ${connection.key}`, ...(body instanceof FormData || !body ? {} : { "Content-Type": "application/json" }) },
            body: body instanceof FormData || !body ? body : JSON.stringify(body),
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Upstream request failed (HTTP ${response.status}).`);
        }
        return response;
    }

    async function download(url, kind, ctx) {
        const target = new URL(url);
        if (target.protocol !== "https:" || target.username || target.password) throw new Error("Invalid generated asset URL.");
        const response = await fetch(target, { signal: ctx.signal, redirect: "error" });
        const type = response.headers.get("content-type")?.split(";")[0];
        const fallback = kind === "video" && /\.mp4$/i.test(target.pathname) ? "video/mp4"
            : kind === "image" && /\.png$/i.test(target.pathname) ? "image/png"
            : kind === "image" && /\.webp$/i.test(target.pathname) ? "image/webp"
            : kind === "image" && /\.jpe?g$/i.test(target.pathname) ? "image/jpeg" : undefined;
        const mime = type?.startsWith(`${kind}/`) ? type : type === "application/octet-stream" ? fallback : undefined;
        if (!response.ok || !response.body || !mime) {
            await response.body?.cancel();
            throw new Error("Could not download the generated media.");
        }
        return ctx.saveResponse(response, mime);
    }

    function asset(kind, fields) {
        return { id: randomUUID(), kind, ...fields };
    }

    function withText(req, prompt = req.prompt) {
        return [prompt, ...req.references.flatMap((ref, index) => ref.kind === "text" && ref.text
            ? [`Reference ${index + 1}: ${ref.text}`] : [])].filter(Boolean).join("\n\n");
    }

    function numberedImages(prompt, refs, format) {
        return prompt.replace(/\bReference (\d+)\b/g, (label, number) => {
            const index = Number(number) - 1;
            return refs[index]?.kind === "image" ? format(refs.slice(0, index + 1).filter(ref => ref.kind === "image").length) : label;
        });
    }

    return {
        async image(req, ctx) {
            const size = sizes[req.params.ratio] ?? sizes["1:1"];
            const images = req.references.filter(ref => ref.kind === "image");
            const edit = req.kind === "image-edit" || images.length > 0;
            if (edit && (!images.length || images.some(ref => !ref.file || !/^image\/(png|jpeg|webp)$/.test(ref.file.type)))) {
                throw new Error("Image editing requires PNG, JPEG, or WebP references.");
            }
            const input = { model: req.model, prompt: withText(req, numberedImages(req.prompt, req.references, n => `Image ${n}`)),
                n: Math.min(4, Math.max(1, Number(req.params.count) || 1)), size,
                ...(req.params.transparentBackground ? { background: "transparent", output_format: "png" } : {}) };
            let body = input;
            if (edit) {
                body = new FormData();
                for (const [key, value] of Object.entries(input)) body.set(key, String(value));
                const field = images.length === 1 ? "image" : "image[]";
                images.forEach(ref => body.append(field, ref.file, ref.file.name));
            }
            const result = await (await request(api, edit ? "/images/edits" : "/images/generations", ctx.signal, body)).json();
            const [width, height] = size.split("x").map(Number);
            const assets = [];
            for (const item of result.data ?? []) {
                const url = item.b64_json ? await ctx.save(Buffer.from(item.b64_json, "base64"), "image/png")
                    : item.url ? await download(item.url, "image", ctx) : undefined;
                if (url) assets.push(asset("image", { url, remoteUrl: item.url, width, height }));
            }
            if (!assets.length) throw new Error("The image service returned no images.");
            return { assets };
        },
        async text(req, ctx) {
            const content = [{ type: "text", text: req.prompt || "Describe the supplied references." }];
            for (const [index, ref] of req.references.entries()) {
                const label = `Reference ${index + 1}`;
                if (ref.kind === "text" && ref.text) content.push({ type: "text", text: `${label}: ${ref.text}` });
                if (ref.kind === "image" && ref.file && ref.file.type.startsWith("image/")) {
                    content.push({ type: "text", text: label }, { type: "image_url", image_url: {
                        url: `data:${ref.file.type};base64,${Buffer.from(await ref.file.arrayBuffer()).toString("base64")}`,
                    } });
                }
                if (ref.kind === "image" && (!ref.file || !ref.file.type.startsWith("image/"))) {
                    throw new Error("An image reference file could not be read.");
                }
                if (ref.kind === "video") {
                    const frames = await videoFrames(ref.file, ctx.signal);
                    content.push({ type: "text", text: `${label} (video frames, chronological order, no audio):` },
                        ...frames.map(url => ({ type: "image_url", image_url: { url } })));
                }
            }
            const result = await (await request(api, "/chat/completions", ctx.signal, { model: req.model, messages: [
                { role: "system", content: req.kind === "describe-image" ? "Write a precise image-generation prompt. Reply with only the prompt." : "Follow the user instruction and use the supplied references." },
                { role: "user", content },
            ] })).json();
            const text = result.choices?.[0]?.message?.content?.trim();
            if (!text) throw new Error("The text service returned no text.");
            return { text };
        },
        async video(req, ctx) {
            if (req.kind === "video-edit") throw new Error("Video editing is unavailable for this adapter.");
            const images = req.references.filter(ref => ref.kind === "image");
            const videos = req.references.filter(ref => ref.kind === "video");
            if (images.length > 1 || videos.length) throw new Error("This video adapter accepts text and one optional reference image.");
            if (images.length && !images[0].file) throw new Error("The video reference image could not be read.");
            const form = new FormData();
            form.set("model", req.model);
            form.set("prompt", withText(req));
            form.set("size", req.params.ratio === "9:16" ? "720x1280" : "1280x720");
            if (images[0]?.file) form.set("input_reference", images[0].file, images[0].file.name);
            let job = await (await request(video, "/videos", ctx.signal, form)).json();
            if (typeof job.id !== "string" || !/^[\w-]+$/.test(job.id)) throw new Error("The video service returned no valid job ID.");
            const path = `/videos/${job.id}`;
            while (job.status === "queued" || job.status === "in_progress") {
                ctx.progress(job.progress);
                await delay(2000, undefined, { signal: ctx.signal });
                job = await (await request(video, path, ctx.signal)).json();
            }
            if (job.status !== "completed") throw new Error("The video service did not complete the job.");
            const response = await request(video, `${path}/content`, ctx.signal);
            const url = await ctx.saveResponse(response, "video/mp4");
            return { assets: [asset("video", { url })] };
        },
    };
}
