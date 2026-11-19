import { createEmptyDocument, createId, createMediaNode, createTextNode, type CanvasDocument } from "@infranic/light-canvas";

/** A small, realistic canvas so the demo opens with something to look at. */
export function buildDemoDocument(compact = false): CanvasDocument {
    const base = createEmptyDocument("MaxFlow");
    const text = createTextNode({ x: 0, y: 0 },
        "深夜的城市天台，霓虹灯把雨水照成彩色。一个穿风衣的人站在栏杆边，镜头缓慢推近。",
    );
    const image = createMediaNode("image", { x: 430, y: 0 });
    const video = createMediaNode("video", { x: 810, y: 0 });

    return {
        ...base,
        viewport: compact ? { x: 20, y: 120, k: 0.68 } : { x: 220, y: 260, k: 0.8 },
        nodes: [
            text,
            image,
            video,
        ],
        // Seed one visible connection out of the box so edges are immediately legible.
        edges: [
            { id: createId("edge"), from: text.id, to: image.id, fromPort: "right", toPort: "left" },
            { id: createId("edge"), from: image.id, to: video.id, fromPort: "right", toPort: "left" },
        ],
    };
}
