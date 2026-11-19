import type { CanvasDocument } from "../types";
import { createEmptyDocument } from "./document";

/**
 * Immutable undo/redo over whole-document snapshots.
 *
 * Gesture model — this is what keeps "one drag = one undo":
 *
 *   beginGesture()   // remember the document as it was before the gesture
 *   updateGesture()  // repeated, per pointer move; never records history
 *   endGesture()     // record exactly one entry for the whole gesture
 *
 * Committing a single discrete change (`commit`) is begin + update + end collapsed.
 */
export class History {
    private past: CanvasDocument[] = [];
    private future: CanvasDocument[] = [];
    private present: CanvasDocument;
    private gestureBase: CanvasDocument | null = null;
    private limit: number;

    constructor(doc: CanvasDocument = createEmptyDocument(), options: { limit?: number } = {}) {
        this.present = doc;
        this.limit = options.limit ?? 200;
    }

    get current() {
        return this.present;
    }

    get canUndo() {
        return this.past.length > 0;
    }

    get canRedo() {
        return this.future.length > 0;
    }

    /** Replace the document wholesale. Clears history (loading a file, host reset). */
    reset(doc: CanvasDocument) {
        this.present = doc;
        this.past = [];
        this.future = [];
        this.gestureBase = null;
    }

    /** Record a discrete change as one undo entry. */
    commit(doc: CanvasDocument) {
        if (doc === this.present) return;
        this.past.push(this.present);
        if (this.past.length > this.limit) this.past.shift();
        this.present = doc;
        this.future = [];
    }

    beginGesture() {
        if (this.gestureBase) return;
        this.gestureBase = this.present;
    }

    /** Live update during a gesture; costs nothing in history. */
    updateGesture(doc: CanvasDocument) {
        if (!this.gestureBase) this.gestureBase = this.present;
        this.present = doc;
    }

    /** Record the gesture as a single entry; no-op when nothing actually changed. */
    endGesture(): CanvasDocument {
        const base = this.gestureBase;
        this.gestureBase = null;
        if (base && base !== this.present) {
            this.past.push(base);
            if (this.past.length > this.limit) this.past.shift();
            this.future = [];
        }
        return this.present;
    }

    /** Replace the present without touching history (viewport changes). */
    replace(doc: CanvasDocument) {
        const alreadyRecorded = this.present === doc;
        this.present = doc;
        if (alreadyRecorded && this.gestureBase === doc) this.gestureBase = doc;
    }

    undo(): CanvasDocument | null {
        const previous = this.past.pop();
        if (!previous) return null;
        this.future.push(this.present);
        this.present = previous;
        this.gestureBase = null;
        return this.present;
    }

    redo(): CanvasDocument | null {
        const next = this.future.pop();
        if (!next) return null;
        this.past.push(this.present);
        this.present = next;
        this.gestureBase = null;
        return this.present;
    }
}
