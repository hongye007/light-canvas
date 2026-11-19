import type { ComponentType, ReactNode } from "react";

/** World-space point. */
export type Vec = { x: number; y: number };

/** Screen transform: world * k + (x,y). */
export type Viewport = { x: number; y: number; k: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type RunStatus = "idle" | "queued" | "running" | "success" | "error";

export const IMAGE_ASSET_DRAG_TYPE = "application/x-maxflow-image-asset";

export type Asset = {
    id: string;
    kind: "image" | "video";
    url: string;
    localAssetId?: string;
    remoteUrl?: string;
    width?: number;
    height?: number;
    posterUrl?: string;
    durationSec?: number;
};

export type TextNodeData = {
    type: "text";
    contentOnly?: boolean;
    text: string;
    prompt?: string;
    /** "prompt" nodes are produced by prompt back-solving and render read-only. */
    role: "note" | "prompt";
};

export type MediaGenerationBatch = {
    id: string;
    createdAt?: number;
    assets: Asset[];
};

export type MediaNodeData = {
    type: "image" | "video";
    contentOnly?: boolean;
    assets: Asset[];
    activeAssetId?: string;
    generationRatio?: AspectRatio;
    generatedAt?: number;
    generationHistory?: MediaGenerationBatch[];
    prompt: string;
    status: RunStatus;
    progress?: number;
    error?: string;
    taskId?: string;
};

export type GroupNodeData = {
    type: "group";
    label: string;
    collapsed: boolean;
    color?: string;
};

export type PluginNodeData = { type: "plugin"; [key: string]: unknown };

export type NodeData = TextNodeData | MediaNodeData | GroupNodeData | PluginNodeData;

export type CanvasNode = {
    id: string;
    /** Registry key: built-ins are "text" | "image" | "video" | "group"; plugins use "<pluginId>:<name>". */
    type: string;
    title: string;
    position: Vec;
    width: number;
    height: number;
    data: NodeData;
    groupId?: string;
    /** Set by nodes that must keep their source media ratio when resized. */
    aspectLocked?: boolean;
};

/** Which side of a node a connection leaves from or arrives at. */
export type PortSide = "left" | "right" | "top" | "bottom";

export type Edge = {
    id: string;
    from: string;
    to: string;
    /** Defaults to "right" when absent (documents written before ports existed). */
    fromPort?: PortSide;
    /** Defaults to "left". */
    toPort?: PortSide;
};

export type CanvasDocument = {
    version: 1;
    id: string;
    title: string;
    nodes: CanvasNode[];
    edges: Edge[];
    viewport: Viewport;
    background: "dots" | "lines" | "blank";
    /** Host-defined payload the canvas preserves but never interprets. */
    meta: Record<string, unknown>;
};

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3";

export type Quality = "draft" | "standard" | "high";

export type ModelCapability = "image" | "video" | "describe" | "text";

export type VideoReferenceMode = "keyframe" | "reference";

export type ModelInfo = {
    id: string;
    label: string;
    capabilities: ModelCapability[];
    ratios?: AspectRatio[];
    counts?: number[];
    transparentBackground?: boolean;
    videoReferenceModes?: VideoReferenceMode[];
    videoResolutions?: string[];
    videoAudio?: { default: boolean };
    videoDuration?: { min: number; max: number; default: number };
};

export type Reference = {
    nodeId: string;
    kind: "image" | "video" | "text";
    assetId?: string;
    url?: string;
    remoteUrl?: string;
    text?: string;
};

export type GenerationParams = {
    ratio: AspectRatio;
    quality: Quality;
    count: number;
    transparentBackground?: boolean;
    resolution?: string;
    videoReferenceMode?: VideoReferenceMode;
    generateAudio?: boolean;
    durationSec?: number;
};

export type GenerationRequest = {
    kind: "text-to-image" | "image-edit" | "text-to-video" | "video-edit" | "describe-image" | "generate-text";
    model: string;
    prompt: string;
    references: Reference[];
    params: GenerationParams;
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
    /** Host-defined passthrough (tenant, trace id, ...). */
    context?: unknown;
};

export type GenerationResult = {
    assets: Asset[];
};

/** Everything the canvas needs from the outside world, in one injectable object. */
export type CanvasProducer = {
    generate: (req: GenerationRequest) => Promise<GenerationResult>;
    generateText?: (req: GenerationRequest) => Promise<string>;
    describe?: (req: GenerationRequest) => Promise<string>;
    upload?: (file: File) => Promise<Asset>;
};

export type CanvasThemeMode = "light" | "dark";

export type CanvasThemeTokens = Partial<{
    surface: string;
    surfaceRaised: string;
    surfaceSunken: string;
    border: string;
    borderStrong: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    accentText: string;
    danger: string;
    success: string;
    gridDot: string;
    gridLine: string;
    shadow: string;
    edge: string;
    edgeActive: string;
}>;

export type CanvasTheme = {
    mode: CanvasThemeMode;
    tokens?: CanvasThemeTokens;
};

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export type CanvasLocale = {
    lang: "zh-CN" | "en-US";
    messages?: Record<string, string>;
};

export type CanvasProfile = "full" | "generator";

export type CanvasShell = {
    /** Left navigation rail. */
    rail: boolean;
    topBar: boolean;
    composer: boolean;
    minimap: boolean;
    zoomControls: boolean;
};

/** Overrides for the profile defaults and individual workspace controls. */
export type CanvasShellOptions = Partial<CanvasShell> & {
    showTitle?: boolean;
    showHistory?: boolean;
    showUndo?: boolean;
    showRedo?: boolean;
    showThemeToggle?: boolean;
    showLanguageToggle?: boolean;
    showNodes?: boolean;
    showAssets?: boolean;
    showImport?: boolean;
    showExport?: boolean;
    showSettings?: boolean;
};

export type NodeCapabilities = {
    canGenerate: boolean;
    generateKind?: "image" | "video" | "text";
    acceptsReference: boolean;
    providesReference: boolean;
    canConnect: boolean;
    canBeGrouped: boolean;
};

export type NodeRenderContext = {
    node: CanvasNode;
    selected: boolean;
    zoom: number;
    t: Translate;
    theme: { mode: CanvasThemeMode; color: (token: keyof CanvasThemeTokens | string) => string };
    updateData: (patch: Record<string, unknown>) => void;
    run: (source: "generate" | "edit") => void;
    selectedAssetId?: string;
    selectAsset: (assetId: string) => void;
};

export type NodeDefinition = {
    type: string;
    version: number;
    labelKey: string;
    capabilities: NodeCapabilities;
    defaultSize: { width: number; height: number };
    minSize?: { width: number; height: number };
    resizable: boolean;
    aspectLocked: boolean;
    createData: (seed?: Record<string, unknown>) => NodeData;
    render?: ComponentType<NodeRenderContext>;
    minimapColor?: string;
};

// ---------------------------------------------------------------------------
// Public configuration surface
// ---------------------------------------------------------------------------

export type CanvasConfig = {
    producer: CanvasProducer;
    models: ModelInfo[];
    defaultRatio?: AspectRatio;
    defaultQuality?: Quality;
    defaultModels?: Partial<Record<"text" | "image" | "video", string>>;
    renderAssetLibrary?: (lang: CanvasLocale["lang"], onSelect?: (asset: Asset) => void) => ReactNode;
    renderSettings?: (lang: CanvasLocale["lang"]) => ReactNode;
    /** Persist key owned by the host; the canvas itself never writes storage. */
    persistKey?: string | null;
    /** Called on every committed document change so the host can persist or sync. */
    restoreImportedAssets?: (doc: CanvasDocument) => Promise<CanvasDocument>;
    onDocumentChange?: (doc: CanvasDocument) => void;
    /** Host hook for the node info action; the canvas has no inspector of its own. */
    onInspect?: (nodeId: string, detail: string) => void;
};

export type CanvasTool = "select" | "pan";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
