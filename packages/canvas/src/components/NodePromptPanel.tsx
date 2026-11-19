import { MediaSettings, MEDIA_RATIOS } from "./MediaSettings";
import { removeReferenceMentions } from "../lib/mentions";
import { mentionChip, promptSelection, promptText, replacePromptMention, syncPromptEditor } from "./prompt-editor";
import { ReferencePicker } from "./ReferencePicker";
import { nodeRect, rectsIntersect } from "../lib/geometry";
import { readMediaMetadata } from "../ai/media-metadata";
import { ChoiceSelect } from "./ChoiceSelect";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Image as ImageIcon, Loader2, Play, Plus, Square, X } from "lucide-react";
import { IMAGE_ASSET_DRAG_TYPE, type Asset, type CanvasDocument, type CanvasNode, type Quality, type VideoReferenceMode } from "../types";
import { useCanvasContext } from "./context";
import { useCanvasStore } from "../store/canvas-store";
import { activeMediaAsset, addNode, connect, createMediaNode, disconnect, getNode, MEDIA_REFERENCE_LIMIT, patchNodeData, remainingReferenceSlots, resizeNodeToAsset, updateNode } from "../lib/document";
import { cancelGeneration, collectReferences, generateForNode } from "../ai/use-node-runtime";

function linkedPrompt(prompt: string, doc: CanvasDocument, nodeId: string) {
    const sources = new Set(doc.edges.filter((edge) => edge.to === nodeId).map((edge) => encodeURIComponent(edge.from)));
    return removeReferenceMentions(prompt, (id) => !sources.has(id));
}

const PANEL_WIDTH = 380;
const VIDEO_PANEL_WIDTH = 420;
const PANEL_GAP = 16;

/**
 * Prompt panel anchored under the selected node card.
 *
 * It is rendered inside the world transform container, so it moves and scales with
 * its node like the reference workbench, and it keeps the prompt next to the thing
 * it describes instead of in a detached bottom bar.
 */
export function NodePromptPanel({
    node,
    canvasSize,
    focusRequest,
    onPromptFocused,
    moving,
    onReferenceEdgeChange,
}: {
    node: CanvasNode;
    canvasSize: { width: number; height: number };
    moving: boolean;
    focusRequest: boolean;
    onPromptFocused: (request: null) => void;
    onReferenceEdgeChange: (edgeId: string | null) => void;
}) {
    const { t, config, registry, tokens, toast } = useCanvasContext();
    const store = useCanvasStore();
    const doc = useCanvasStore((state) => state.doc);
    const runtime = useCanvasStore((state) => state.runtime[node.id]);

    const data = node.data;
    const isText = data.type === "text";
    const savedPrompt = "prompt" in data && typeof data.prompt === "string" ? data.prompt : "";
    const isVideo = data.type === "video";
    const models = config.models.filter((model) =>
        model.capabilities.some((capability) => capability === data.type),
    );

    const [draft, setDraft] = useState(savedPrompt);
    const ratio = (data.type === "image" || data.type === "video" ? data.generationRatio : undefined)
        ?? (isVideo ? "16:9" : config.defaultRatio ?? "1:1");
    const [quality, setQuality] = useState<Quality>(config.defaultQuality ?? "standard");
    const [count, setCount] = useState(1);
    const [transparentBackground, setTransparentBackground] = useState(false);
    const [videoMode, setVideoMode] = useState<VideoReferenceMode>("reference");
    const [resolution, setResolution] = useState("");
    const [generateAudio, setGenerateAudio] = useState<boolean>();
    const [durationSec, setDurationSec] = useState<number>();
    const [modelId, setModelId] = useState("");
    const lastDraft = useRef({ prompt: savedPrompt, dirty: false });
    const currentPrompt = lastDraft.current.dirty ? draft : savedPrompt;
    const prompt = linkedPrompt(currentPrompt, doc, node.id);
    const changePrompt = (value: string) => {
        lastDraft.current = { prompt: value, dirty: true };
        setDraft(value);
    };
    const persistDraft = (docId: string, nodeId: string) => {
        const draft = lastDraft.current;
        if (!draft.dirty) return;
        lastDraft.current = { ...draft, dirty: false };
        useCanvasStore.getState().commit((prev) => {
            if (prev.id !== docId) return prev;
            const data = prev.nodes.find((item) => item.id === nodeId)?.data;
            const prompt = linkedPrompt(draft.prompt, prev, nodeId);
            return data && (data.type === "text" || data.type === "image" || data.type === "video") && (data.prompt ?? "") !== prompt
                ? patchNodeData(prev, nodeId, { prompt }) : prev;
        });
    };
    useEffect(() => () => persistDraft(doc.id, node.id), [doc.id, node.id]);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelHeight, setPanelHeight] = useState(200);
    const editorRef = useRef<HTMLDivElement>(null);
    const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
    const closeReferencePicker = useCallback(() => setMention(null), []);

    const updateMention = (input: HTMLDivElement) => {
        const prefix = promptSelection(input);
        const end = prefix?.length ?? 0;
        const match = prefix?.match(/@([^@\s\[\]()]{0,40})$/);
        setMention(match ? { start: end - match[0].length, end, query: match[1].toLowerCase() } : null);
    };

    useLayoutEffect(() => {
        if (prompt === currentPrompt) return;
        closeReferencePicker();
        if (lastDraft.current.dirty) changePrompt(prompt);
    }, [prompt, currentPrompt, closeReferencePicker]);

    useEffect(() => {
        if (!focusRequest) return;
        editorRef.current?.focus({ preventScroll: true });
        onPromptFocused(null);
    }, [focusRequest, onPromptFocused]);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const observer = new ResizeObserver(() => setPanelHeight(Math.max(panel.offsetHeight, panel.scrollHeight + 2)));
        observer.observe(panel);
        return () => observer.disconnect();
    }, []);

    const [receivingImage, setReceivingImage] = useState(false);
    const referenceInput = useRef<HTMLInputElement>(null);

    const slots = remainingReferenceSlots(doc, node);
    const limitMessage = t("panel.referenceLimit", { count: MEDIA_REFERENCE_LIMIT });

    function acceptsImage(transfer: DataTransfer) {
        return transfer.types.includes(IMAGE_ASSET_DRAG_TYPE) ||
            (Boolean(config.producer.upload) && [...transfer.items].some((item) => item.kind === "file" && item.type.startsWith("image/")));
    }

    async function addReferenceImages(files: File[], encoded = "", onAdded?: (sourceId: string) => void) {
        const remaining = remainingReferenceSlots(useCanvasStore.getState().doc, node);
        if (!remaining) {
            toast(limitMessage);
            return;
        }
        try {
            const assets: Asset[] = [];
            if (encoded) {
                const candidate = JSON.parse(encoded) as Asset;
                if (candidate.kind === "image" && typeof candidate.id === "string" &&
                    typeof candidate.url === "string" && /^(https?:\/\/|blob:|data:image\/)/i.test(candidate.url)) {
                    let url = candidate.url;
                    if (url.startsWith("blob:")) {
                        const response = await fetch(url);
                        if (!response.ok) throw new Error(t("error.unknown"));
                        url = URL.createObjectURL(await response.blob());
                    }
                    assets.push({ ...candidate, url });
                }
            }
            const images = files.filter((file) => file.type.startsWith("image/"));
            if (images.length + assets.length > remaining) toast(limitMessage);
            const upload = config.producer.upload;
            if (upload) assets.push(...await Promise.all(images.slice(0, remaining - assets.length).map((file) => upload(file))));
            const references = await Promise.all(assets.map((asset) => readMediaMetadata(asset)));
            if (!references.length) return;
            const addedIds: string[] = [];
            useCanvasStore.getState().commit((prev) => {
                const target = getNode(prev, node.id);
                if (prev.id !== doc.id || !target) return prev;
                return references.slice(0, remainingReferenceSlots(prev, target)).reduce((next, asset) => {
                    const source = createMediaNode("image", target.position);
                    source.data = { type: "image", assets: [asset], activeAssetId: asset.id, prompt: "", status: "success", contentOnly: true };
                    const sized = resizeNodeToAsset(addNode(next, source), source.id, asset);
                    const bounds = nodeRect(getNode(sized, source.id) ?? source);
                    const position = { x: target.position.x - bounds.width - 48, y: target.position.y };
                    const occupied = next.nodes.filter((item) => item.type !== "group").map(nodeRect);
                    for (const rect of occupied.sort((a, b) => a.y - b.y)) {
                        if (rectsIntersect({ ...bounds, ...position }, rect)) position.y = rect.y + rect.height + 24;
                    }
                    const connected = connect(updateNode(sized, source.id, { position }), source.id, target.id);
                    if (connected.edges.length > next.edges.length) addedIds.push(source.id);
                    return connected;
                }, prev);
            });
            if (addedIds[0]) onAdded?.(addedIds[0]);
        } catch (error) {
            toast(error instanceof Error ? error.message : t("error.unknown"), "error");
        }
    }

    const running = runtime?.status === "running";
    const references = collectReferences(doc, node.id);
    const incoming = doc.edges.filter((edge) => edge.to === node.id);
    const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
    const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
    const highlight = hoveredEdge ?? selectedEdge;
    const activeEdge = incoming.some((edge) => edge.id === highlight) ? highlight : null;

    useEffect(() => {
        onReferenceEdgeChange(activeEdge);
        return () => onReferenceEdgeChange(null);
    }, [activeEdge, onReferenceEdgeChange]);

    const getPreview = (label: string, encodedId: string) => {
        const source = doc.nodes.find((item) => encodeURIComponent(item.id) === encodedId);
        const data = source?.data;
        const image = data?.type === "image"
            ? activeMediaAsset(data)
            : undefined;
        return {
            label: source ? source.title || t(registry.get(source.type)?.labelKey ?? `node.${source.type}.label`) : label,
            kind: data?.type ?? "text",
            thumbnail: image?.url,
        };
    };

    useLayoutEffect(() => {
        if (editorRef.current) syncPromptEditor(editorRef.current, prompt, getPreview);
    });

    const insertMention = (sourceId: string, name: string) => {
        const editor = editorRef.current;
        if (!mention || !editor) return;
        const label = name.replace(/[\]\n]/g, " ").trim() || t("panel.references");
        const id = encodeURIComponent(sourceId);
        const token = `@[${label}](${id})`;
        const chip = mentionChip(token, getPreview(label, id));
        if (!replacePromptMention(editor, mention.start, mention.end, chip)) return;
        changePrompt(promptText(editor));
        closeReferencePicker();
        const edge = useCanvasStore.getState().doc.edges.find((item) => item.from === sourceId && item.to === node.id);
        setSelectedEdge(edge?.id ?? null);
    };

    const defaultModel = data.type === "text" || data.type === "image" || data.type === "video" ? config.defaultModels?.[data.type] : undefined;
    const selectedModel = models.find((model) => model.id === modelId)
        ?? models.find((model) => model.id === defaultModel) ?? models[0];
    const ratios = MEDIA_RATIOS.filter((option) => selectedModel?.ratios?.includes(option) ?? true);
    const selectedRatio = ratios.includes(ratio) ? ratio : ratios[0] ?? MEDIA_RATIOS[0];
    const counts = selectedModel?.counts ?? (isVideo ? [1] : [1, 2, 4]);
    const selectedCount = counts.includes(count) ? count : counts[0] ?? 1;
    const modes = isVideo ? selectedModel?.videoReferenceModes : undefined;
    const mode = modes?.includes(videoMode) ? videoMode : modes?.[0];
    const keyframe = mode === "keyframe";
    const directImages = incoming.filter((edge) => references.some((ref) => ref.nodeId === edge.from && ref.kind === "image"));
    const duration = isVideo ? selectedModel?.videoDuration : undefined;
    const resolutions = isVideo ? selectedModel?.videoResolutions : undefined;
    const audio = isVideo ? selectedModel?.videoAudio : undefined;
    const transparency = !isVideo && !isText && Boolean(selectedModel?.transparentBackground);
    const params = {
        ratio: selectedRatio, quality, count: selectedCount,
        ...(transparency && transparentBackground ? { transparentBackground: true } : {}),
        ...(resolutions?.length ? { resolution: resolutions.includes(resolution) ? resolution : resolutions[0] } : {}),
        ...(mode ? { videoReferenceMode: mode } : {}),
        ...(audio ? { generateAudio: generateAudio ?? audio.default } : {}),
        ...(duration ? { durationSec: Math.max(duration.min, Math.min(duration.max, durationSec ?? duration.default)) } : {}),
    };
    const unavailable = !selectedModel || (isText && !config.producer.generateText);
    const hasTextReference = references.some((reference) => reference.kind === "text" && Boolean(reference.text?.trim()));
    const hasMediaReference = mode === "reference" && references.some((ref) => ref.kind !== "text");
    const hasPrompt = Boolean(prompt.trim()) || hasTextReference || hasMediaReference || (isText && references.length > 0);
    const validFrames = directImages.length >= 1 && directImages.length <= 2;
    const canSubmit = !unavailable && (isText || ratios.length > 0) && (keyframe ? validFrames : hasPrompt);

    const submit = () => {
        if (running || !canSubmit) return;
        if (isText && prompt !== savedPrompt) {
            store.commit((prev) => patchNodeData(prev, node.id, { prompt }));
        }
        void generateForNode({
            nodeId: node.id,
            producer: config.producer,
            model: selectedModel?.id ?? "",
            prompt: prompt.trim(),
            params,
        });
    };

    const { x, y, k: zoom } = doc.viewport;
    const scale = Math.min(Math.max(1 / zoom, 0.62), 1.35);
    const screenScale = zoom * scale;
    const margin = 12;
    const width = Math.min(isVideo ? VIDEO_PANEL_WIDTH : PANEL_WIDTH, Math.max(1, canvasSize.width - 2 * margin) / screenScale);
    const center = (node.position.x + node.width / 2) * zoom + x;
    const nodeLeft = node.position.x * zoom + x;
    const nodeRight = (node.position.x + node.width) * zoom + x;
    const nodeTop = node.position.y * zoom + y;
    const nodeBottom = (node.position.y + node.height) * zoom + y;
    const gap = PANEL_GAP * zoom;
    const below = Math.max(margin, nodeBottom + gap);
    const above = Math.min(canvasSize.height - margin, nodeTop - gap);
    const belowSpace = Math.max(0, canvasSize.height - margin - below);
    const aboveSpace = Math.max(0, above - margin);
    const panelPixels = panelHeight * screenScale;
    const useAbove = belowSpace < panelPixels && aboveSpace > belowSpace;
    const useSide = Math.max(belowSpace, aboveSpace) < panelPixels &&
        (canvasSize.width - margin - nodeRight - gap >= width * screenScale || nodeLeft - gap - margin >= width * screenScale);
    const available = useSide ? canvasSize.height - 2 * margin : useAbove ? aboveSpace : belowSpace;
    const centeredLeft = Math.max(margin, Math.min(center - width * screenScale / 2, canvasSize.width - margin - width * screenScale));
    const left = !useSide ? centeredLeft : canvasSize.width - margin - nodeRight - gap >= width * screenScale
        ? Math.max(margin, nodeRight + gap)
        : Math.min(canvasSize.width - margin, nodeLeft - gap) - width * screenScale;
    const top = useSide ? Math.max(margin, Math.min(nodeTop, canvasSize.height - margin - panelPixels))
        : useAbove ? Math.max(margin, above - panelPixels) : below;
    const connectorX = (center - left) / screenScale;

    return (
        <div
            ref={panelRef}
            className="mf-node-panel"
            data-video-panel={isVideo || undefined}
            data-canvas-no-pan
            data-canvas-ignore-wheel
            data-receiving-image={receivingImage || undefined}
            onDragOver={(event) => {
                if (!acceptsImage(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = slots > 0 ? "copy" : "none";
                setReceivingImage(slots > 0);
            }}
            onDragLeave={(event) => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setReceivingImage(false);
            }}
            onDrop={(event) => {
                setReceivingImage(false);
                if (!acceptsImage(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                void addReferenceImages([...event.dataTransfer.files], event.dataTransfer.getData(IMAGE_ASSET_DRAG_TYPE));
            }}
            style={{
                left: (left - x) / zoom,
                top: (top - y) / zoom,
                width,
                maxHeight: Math.max(1, available) / screenScale,
                overflowY: panelPixels >= available ? "auto" : undefined,
                visibility: moving || available < 60 ? "hidden" : undefined,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                "--mf-accent": tokens.accent,
            } as React.CSSProperties}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
        >
            {!useSide && panelPixels <= available && connectorX > 0 && connectorX < width && (
                <svg
                    className="mf-panel-connector"
                    width={2}
                    height={PANEL_GAP / scale}
                    style={{ left: connectorX, ...(useAbove ? { top: "100%" } : { bottom: "100%" }) }}
                >
                    <line x1={1} y1={0} x2={1} y2={PANEL_GAP / scale} />
                </svg>
            )}

            <div className="mf-panel-head">
                <span className="mf-panel-title">{t("panel.references")}</span>
                <button
                    type="button"
                    className="mf-icon-btn"
                    title={t("panel.close")}
                    onClick={() => {
                        store.clearSelection();
                    }}
                >
                    <X size={13} />
                </button>
            </div>

            {(incoming.length > 0 || !isText) && (
                <div className="mf-panel-refs" data-video-mode={mode}>
                    {incoming.map((edge) => {
                        const source = doc.nodes.find((item) => item.id === edge.from);
                        if (!source) return null;
                        const reference = references.find((item) => item.nodeId === source.id);
                        const thumbnail = reference?.kind === "image" ? reference.url : undefined;
                        const Icon = source.data.type === "text" ? FileText : source.data.type === "video" ? Play : ImageIcon;
                        const label = source.title || t(`node.${source.type}.label`);
                        const selected = selectedEdge === edge.id;
                        const frameIndex = directImages.indexOf(edge);
                        const caption = !mode ? undefined : keyframe && frameIndex >= 0
                            ? t(frameIndex === 0 ? "panel.firstFrame" : frameIndex === 1 ? "panel.lastFrame" : "panel.extraFrame")
                            : t(`node.${source.type}.label`);
                        const removeLabel = t("panel.removeReference", { name: label });

                        return (
                            <div
                                key={edge.id}
                                className="mf-ref-item"
                                onPointerEnter={() => setHoveredEdge(edge.id)}
                                onPointerLeave={() => setHoveredEdge(null)}
                            >
                                <button
                                    type="button"
                                    className="mf-ref-chip"
                                    aria-label={label}
                                    aria-pressed={selected}
                                    data-active={activeEdge === edge.id || undefined}
                                    title={reference?.text || label}
                                    onClick={() => setSelectedEdge(selected ? null : edge.id)}
                                >
                                    <Icon size={16} aria-hidden />
                                    {thumbnail && <img key={thumbnail} src={thumbnail} alt="" draggable={false}
                                        onError={(event) => { event.currentTarget.hidden = true; }} />}
                                </button>
                                {caption && <span className="mf-ref-caption">{caption}</span>}
                                {selected && (
                                    <button
                                        type="button"
                                        className="mf-ref-remove"
                                        title={removeLabel}
                                        aria-label={removeLabel}
                                        onClick={() => {
                                            store.commit((prev) => disconnect(prev, edge.id));
                                            setSelectedEdge(null);
                                            setHoveredEdge(null);
                                        }}
                                    >
                                        <X size={11} aria-hidden />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    {!isText && <>
                        <button type="button" className="mf-ref-chip mf-ref-add" disabled={slots === 0 || !config.producer.upload}
                            aria-label={t("panel.addReference")} title={slots === 0 ? limitMessage : t("panel.addReference")}
                            onClick={() => referenceInput.current?.click()}>
                            <Plus size={17} aria-hidden />
                        </button>
                    </>}
                </div>
            )}

            {keyframe && !validFrames && <div className="mf-ref-caption">{t("panel.frameHint")}</div>}

            <input ref={referenceInput} type="file" accept="image/*" multiple hidden
                onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void addReferenceImages(files, "", mention ? (id) => insertMention(id, t("node.image.label")) : undefined);
                }} />

            {mention && !moving && editorRef.current && (
                <ReferencePicker
                    anchor={editorRef.current}
                    mentionStart={mention.start}
                    initialQuery={mention.query}
                    doc={doc}
                    target={node}
                    canAttach={slots > 0}
                    onClose={closeReferencePicker}
                    onSelect={(sourceId, label) => {
                        store.commit((prev) => connect(prev, sourceId, node.id));
                        if (useCanvasStore.getState().doc.edges.some((edge) => edge.from === sourceId && edge.to === node.id)) insertMention(sourceId, label);
                    }}
                    onAsset={(asset) => void addReferenceImages([], JSON.stringify(asset), (id) => insertMention(id, t("node.image.label")))}
                />
            )}

            <div
                ref={editorRef}
                className="mf-panel-input"
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label={t(isText ? "panel.textPlaceholder" : "panel.placeholder")}
                data-empty={prompt === "" || undefined}
                data-placeholder={t(isText ? "panel.textPlaceholder" : node.type === "video" ? "node.video.emptyHint" : "panel.placeholder")}
                onBlur={(event) => {
                    if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest(".mf-reference-picker")) {
                        persistDraft(doc.id, node.id);
                    }
                }}
                onInput={(event) => {
                    changePrompt(promptText(event.currentTarget));
                    if (!(event.nativeEvent as InputEvent).isComposing) updateMention(event.currentTarget);
                }}
                onCompositionEnd={(event) => updateMention(event.currentTarget)}
                onPaste={(event) => {
                    event.preventDefault();
                    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
                }}
                onDrop={(event) => {
                    if (!acceptsImage(event.dataTransfer)) event.preventDefault();
                }}
                onClick={(event) => updateMention(event.currentTarget)}
                onKeyUp={(event) => {
                    if (!mention && (event.key === "ArrowLeft" || event.key === "ArrowRight")) updateMention(event.currentTarget);
                }}
                onKeyDown={(event) => {
                    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === "Escape" && mention) {
                        event.stopPropagation();
                        setMention(null);
                        return;
                    }
                    if (event.key === "Escape") {
                        event.currentTarget.blur();
                        store.clearSelection();
                    }
                }}
            />

            <div className="mf-panel-foot">
                <div className="mf-panel-selects">
                    <div className="mf-panel-model">
                        <ChoiceSelect
                            label={t("composer.field.model")} value={selectedModel?.id ?? ""}
                            onChange={setModelId}
                            options={models.map((model) => ({ value: model.id, label: model.label }))}
                        />
                    </div>
                    {mode && modes && <ChoiceSelect label={t("composer.field.videoMode")} value={mode}
                        onChange={(value) => setVideoMode(value as VideoReferenceMode)}
                        options={modes.map((value) => ({ value, label: t(`composer.videoMode.${value}`) }))} />}
                    {!isText && ratios.length > 0 && <MediaSettings video={isVideo} ratios={ratios} counts={counts}
                        duration={duration} resolutions={resolutions} audio={Boolean(audio)} transparency={transparency} params={params} onChange={(patch) => {
                            if (patch.ratio !== undefined && patch.ratio !== ratio) {
                                store.commit((prev) => patchNodeData(prev, node.id, { generationRatio: patch.ratio }));
                            }
                            if (patch.quality !== undefined) setQuality(patch.quality);
                            if (patch.count !== undefined) setCount(patch.count);
                            if (patch.transparentBackground !== undefined) setTransparentBackground(patch.transparentBackground);
                            if (patch.resolution !== undefined) setResolution(patch.resolution);
                            if (patch.generateAudio !== undefined) setGenerateAudio(patch.generateAudio);
                            if (patch.durationSec !== undefined) setDurationSec(patch.durationSec);
                        }} />}
                </div>

                <button
                    type="button"
                    className={running ? "mf-panel-submit mf-panel-stop" : "mf-panel-submit"}
                    onClick={() => {
                        if (running) {
                            cancelGeneration(node.id);
                            return;
                        }
                        submit();
                    }}
                    disabled={!running && !canSubmit}
                    title={running ? t("composer.cancelHint") : t("composer.submit")}
                >
                    {running ? <Square size={13} /> : <ArrowUp size={15} />}
                </button>
            </div>

            {unavailable && <div role="status">{t(isText ? "panel.textUnavailable" : "error.noModel")}</div>}
            {isText && runtime?.status === "error" && <div className="mf-panel-error" role="alert">{runtime.error}</div>}
            {running && (
                <div className="mf-panel-progress">
                    <Loader2 size={11} className="mf-spin" />
                    <span>{isText ? t("node.status.running") : `${Math.round((runtime?.progress ?? 0) * 100)}%`}</span>
                </div>
            )}
        </div>
    );
}
