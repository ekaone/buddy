import { useCallback, useEffect, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { useBuddyStore } from "./store"
import { runPipeline, type Region } from "./pipeline"
import { isConfigured, type Config } from "./config"
import Overlay from "./components/Overlay"
import Settings from "./Settings"

export default function App() {
  const status        = useBuddyStore((s) => s.status)
  const setStatus     = useBuddyStore((s) => s.setStatus)
  const setTranscript = useBuddyStore((s) => s.setTranscript)
  const controllerRef = useRef<AbortController | null>(null)
  const hideTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // null = still checking, false = needs setup, true = ready
  const [configured, setConfigured] = useState<boolean | null>(null)

  // Check config on mount — show Settings if keys are missing
  useEffect(() => {
    isConfigured().then(setConfigured)
  }, [])

  // ── Auto-show / auto-hide overlay based on pipeline status ──────────────
  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (status !== "idle" && status !== "error") {
      invoke("show_overlay")
    } else {
      hideTimerRef.current = setTimeout(() => invoke("hide_overlay"), 4000)
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [status])

  // ── Stop: abort pipeline, reset state, hide overlay immediately ─────────
  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    setStatus("idle")
    setTranscript("")
    invoke("hide_overlay")
  }, [setStatus, setTranscript])

  // Esc key on the overlay window → stop & dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleStop() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleStop])

  // ── Pipeline runner ──────────────────────────────────────────────────────
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

  // ── Event listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    const unlistenTrigger = listen("buddy:trigger", async () => {
      // If not configured yet, show the settings window instead
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

    return () => {
      Promise.all([unlistenTrigger, unlistenRegion, unlistenCancel])
        .then((fns) => fns.forEach((fn) => fn()))
      controllerRef.current?.abort()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Still loading config
  if (configured === null) return null

  // First-run: show settings
  if (configured === false) {
    return (
      <Settings
        initial={{}}
        onSave={(_cfg: Config) => setConfigured(true)}
      />
    )
  }

  return <Overlay onStop={handleStop} />
}
