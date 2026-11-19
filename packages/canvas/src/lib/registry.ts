import { BUILTIN_NODE_SIZES } from "./geometry";
import type { CanvasNode, NodeCapabilities, NodeData, NodeDefinition } from "../types";

const builtin: NodeDefinition[] = [
    {
        type: "text",
        version: 1,
        labelKey: "node.text.label",
        capabilities: { canGenerate: true, generateKind: "text", acceptsReference: true, providesReference: true, canConnect: true, canBeGrouped: true },
        defaultSize: BUILTIN_NODE_SIZES.text,
        minSize: { width: 200, height: 140 },
        resizable: true,
        aspectLocked: false,
        createData: () => ({ type: "text", text: "", role: "note" }) as NodeData,
        minimapColor: "#7c8698",
    },
    {
        type: "image",
        version: 1,
        labelKey: "node.image.label",
        capabilities: { canGenerate: true, generateKind: "image", acceptsReference: true, providesReference: true, canConnect: true, canBeGrouped: true },
        defaultSize: BUILTIN_NODE_SIZES.image,
        minSize: { width: 200, height: 200 },
        resizable: true,
        aspectLocked: false,
        createData: () => ({ type: "image", assets: [], prompt: "", status: "idle" }) as NodeData,
        minimapColor: "#3f7f6f",
    },
    {
        type: "video",
        version: 1,
        labelKey: "node.video.label",
        capabilities: { canGenerate: true, generateKind: "video", acceptsReference: true, providesReference: true, canConnect: true, canBeGrouped: true },
        defaultSize: BUILTIN_NODE_SIZES.video,
        minSize: { width: 240, height: 160 },
        resizable: true,
        aspectLocked: false,
        createData: () => ({ type: "video", assets: [], prompt: "", status: "idle" }) as NodeData,
        minimapColor: "#6f5a9e",
    },
    {
        type: "group",
        version: 1,
        labelKey: "node.group.label",
        capabilities: { canGenerate: false, acceptsReference: false, providesReference: false, canConnect: false, canBeGrouped: false },
        defaultSize: { width: 480, height: 320 },
        minSize: { width: 280, height: 200 },
        resizable: true,
        aspectLocked: false,
        createData: () => ({ type: "group", label: "Group", collapsed: false }) as NodeData,
        minimapColor: "#4a4a4a",
    },
];

/**
 * Node type registry. Hosts and plugins register extra types without touching canvas code;
 * the add-node menu and the renderer both read from here.
 */
export class NodeRegistry {
    private definitions = new Map<string, NodeDefinition>();

    constructor(initial: NodeDefinition[] = []) {
        for (const def of initial) this.register(def);
    }

    register(def: NodeDefinition) {
        this.definitions.set(def.type, def);
        return this;
    }

    get(type: string): NodeDefinition | undefined {
        return this.definitions.get(type);
    }

    require(type: string): NodeDefinition {
        const def = this.definitions.get(type);
        if (!def) throw new Error(`[maxflow] unknown node type: ${type}`);
        return def;
    }

    list(): NodeDefinition[] {
        return [...this.definitions.values()];
    }

    /** Node types a node of `type` may connect to / from. */
    canConnect(type: string, cap: keyof NodeCapabilities = "canConnect") {
        return Boolean(this.definitions.get(type)?.capabilities[cap]);
    }
}

export const builtinRegistry = new NodeRegistry(builtin);

export function isGroup(node: CanvasNode) {
    return node.type === "group";
}
