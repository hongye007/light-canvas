import { createServer as createViteServer } from "vite";
process.env.MAXFLOW_PORT ??= process.env.PORT || "5173";
const { startServer } = await import("../../server/index.mjs");

let vite;
const server = startServer((request, response) => {
    if (!vite) {
        response.writeHead(503);
        response.end("The development server is starting.");
        return;
    }
    vite.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end("Not found");
    });
});
vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
