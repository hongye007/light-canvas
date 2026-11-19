import { useCallback } from "react";
import { create } from "zustand";

/**
 * Live connection drag, kept outside React state so the preview follows the pointer
 * at pointer rate while node components never re-render.
 */
import type { PortSide } from "../types";

export type ConnectDraft = {
    sourceId: string;
    sourcePort: PortSide;
    /** World position of the source port. */
    start: { x: number; y: number };
    /** Pointer in world space (already snapped to a port when one is near). */
    point: { x: number; y: number };
    /** Node under the pointer, if any (already excludes the source). */
    targetId: string | null;
    /** Port the connection would land on. */
    targetPort: PortSide | null;
    /** True when the endpoint is magnetically attached to a port. */
    magnetized: boolean;
};

type ConnectState = {
    draft: ConnectDraft | null;
    begin: (draft: ConnectDraft) => void;
    update: (patch: Partial<ConnectDraft>) => void;
    end: () => ConnectDraft | null;
};

export const useConnectStore = create<ConnectState>((set, get) => ({
    draft: null,
    begin: (draft) => set({ draft }),
    update: (patch) => set((state) => (state.draft ? { draft: { ...state.draft, ...patch } } : {})),
    end: () => {
        const draft = get().draft;
        set({ draft: null });
        return draft;
    },
}));

/** Subscribe to just the draft; components that need it re-render per pointer move. */
export function useConnectDraft() {
    return useConnectStore((state) => state.draft);
}

export function useConnectDraftHasTarget(targetId: string) {
    const draft = useConnectDraft();
    return draft?.targetId === targetId;
}

/** Small helper for imperative reads outside React. */
export function readConnectDraft() {
    return useConnectStore.getState().draft;
}

export function useConnectApi() {
    const begin = useConnectStore((state) => state.begin);
    const update = useConnectStore((state) => state.update);
    const end = useConnectStore((state) => state.end);
    const cancel = useCallback(() => useConnectStore.setState({ draft: null }), []);
    return { begin, update, end, cancel };
}
