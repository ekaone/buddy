import { create } from "zustand"

// ── v0.1.0 — screenshot pipeline ─────────────────────────────────────────────

type Status = "idle" | "capturing" | "thinking" | "speaking" | "error"

// ── v0.2.0 — live transcript segment ─────────────────────────────────────────
// Keep the shape extensible: v0.3.0 will add a `translated` field.

export interface Segment {
  id:        string
  text:      string
  committed: boolean
}

const MAX_SEGMENTS = 500
const TRIM_BY      = 100

// ── Store ─────────────────────────────────────────────────────────────────────

interface BuddyStore {
  // v0.1.0
  status:      Status
  transcript:  string
  setStatus:   (s: Status) => void
  setTranscript: (t: string) => void

  // v0.2.0
  isCapturing:    boolean
  liveTranscript: Segment[]
  setCapturing:   (b: boolean) => void
  /** Add a new partial segment or replace an existing partial with a committed one. */
  upsertSegment:  (seg: Segment) => void
  clearLiveTranscript: () => void
}

export const useBuddyStore = create<BuddyStore>((set) => ({
  // v0.1.0
  status:      "idle",
  transcript:  "",
  setStatus:   (status)     => set({ status }),
  setTranscript: (transcript) => set({ transcript }),

  // v0.2.0
  isCapturing:    false,
  liveTranscript: [],

  setCapturing: (isCapturing) => set({ isCapturing }),

  upsertSegment: (seg) =>
    set((state) => {
      const segments = [...state.liveTranscript]

      if (seg.committed) {
        // Find the last non-committed segment and replace it, or append.
        const lastPartial = segments.findLastIndex((s: Segment) => !s.committed)
        if (lastPartial !== -1) {
          segments[lastPartial] = seg
        } else {
          segments.push(seg)
        }
      } else {
        // Always update/replace the last partial segment.
        const lastPartial = segments.findLastIndex((s: Segment) => !s.committed)
        if (lastPartial !== -1) {
          segments[lastPartial] = seg
        } else {
          segments.push(seg)
        }
      }

      // Trim oldest when over cap.
      if (segments.length > MAX_SEGMENTS) {
        segments.splice(0, TRIM_BY)
      }

      return { liveTranscript: segments }
    }),

  clearLiveTranscript: () => set({ liveTranscript: [] }),
}))
