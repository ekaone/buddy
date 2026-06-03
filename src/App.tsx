import { useCallback, useEffect, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { useBuddyStore } from "./store"
import { runPipeline, type Region } from "./pipeline"
import { isConfigured, type Config } from "./config"
import Overlay from "./components/Overlay"
import Settings from "./Settings"

export default function App() {
  const status           = useBuddyStore((s) => s.status)
  const setStatus        = useBuddyStore((s) => s.setStatus)
  const setTranscript    = useBuddyStore((s) => s.setTranscript)
  const isCapturing      = useBuddyStore((s) => s.isCapturing)
  const setCapturing     = useBuddyStore((s) => s.setCapturing)
  const upsertSegment    = useBuddyStore((s) => s.upsertSegment)
  const clearLiveTranscript = useBuddyStore((s) => s.clearLiveTranscript)

  const controllerRef  = useRef<AbortController | null>(null)
  const hideTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const captureIdRef   = useRef(0) // monotonic id for segment deduplication

  const [configured, setConfigured] = useState<boolean | null>(null)

  useEffect(() => { isConfigured().then(setConfigured) }, [])

  // ── Auto-show / auto-hide overlay based on v0.1.0 pipeline status ──────────
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (status !== "idle" && status !== "error") {
      invoke("show_overlay")
    } else {
      hideTimerRef.current = setTimeout(() => invoke("hide_overlay"), 4000)
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [status])

  // ── Stop v0.1.0 pipeline ────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    setStatus("idle")
    setTranscript("")
    invoke("hide_overlay")
  }, [setStatus, setTranscript])

  // Esc on overlay → stop pipeline
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleStop() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleStop])

  // ── v0.1.0 pipeline runner ──────────────────────────────────────────────────
  const startPipeline = (region: Region) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    runPipeline(
      (s) => setStatus(s as Parameters<typeof setStatus>[0]),
      setTranscript,
      controller.signal,
      region,
    ).catch((err) => {
      if (controller.signal.aborted) return
      console.error("Pipeline error:", err)
      setStatus("error")
    }).finally(() => {
      if (!controller.signal.aborted) controllerRef.current = null
    })
  }

  // ── v0.2.0 capture toggle ───────────────────────────────────────────────────
  const startCapture = useCallback(async () => {
    // Abort any running v0.1.0 pipeline first (Q7)
    handleStop()
    clearLiveTranscript()
    captureIdRef.current = 0

    try {
      await invoke("start_capture")
      setCapturing(true)
      await invoke("set_drawer_open", { open: true })
      await invoke("show_overlay")
    } catch (err) {
      console.error("start_capture failed:", err)
    }
  }, [handleStop, clearLiveTranscript, setCapturing])

  const stopCapture = useCallback(async () => {
    try {
      await invoke("stop_capture")
    } catch (_) { /* ignore */ }

    setCapturing(false)
    // "● REC stopped" state — Overlay reads isCapturing=false to show it.
    // After 3 s collapse back to compact card (Q12).
    setTimeout(async () => {
      clearLiveTranscript()
      await invoke("set_drawer_open", { open: false })
      await invoke("hide_overlay")
    }, 3000)
  }, [setCapturing, clearLiveTranscript])

  // ── Event listeners ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unlistenTrigger = listen("buddy:trigger", async () => {
      if (isCapturing) return // don't open selector while recording
      const ready = await isConfigured()
      if (!ready) { invoke("show_overlay"); setConfigured(false); return }
      controllerRef.current?.abort()
      setStatus("idle")
      await invoke("show_selector")
    })

    const unlistenRegion = listen<Region>("buddy:region", async (e) => {
      await invoke("hide_selector")
      startPipeline(e.payload)
    })

    const unlistenCancel = listen("buddy:cancel", async () => {
      await invoke("hide_selector")
    })

    // v0.2.0 — capture toggle hotkey (Ctrl+Shift+R)
    const unlistenCaptureToggle = listen("buddy:capture_toggle", async () => {
      const ready = await isConfigured()
      if (!ready) { invoke("show_overlay"); setConfigured(false); return }

      if (isCapturing) {
        stopCapture()
      } else {
        startCapture()
      }
    })

    // v0.2.0 — live transcript segments from Rust
    const unlistenTranscript = listen<{ text: string; committed: boolean }>(
      "buddy:transcript",
      (e) => {
        const { text, committed } = e.payload
        if (!text.trim()) return

        captureIdRef.current += committed ? 1 : 0
        upsertSegment({
          id:        committed
                       ? `c-${captureIdRef.current}`
                       : "partial",
          text,
          committed,
        })
      },
    )

    // v0.2.0 — capture errors from Rust
    const unlistenCaptureError = listen<string>("buddy:capture_error", (e) => {
      console.error("Capture error:", e.payload)
      stopCapture()
    })

    return () => {
      Promise.all([
        unlistenTrigger,
        unlistenRegion,
        unlistenCancel,
        unlistenCaptureToggle,
        unlistenTranscript,
        unlistenCaptureError,
      ]).then((fns) => fns.forEach((fn) => fn()))
      controllerRef.current?.abort()
    }
  }, [isCapturing, startCapture, stopCapture, upsertSegment]) // eslint-disable-line react-hooks/exhaustive-deps

  if (configured === null) return null

  if (configured === false) {
    return (
      <Settings
        initial={{}}
        onSave={(_cfg: Config) => setConfigured(true)}
      />
    )
  }

  return <Overlay onStop={handleStop} onStopCapture={stopCapture} />
}
