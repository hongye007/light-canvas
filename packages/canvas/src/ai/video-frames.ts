function waitForVideo(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted();
        const finish = (error?: unknown) => {
            window.clearTimeout(timeout);
            video.removeEventListener(event, ready);
            video.removeEventListener("error", failed);
            signal?.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error("Cannot decode the video reference. Check the source or upload a supported video."));
        const aborted = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        const timeout = window.setTimeout(() => finish(new Error("Timed out while reading the video reference.")), 15_000);
        video.addEventListener(event, ready, { once: true });
        video.addEventListener("error", failed, { once: true });
        signal?.addEventListener("abort", aborted, { once: true });
    });
}

/** Sample across the clip for image-capable chat models. */
export async function sampleVideoFrames(url: string, signal?: AbortSignal) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    try {
        const loaded = waitForVideo(video, "loadedmetadata", signal);
        video.src = url;
        await loaded;
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
            throw new Error("The video reference has no readable frames or finite duration.");
        }
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Cannot create a canvas to read video frames.");
        const frames: { timestamp: number; url: string }[] = [];
        for (const fraction of [0.08, 0.36, 0.64, 0.92]) {
            const timestamp = video.duration * fraction;
            if (video.currentTime !== timestamp || video.readyState < 2) {
                const seeked = waitForVideo(video, "seeked", signal);
                video.currentTime = timestamp;
                await seeked;
            }
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push({ timestamp, url: canvas.toDataURL("image/jpeg", 0.8) });
        }
        return frames;
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}
