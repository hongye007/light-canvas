import { ChevronDown } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AspectRatio, GenerationParams, ModelInfo, Quality } from "../types";
import { useCanvasStore } from "../store/canvas-store";
import { useCanvasContext } from "./context";

export const MEDIA_RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const VIDEO_RESOLUTIONS = ["480P", "720P", "1080P"];
const QUALITIES: Quality[] = ["draft", "standard", "high"];

function RatioIcon({ ratio }: { ratio: AspectRatio }) {
    const [width, height] = ratio.split(":").map(Number);
    const scale = 16 / Math.max(width, height);
    return <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
        <rect x={(18 - width * scale) / 2} y={(18 - height * scale) / 2} width={width * scale}
            height={height * scale} rx={2.5} fill="none" stroke="currentColor" strokeWidth={1.25} />
    </svg>;
}

export function MediaSettings({ video, ratios, counts, duration, resolutions, audio, transparency, params, onChange }: {
    video: boolean;
    ratios: AspectRatio[];
    counts: number[];
    duration?: ModelInfo["videoDuration"];
    resolutions?: string[];
    audio: boolean;
    transparency: boolean;
    params: GenerationParams;
    onChange: (patch: Partial<GenerationParams>) => void;
}) {
    const { t } = useCanvasContext();
    const [open, setOpen] = useState(false);
    const viewport = useCanvasStore((state) => open ? state.doc.viewport : null);
    const [position, setPosition] = useState<CSSProperties>();
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const id = useId();
    const label = t("composer.mediaSettings");

    const place = useCallback(() => {
        const rect = trigger.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(320, window.innerWidth - 16);
        const above = rect.top - 14;
        const below = window.innerHeight - rect.bottom - 14;
        const upwards = above >= Math.min(panel.current?.scrollHeight ?? 235, 280) || above >= below;
        setPosition({
            width,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
            maxHeight: Math.max(0, upwards ? above : below),
            ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        });
    }, []);

    useLayoutEffect(() => {
        if (open) place();
    }, [open, place, viewport]);

    useLayoutEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
        };
        const scroll = (event: Event) => {
            if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) place();
        };
        const observer = new ResizeObserver(place);
        if (trigger.current) observer.observe(trigger.current);
        document.addEventListener("pointerdown", outside, true);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", scroll, true);
        return () => {
            observer.disconnect();
            document.removeEventListener("pointerdown", outside, true);
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", scroll, true);
        };
    }, [open, place]);

    const positioned = Boolean(position);
    useLayoutEffect(() => {
        if (open && positioned) panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true });
    }, [open, positioned]);

    const host = trigger.current?.closest(".mf-root");
    const summaries = video
        ? [params.resolution, params.durationSec && `${params.durationSec}s`, audio && t(params.generateAudio ? "composer.audioOn" : "composer.audioOff")].filter((item): item is string => typeof item === "string")
        : [t(`composer.quality.${params.quality}`), `×${params.count}`, ...(params.transparentBackground ? [t("composer.field.transparent")] : [])];

    return <>
        <button type="button" ref={trigger} className="mf-choice-trigger mf-media-settings-trigger"
            aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
                if (event.key !== "Escape" || !open) return;
                event.stopPropagation();
                setOpen(false);
            }}>
            <span className="mf-media-summary">
                <span><RatioIcon ratio={params.ratio} />{params.ratio}</span>
                {summaries.map((item) => <span key={item}>{item}</span>)}
            </span>
            <ChevronDown size={13} aria-hidden />
        </button>
        {open && host && createPortal(
            <div className="mf-media-settings" ref={panel} id={id} role="dialog" aria-label={label} style={position ?? { visibility: "hidden" }}
                data-canvas-no-pan data-canvas-ignore-wheel
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    setOpen(false);
                    trigger.current?.focus();
                }}>
                <fieldset>
                    <legend>{t("composer.field.ratio")}</legend>
                    <div className="mf-media-options mf-media-ratios">
                        {ratios.map((ratio) => <button type="button" key={ratio} aria-pressed={params.ratio === ratio}
                            onClick={() => onChange({ ratio })}><RatioIcon ratio={ratio} />{ratio}</button>)}
                    </div>
                </fieldset>
                {!video && <fieldset>
                    <legend>{t("composer.field.quality")}</legend>
                    <div className="mf-media-options">
                        {QUALITIES.map((quality) => <button type="button" key={quality} aria-pressed={params.quality === quality}
                            onClick={() => onChange({ quality })}>{t(`composer.quality.${quality}`)}</button>)}
                    </div>
                </fieldset>}
                {video && resolutions && resolutions.length > 0 && <fieldset>
                    <legend>{t("composer.field.resolution")}</legend>
                    <div className="mf-media-options">
                        {VIDEO_RESOLUTIONS.map((resolution) => <button type="button" key={resolution}
                            disabled={!resolutions.includes(resolution)} aria-pressed={params.resolution === resolution}
                            title={!resolutions.includes(resolution) ? t("composer.optionUnavailable") : undefined}
                            onClick={() => onChange({ resolution })}>{resolution}</button>)}
                    </div>
                </fieldset>}
                {video && duration && <label className="mf-media-duration">
                    <span>{t("composer.field.duration")} <output>{params.durationSec}s</output></span>
                    <input type="range" min={duration.min} max={duration.max} step={1} value={params.durationSec}
                        onChange={(event) => onChange({ durationSec: event.currentTarget.valueAsNumber })} />
                </label>}
                <label className="mf-media-toggle" title={!(video ? audio : transparency) ? t("composer.optionUnavailable") : undefined}>
                    <span>{t(video ? "composer.field.audio" : "composer.field.transparent")}</span>
                    <input type="checkbox" role="switch" disabled={!(video ? audio : transparency)}
                        checked={Boolean(video ? params.generateAudio : params.transparentBackground)}
                        onChange={(event) => onChange(video ? { generateAudio: event.currentTarget.checked }
                            : { transparentBackground: event.currentTarget.checked })} />
                    {!(video ? audio : transparency) && <small>{t("composer.optionUnavailable")}</small>}
                </label>
                {(!video || counts.length > 1) && <fieldset>
                    <legend>{t("composer.field.count")}</legend>
                    <div className="mf-media-options">
                        {counts.map((count) => <button type="button" key={count} aria-pressed={params.count === count}
                            onClick={() => onChange({ count })}>×{count}</button>)}
                    </div>
                </fieldset>}
            </div>, host)}
    </>;
}
