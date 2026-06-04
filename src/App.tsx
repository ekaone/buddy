import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { Download, Eye, EyeOff, Trash2 } from "lucide-react"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { mermaid } from "@streamdown/mermaid"
import { math } from "@streamdown/math"
import { cjk } from "@streamdown/cjk"
import { useBuddyStore, type Segment } from "./store"
import { runPipeline, type Region } from "./pipeline"
import {
  deleteConfig,
  isConfigured,
  loadConfig,
  saveConfig,
  type Config,
} from "./config"

type SectionId = "config" | "transcription" | "capture"

const SECTION_COPY: Record<SectionId, { label: string; eyebrow: string }> = {
  config: {
    label: "API Keys and Configuration",
    eyebrow: "Local credentials",
  },
  transcription: {
    label: "Live Transcription",
    eyebrow: "Ctrl + Shift + R",
  },
  capture: {
    label: "Region Capture Output",
    eyebrow: "Ctrl + Shift + Space",
  },
}

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  capturing: "Capturing",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
}

const MARKDOWN_PLUGINS = { code, mermaid, math, cjk }

function exportStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-")
}

async function saveTextExport(defaultFilename: string, content: string) {
  return await invoke<string | null>("export_text_file", {
    defaultFilename,
    content,
  })
}

export default function App() {
  const status = useBuddyStore((s) => s.status)
  const setStatus = useBuddyStore((s) => s.setStatus)
  const transcript = useBuddyStore((s) => s.transcript)
  const setTranscript = useBuddyStore((s) => s.setTranscript)
  const isCapturing = useBuddyStore((s) => s.isCapturing)
  const setCapturing = useBuddyStore((s) => s.setCapturing)
  const liveTranscript = useBuddyStore((s) => s.liveTranscript)
  const upsertSegment = useBuddyStore((s) => s.upsertSegment)
  const finalizeLiveTranscript = useBuddyStore((s) => s.finalizeLiveTranscript)
  const clearLiveTranscript = useBuddyStore((s) => s.clearLiveTranscript)

  const controllerRef = useRef<AbortController | null>(null)
  const captureIdRef = useRef(0)

  const [activeSection, setActiveSection] = useState<SectionId>("capture")
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [config, setConfig] = useState<Partial<Config>>({})
  const [lastRegion, setLastRegion] = useState<Region | null>(null)
  const [captureError, setCaptureError] = useState("")

  useEffect(() => {
    Promise.all([isConfigured(), loadConfig()]).then(([ready, cfg]) => {
      setConfigured(ready)
      setConfig(cfg)
      if (!ready) setActiveSection("config")
    })
  }, [])

  const handleStop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus("idle")
  }, [setStatus])

  const clearRegionOutput = useCallback(() => {
    setTranscript("")
    setCaptureError("")
    setLastRegion(null)
  }, [setTranscript])

  const requestRegionCapture = useCallback(async () => {
    const ready = await isConfigured()
    if (!ready) {
      setConfigured(false)
      setActiveSection("config")
      await invoke("show_overlay")
      return
    }

    if (isCapturing) return

    controllerRef.current?.abort()
    setActiveSection("capture")
    setCaptureError("")
    setStatus("idle")
    await invoke("show_overlay")
    await invoke("show_selector")
  }, [isCapturing, setStatus])

  const startPipeline = useCallback(
    (region: Region) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setLastRegion(region)
      setActiveSection("capture")
      setCaptureError("")
      setTranscript("")

      runPipeline(
        (s) => setStatus(s as Parameters<typeof setStatus>[0]),
        setTranscript,
        controller.signal,
        region,
      )
        .catch((err) => {
          if (controller.signal.aborted) return
          console.error("Pipeline error:", err)
          setStatus("error")
          setCaptureError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!controller.signal.aborted) controllerRef.current = null
        })
    },
    [setStatus, setTranscript],
  )

  const startCapture = useCallback(async () => {
    handleStop()
    clearLiveTranscript()
    captureIdRef.current = 0
    setActiveSection("transcription")

    try {
      await invoke("show_overlay")
      await invoke("start_capture")
      setCapturing(true)
    } catch (err) {
      console.error("start_capture failed:", err)
    }
  }, [handleStop, clearLiveTranscript, setCapturing])

  const stopCapture = useCallback(async () => {
    try {
      await invoke("stop_capture")
    } catch (_) {
      /* ignore */
    } finally {
      finalizeLiveTranscript()
      setCapturing(false)
    }
  }, [finalizeLiveTranscript, setCapturing])

  const toggleCapture = useCallback(async () => {
    const ready = await isConfigured()
    if (!ready) {
      setConfigured(false)
      setActiveSection("config")
      await invoke("show_overlay")
      return
    }

    if (isCapturing) {
      stopCapture()
    } else {
      startCapture()
    }
  }, [isCapturing, startCapture, stopCapture])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleStop()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleStop])

  useEffect(() => {
    const unlistenTrigger = listen("buddy:trigger", requestRegionCapture)

    const unlistenRegion = listen<Region>("buddy:region", async (e) => {
      await invoke("hide_selector")
      await invoke("show_overlay")
      startPipeline(e.payload)
    })

    const unlistenCancel = listen("buddy:cancel", async () => {
      await invoke("hide_selector")
      await invoke("show_overlay")
    })

    const unlistenCaptureToggle = listen("buddy:capture_toggle", toggleCapture)

    const unlistenTranscript = listen<{ text: string; committed: boolean }>(
      "buddy:transcript",
      (e) => {
        const { text, committed } = e.payload
        if (!text.trim()) return

        captureIdRef.current += committed ? 1 : 0
        upsertSegment({
          id: committed ? `c-${captureIdRef.current}` : "partial",
          text,
          committed,
        })
      },
    )

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
  }, [
    requestRegionCapture,
    startPipeline,
    stopCapture,
    toggleCapture,
    upsertSegment,
  ])

  const transcriptStats = useMemo(() => {
    const committed = liveTranscript.filter((seg) => seg.committed)
    const wordCount = committed
      .map((seg) => seg.text.trim().split(/\s+/).filter(Boolean).length)
      .reduce((sum, count) => sum + count, 0)

    return {
      committed: committed.length,
      wordCount,
    }
  }, [liveTranscript])

  if (configured === null) return null

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-block">
          <div className="brand-mark">b</div>
          <div>
            <p className="brand-name">buddy</p>
            <p className="brand-subtitle">Desktop assistant</p>
          </div>
        </div>

        <nav className="section-nav" aria-label="Main sections">
          {(Object.keys(SECTION_COPY) as SectionId[]).map((id) => (
            <button
              key={id}
              className={`nav-item ${activeSection === id ? "active" : ""}`}
              onClick={() => setActiveSection(id)}
            >
              <span>{SECTION_COPY[id].label}</span>
              <small>{SECTION_COPY[id].eyebrow}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <StatusPill status={status} isCapturing={isCapturing} />
          <p>
            Window lives in the taskbar. The tray keeps startup and quit
            controls.
          </p>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="workspace-kicker">{SECTION_COPY[activeSection].eyebrow}</p>
            <h1>{SECTION_COPY[activeSection].label}</h1>
          </div>
        </header>

        {activeSection === "config" && (
          <ConfigurationSection
            config={config}
            onSaved={(cfg) => {
              setConfig(cfg)
              setConfigured(true)
            }}
            onDeleted={() => {
              setConfig({})
              setConfigured(false)
            }}
          />
        )}

        {activeSection === "transcription" && (
          <LiveTranscriptionSection
            isCapturing={isCapturing}
            segments={liveTranscript}
            stats={transcriptStats}
            onToggle={toggleCapture}
            onClear={clearLiveTranscript}
          />
        )}

        {activeSection === "capture" && (
          <RegionCaptureSection
            status={status}
            transcript={transcript}
            lastRegion={lastRegion}
            error={captureError}
            onCapture={requestRegionCapture}
            onStop={handleStop}
            onClear={clearRegionOutput}
          />
        )}
      </main>
    </div>
  )
}

function StatusPill({
  status,
  isCapturing,
}: {
  status: string
  isCapturing: boolean
}) {
  const active = isCapturing || status !== "idle"
  return (
    <div className={`status-pill ${active ? "live" : ""}`}>
      <span />
      {isCapturing ? "Recording" : STATUS_LABELS[status] ?? status}
    </div>
  )
}

function ConfigurationSection({
  config,
  onSaved,
  onDeleted,
}: {
  config: Partial<Config>
  onSaved: (cfg: Config) => void
  onDeleted: () => void
}) {
  const [anthropicApiKey, setAnthropicApiKey] = useState(
    config.anthropicApiKey ?? "",
  )
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState(
    config.elevenLabsApiKey ?? "",
  )
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(
    config.elevenLabsVoiceId ?? "",
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setAnthropicApiKey(config.anthropicApiKey ?? "")
    setElevenLabsApiKey(config.elevenLabsApiKey ?? "")
    setElevenLabsVoiceId(config.elevenLabsVoiceId ?? "")
  }, [config])

  const handleSave = async () => {
    if (!anthropicApiKey || !elevenLabsApiKey || !elevenLabsVoiceId) {
      setError("All three fields are required.")
      return
    }

    setSaving(true)
    setError("")
    const cfg: Config = { anthropicApiKey, elevenLabsApiKey, elevenLabsVoiceId }
    await saveConfig(cfg)
    onSaved(cfg)
    setSaving(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    setError("")
    await deleteConfig()
    setAnthropicApiKey("")
    setElevenLabsApiKey("")
    setElevenLabsVoiceId("")
    onDeleted()
    setDeleting(false)
  }

  return (
    <section className="content-grid two-col">
      <div className="panel form-panel">
        <div className="panel-heading">
          <p>Secure local setup</p>
          <h2>Connect the services buddy needs</h2>
        </div>

        <Field
          label="Anthropic API key"
          placeholder="sk-ant-..."
          value={anthropicApiKey}
          onChange={setAnthropicApiKey}
        />
        <Field
          label="ElevenLabs API key"
          placeholder="your ElevenLabs key"
          value={elevenLabsApiKey}
          onChange={setElevenLabsApiKey}
        />
        <Field
          label="ElevenLabs Voice ID"
          placeholder="voice ID from elevenlabs.io"
          value={elevenLabsVoiceId}
          onChange={setElevenLabsVoiceId}
        />

        {error && <p className="form-error">{error}</p>}

        <button className="primary-button wide" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save configuration"}
        </button>
        <button
          className="danger-outline-button wide icon-text-button"
          onClick={handleDelete}
          disabled={deleting || (!anthropicApiKey && !elevenLabsApiKey && !elevenLabsVoiceId)}
        >
          <Trash2 size={15} strokeWidth={2.2} />
          {deleting ? "Deleting..." : "Delete API Keys"}
        </button>
      </div>

      <div className="panel quiet-panel">
        <p className="meta-label">Privacy model</p>
        <h2>Keys stay on this machine</h2>
        <p>
          buddy reads credentials from the local Tauri store at runtime. Screen
          captures go to Anthropic only when you request a region analysis.
          Meeting audio is sent to ElevenLabs only while recording is active.
        </p>
        <div className="signal-list">
          <span>Anthropic Vision</span>
          <strong>{anthropicApiKey ? "Configured" : "Missing"}</strong>
          <span>ElevenLabs API</span>
          <strong>{elevenLabsApiKey ? "Configured" : "Missing"}</strong>
          <span>Voice ID</span>
          <strong>{elevenLabsVoiceId ? "Configured" : "Missing"}</strong>
        </div>
      </div>
    </section>
  )
}

function LiveTranscriptionSection({
  isCapturing,
  segments,
  stats,
  onToggle,
  onClear,
}: {
  isCapturing: boolean
  segments: Segment[]
  stats: { committed: number; wordCount: number }
  onToggle: () => void
  onClear: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [exportPath, setExportPath] = useState("")
  const [exportError, setExportError] = useState("")
  const [exporting, setExporting] = useState(false)
  const exportText = useMemo(
    () =>
      segments
        .map((seg) => seg.text.trim())
        .filter(Boolean)
        .join("\n\n"),
    [segments],
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [segments])

  const exportTranscript = async () => {
    if (!exportText) return

    const stamp = exportStamp()
    setExportPath("")
    setExportError("")
    setExporting(true)

    try {
      const path = await saveTextExport(`buddy-transcript-${stamp}.txt`, exportText)
      setExportPath(path ?? "Export canceled")
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="content-grid transcription-layout">
      <div className="panel transcript-panel">
        <div className="transcript-toolbar">
          <div>
            <p className="meta-label">System audio</p>
            <h2>{isCapturing ? "Listening live" : "Ready to record"}</h2>
          </div>
          <div className="toolbar-actions">
            <button
              className="ghost-button icon-text-button"
              onClick={exportTranscript}
              disabled={!exportText || exporting}
            >
              <Download size={15} strokeWidth={2.2} />
              {exporting ? "Opening..." : "Export .txt"}
            </button>
            <button className="ghost-button" onClick={onClear}>
              Clear
            </button>
            <button
              className={`primary-button ${isCapturing ? "danger" : ""}`}
              onClick={onToggle}
            >
              {isCapturing ? "Stop" : "Record"}
            </button>
          </div>
        </div>

        <div className="transcript-stream" ref={scrollRef}>
          {segments.length === 0 ? (
            <div className="empty-state">
              <span className="empty-glyph">REC</span>
              <h3>No transcript yet</h3>
              <p>
                Press Ctrl + Shift + R or use the record button. Final text
                appears bright; partial text stays muted until Scribe commits it.
              </p>
            </div>
          ) : (
            segments.map((seg) => <TranscriptSegment key={seg.id} seg={seg} />)
          )}
        </div>
      </div>

      <aside className="panel stats-panel">
        <div className={`recording-meter ${isCapturing ? "active" : ""}`}>
          <span />
          <strong>{isCapturing ? "Recording" : "Stopped"}</strong>
        </div>
        <dl>
          <div>
            <dt>Committed lines</dt>
            <dd>{stats.committed}</dd>
          </div>
          <div>
            <dt>Words captured</dt>
            <dd>{stats.wordCount}</dd>
          </div>
          <div>
            <dt>Shortcut</dt>
            <dd>Ctrl + Shift + R</dd>
          </div>
        </dl>
        {(exportPath || exportError) && (
          <div className={exportError ? "export-note error" : "export-note"}>
            <strong>{exportError ? "Export failed" : "Export saved"}</strong>
            <p>{exportError || exportPath}</p>
          </div>
        )}
      </aside>
    </section>
  )
}

function RegionCaptureSection({
  status,
  transcript,
  lastRegion,
  error,
  onCapture,
  onStop,
  onClear,
}: {
  status: string
  transcript: string
  lastRegion: Region | null
  error: string
  onCapture: () => void
  onStop: () => void
  onClear: () => void
}) {
  const active = status === "capturing" || status === "thinking" || status === "speaking"
  const [exportPath, setExportPath] = useState("")
  const [exportError, setExportError] = useState("")
  const [exporting, setExporting] = useState(false)

  const exportCapture = async () => {
    if (!transcript.trim()) return

    setExportPath("")
    setExportError("")
    setExporting(true)

    try {
      const path = await saveTextExport(
        `buddy-capture-${exportStamp()}.txt`,
        transcript.trim(),
      )
      setExportPath(path ?? "Export canceled")
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  const clearCapture = () => {
    onClear()
    setExportPath("")
    setExportError("")
  }

  return (
    <section className="content-grid capture-layout">
      <div className="panel output-panel">
        <div className="output-header">
          <div>
            <p className="meta-label">Visual answer</p>
            <h2>{STATUS_LABELS[status] ?? status}</h2>
          </div>
          <div className="toolbar-actions">
            <button
              className="ghost-button icon-text-button"
              onClick={exportCapture}
              disabled={!transcript.trim() || exporting}
            >
              <Download size={15} strokeWidth={2.2} />
              {exporting ? "Opening..." : "Export .txt"}
            </button>
            <button
              className="ghost-button"
              onClick={clearCapture}
              disabled={!transcript.trim() && !error}
            >
              Clear
            </button>
            {active && (
              <button className="ghost-button" onClick={onStop}>
                Stop
              </button>
            )}
            <button className="primary-button" onClick={onCapture}>
              Draw region
            </button>
          </div>
        </div>

        <div className={`answer-canvas ${transcript || error || active ? "has-output" : ""}`}>
          {active && !transcript && (
            <div className="analysis-progress">
              <span />
              <strong>{STATUS_LABELS[status]}</strong>
              <p>
                {status === "capturing" && "Cropping the selected screen area."}
                {status === "thinking" && "Claude is reading the selected region."}
                {status === "speaking" && "Playing the answer through ElevenLabs."}
              </p>
            </div>
          )}

          {active && transcript && (
            <div className="capture-output-stack">
              <div className="speaking-strip">
                <span />
                <div>
                  <strong>{STATUS_LABELS[status]}</strong>
                  <p>
                    {status === "speaking"
                      ? "ElevenLabs is reading this answer aloud."
                      : "The answer is ready while the pipeline finishes."}
                  </p>
                </div>
              </div>

              <article className="capture-answer">
                <p className="answer-label">Text answer</p>
                <MarkdownAnswer content={transcript} />
              </article>
            </div>
          )}

          {!active && error && (
            <div className="error-output">
              <strong>Capture failed</strong>
              <p>{error}</p>
            </div>
          )}

          {!active && !error && transcript && (
            <article className="capture-answer">
              <p className="answer-label">Text answer</p>
              <MarkdownAnswer content={transcript} />
            </article>
          )}

          {!active && !error && !transcript && (
            <div className="empty-state">
              <span className="empty-glyph">AREA</span>
              <h3>No region analysis yet</h3>
              <p>
                Press Ctrl + Shift + Space, draw around any question, error, or
                diagram, and the answer will appear here.
              </p>
            </div>
          )}
        </div>
      </div>

      <aside className="panel stats-panel">
        <p className="meta-label">Last selection</p>
        <dl>
          <div>
            <dt>Width</dt>
            <dd>{lastRegion ? `${lastRegion.width}px` : "0"}</dd>
          </div>
          <div>
            <dt>Height</dt>
            <dd>{lastRegion ? `${lastRegion.height}px` : "0"}</dd>
          </div>
          <div>
            <dt>Shortcut</dt>
            <dd>Ctrl + Shift + Space</dd>
          </div>
        </dl>
        {(exportPath || exportError) && (
          <div className={exportError ? "export-note error" : "export-note"}>
            <strong>{exportError ? "Export failed" : "Export saved"}</strong>
            <p>{exportError || exportPath}</p>
          </div>
        )}
      </aside>
    </section>
  )
}

function MarkdownAnswer({ content }: { content: string }) {
  return (
    <Streamdown
      mode="static"
      className="markdown-answer"
      plugins={MARKDOWN_PLUGINS}
      controls={{ code: true, table: true, mermaid: true }}
      shikiTheme={["github-light", "github-dark"]}
    >
      {content}
    </Streamdown>
  )
}

function TranscriptSegment({ seg }: { seg: Segment }) {
  return (
    <p className={`transcript-segment ${seg.committed ? "committed" : "partial"}`}>
      {seg.text}
    </p>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const inputId = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="field-control">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="field-eye-button"
          onClick={() => setVisible((current) => !current)}
          aria-label={`${visible ? "Hide" : "Show"} ${label}`}
          title={`${visible ? "Hide" : "Show"} ${label}`}
        >
          {visible ? (
            <EyeOff size={16} strokeWidth={2.1} />
          ) : (
            <Eye size={16} strokeWidth={2.1} />
          )}
        </button>
      </div>
    </div>
  )
}
