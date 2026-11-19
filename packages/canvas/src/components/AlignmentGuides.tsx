import { create } from "zustand";
import type { AlignmentGuide } from "../lib/hit-testing";

type GuideState = {
    guides: AlignmentGuide[];
    set: (guides: AlignmentGuide[]) => void;
    clear: () => void;
};

/**
 * Alignment guides live outside React state so a drag can publish them at pointer
 * rate without re-rendering the node tree.
 */
export const useAlignmentGuides = create<GuideState>((set) => ({
    guides: [],
    set: (guides) => set({ guides }),
    clear: () => set({ guides: [] }),
}));

export function AlignmentGuides() {
    const guides = useAlignmentGuides((state) => state.guides);
    if (!guides.length) return null;
    return (
        <svg className="mf-guides" aria-hidden>
            {guides.map((guide, index) =>
                guide.orientation === "vertical" ? (
                    <line key={`v${index}`} x1={guide.at} y1={guide.from} x2={guide.at} y2={guide.to} className="mf-guide" />
                ) : (
                    <line key={`h${index}`} x1={guide.from} y1={guide.at} x2={guide.to} y2={guide.at} className="mf-guide" />
                ),
            )}
        </svg>
    );
}
