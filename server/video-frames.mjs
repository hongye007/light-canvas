import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const formats = {
    "video/mp4": "mov", "video/quicktime": "mov", "video/webm": "matroska",
    "video/x-matroska": "matroska", "video/ogg": "ogg", "video/x-msvideo": "avi",
};

export async function videoFrames(file, signal) {
    const format = file && Object.hasOwn(formats, file.type) ? formats[file.type] : undefined;
    if (!format) throw new Error("A supported video file is required (MP4, MOV, WebM, MKV, Ogg or AVI).");
    const dir = await mkdtemp(join(tmpdir(), "maxflow-frames-"));
    try {
        const source = join(dir, "input");
        await writeFile(source, Buffer.from(await file.arrayBuffer()), { signal });
        await run("ffmpeg", [
            "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", format, "-i", source,
            "-map", "0:v:0", "-vf", "select='isnan(prev_selected_t)+gte(t-prev_selected_t,2)',scale=640:640:force_original_aspect_ratio=decrease",
            "-fps_mode", "vfr", "-frames:v", "6", join(dir, "frame-%02d.jpg"),
        ], { signal, timeout: 30_000, maxBuffer: 64 * 1024 });
        const files = (await readdir(dir)).filter(name => /^frame-\d+\.jpg$/.test(name)).sort();
        if (!files.length) throw new Error("No frames");
        return Promise.all(files.map(async name => `data:image/jpeg;base64,${(await readFile(join(dir, name))).toString("base64")}`));
    } catch (error) {
        signal.throwIfAborted();
        if (error.code === "ENOENT") throw new Error("Install ffmpeg on the backend to analyze video references.");
        throw new Error("Could not sample frames from the video reference.");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}
