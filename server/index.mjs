import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createAdapters } from "./adapters.mjs";
import { createTaskRouter } from "./tasks.mjs";

const host = process.env.MAXFLOW_HOST || "127.0.0.1";
const port = Number(process.env.MAXFLOW_PORT || process.env.PORT || 5210);
const loopback = ["127.0.0.1", "::1", "localhost"].includes(host);
const password = process.env.MAXFLOW_ACCESS_PASSWORD;
function connection(baseUrl, key) {
    if (!baseUrl) return { key };
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error("Upstream base URLs must be HTTP(S) and cannot contain credentials, query, or fragment.");
    }
    return { base: url.href.replace(/\/$/, ""), key };
}

function configuredKey(prefix) {
    const variable = process.env[`${prefix}_KEY_ENV`];
    return process.env[`${prefix}_KEY`] || (variable ? process.env[variable] : undefined);
}

const api = connection(process.env.MAXFLOW_API_BASE_URL, configuredKey("MAXFLOW_API"));
const videoConnection = connection(process.env.MAXFLOW_VIDEO_API_BASE_URL || api.base, configuredKey("MAXFLOW_VIDEO_API"));
const video = {
    ...videoConnection,
    key: videoConnection.key || (videoConnection.base === api.base ? api.key : undefined),
};
const models = {
    text: process.env.MAXFLOW_TEXT_MODEL || "",
    image: process.env.MAXFLOW_IMAGE_MODEL || "",
    video: process.env.MAXFLOW_VIDEO_MODEL || "",
};
const demo = fileURLToPath(new URL("../apps/demo/dist/", import.meta.url));
const staticTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MAXFLOW_PORT must be between 1 and 65535.");
if (!loopback && !password) throw new Error("Set MAXFLOW_ACCESS_PASSWORD before binding to a non-loopback address.");
if (((models.text || models.image) && (!api.base || !api.key)) || (models.video && (!video.base || !video.key))) {
    throw new Error("Set the server-side API base URL and key for each configured capability.");
}
const descriptors = [
    ...(models.text ? [{ id: models.text, label: models.text, capabilities: ["text", "describe"] }] : []),
    ...(models.image ? [{ id: models.image, label: models.image, capabilities: ["image"],
        transparentBackground: process.env.MAXFLOW_IMAGE_TRANSPARENT_BACKGROUND === "1" }] : []),
    ...(models.video ? [{
        id: models.video, label: models.video, capabilities: ["video"], counts: [1],
        ratios: ["16:9", "9:16"],
    }] : []),
];

function json(response, status, data) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(data));
}

function failure(response, status, message) {
    json(response, status, { error: { message } });
}

function authorized(request) {
    if (!password) return true;
    const supplied = Buffer.from(request.headers.authorization ?? "");
    const expected = Buffer.from(`Basic ${Buffer.from(`maxflow:${password}`).toString("base64")}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const taskRoute = createTaskRouter({ models, descriptors, adapters: createAdapters({ api, video }), json, failure });

export function startServer(fallback) {
    const server = createServer(async (request, response) => {
        try {
            const method = request.method;
            const requestHost = request.headers.host ?? "";
            if (loopback && !password && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(requestHost)) {
                failure(response, 403, "This instance only accepts local requests.");
                return;
            }
            const requestOrigin = request.headers.origin;
            if (requestOrigin && requestOrigin !== `http://${requestHost}` && requestOrigin !== `https://${requestHost}`) {
                failure(response, 403, "Use the MaxFlow server's own origin.");
                return;
            }
            if (!authorized(request)) {
                response.setHeader("www-authenticate", 'Basic realm="MaxFlow", charset="UTF-8"');
                failure(response, 401, "Authentication required.");
                return;
            }
            const { pathname } = new URL(request.url ?? "/", "http://localhost");
            if (await taskRoute(request, response, pathname)) return;
            if (pathname.startsWith("/api/")) {
                failure(response, 404, "Unknown API route.");
                return;
            }
            if (fallback) return fallback(request, response);
            if (method !== "GET" && method !== "HEAD") {
                failure(response, 405, "Method not allowed.");
                return;
            }
            const path = resolve(demo, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`);
            if (!path.startsWith(`${resolve(demo)}${sep}`)) {
                failure(response, 404, "File not found.");
                return;
            }
            const file = await stat(path).catch(() => null);
            if (!file?.isFile()) {
                failure(response, 404, pathname === "/" ? "Run pnpm build before starting the server." : "File not found.");
                return;
            }
            response.writeHead(200, {
                "content-type": staticTypes[extname(path)] ?? "application/octet-stream",
                "content-length": file.size,
                "x-content-type-options": "nosniff",
            });
            if (method === "HEAD") response.end();
            else await pipeline(createReadStream(path), response);
        } catch {
            if (response.destroyed || response.writableEnded) return;
            if (response.headersSent) response.destroy();
            else failure(response, 502, "Request could not be completed. Check the backend and upstream configuration.");
        }
    });

    server.on("error", (error) => {
        console.error(`MaxFlow backend could not listen on ${host}:${port} (${error.code ?? "unknown error"}).`);
        process.exitCode = 1;
    });
    server.listen(port, host, () => console.log(`MaxFlow backend listening on ${host}:${port}`));
    return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
