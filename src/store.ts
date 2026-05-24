import { create } from "zustand"

type Status = "idle" | "capturing" | "thinking" | "speaking" | "error"

interface BuddyStore {
  status: Status
  transcript: string
  setStatus: (s: Status) => void
  setTranscript: (t: string) => void
}

export const useBuddyStore = create<BuddyStore>((set) => ({
  status: "idle",
  transcript: "",
  setStatus: (status) => set({ status }),
  setTranscript: (transcript) => set({ transcript }),
}))
