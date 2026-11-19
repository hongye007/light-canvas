import type { Asset } from "../types";

export async function readMediaMetadata(asset: Asset, signal?: AbortSignal): Promise<Asset> {
    if ((asset.width && asset.height) || signal?.aborted) return asset;
    const image = asset.kind === "image" ? new Image() : null;
    const video = image ? null : document.createElement("video");
    if (video) video.preload = "metadata";
    const element = image ?? video!;

    return new Promise((resolve) => {
        const finish = (result: Asset) => {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", fallback);
            element.onload = null;
            element.onerror = null;
            if (video) video.onloadedmetadata = null;
            element.removeAttribute("src");
            video?.load();
            resolve(result);
        };
        const fallback = () => finish(asset);
        const timer = window.setTimeout(fallback, 10_000);
        signal?.addEventListener("abort", fallback, { once: true });
        element.onerror = fallback;
        if (image) {
            image.onload = () => finish({ ...asset, width: image.naturalWidth, height: image.naturalHeight });
        } else if (video) {
            video.onloadedmetadata = () => finish({
                ...asset, width: video.videoWidth, height: video.videoHeight,
                durationSec: Number.isFinite(video.duration) ? video.duration : asset.durationSec,
            });
        }
        element.src = asset.url;
    });
}
