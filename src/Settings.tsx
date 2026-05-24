import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { type Config, saveConfig } from "./config"

interface Props {
  initial: Partial<Config>
  onSave: (cfg: Config) => void
}

export default function Settings({ initial, onSave }: Props) {
  const [anthropicApiKey,   setAnthropicApiKey]   = useState(initial.anthropicApiKey   ?? "")
  const [elevenLabsApiKey,  setElevenLabsApiKey]  = useState(initial.elevenLabsApiKey  ?? "")
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(initial.elevenLabsVoiceId ?? "")
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState("")

  // Esc → dismiss without saving
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") invoke("hide_overlay")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const handleSave = async () => {
    if (!anthropicApiKey || !elevenLabsApiKey || !elevenLabsVoiceId) {
      setError("All three fields are required.")
      return
    }
    setSaving(true)
    setError("")
    const cfg: Config = { anthropicApiKey, elevenLabsApiKey, elevenLabsVoiceId }
    await saveConfig(cfg)
    onSave(cfg)
    setSaving(false)
  }

  return (
    <div className="flex items-center justify-center w-full h-full p-4">
      <div
        style={{
          background: "rgba(15,15,20,0.92)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 14,
          padding: "24px 28px",
          width: "100%",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Header row with dismiss button */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h2 style={{ color: "#fff", fontSize: 15, fontWeight: 600, margin: 0 }}>
            buddy — Setup
          </h2>
          <button
            onClick={() => invoke("hide_overlay")}
            title="Dismiss (Esc)"
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.35)",
              fontSize: 18,
              lineHeight: 1,
              cursor: "pointer",
              padding: "0 2px",
              borderRadius: 4,
              transition: "color 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
          >
            ×
          </button>
        </div>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 20 }}>
          Keys are saved locally on your machine only.{" "}
          <span style={{ color: "rgba(255,255,255,0.22)" }}>Esc to dismiss.</span>
        </p>

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

        {error && (
          <p style={{ color: "#f87171", fontSize: 11, marginBottom: 10 }}>{error}</p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: "100%",
            padding: "8px 0",
            borderRadius: 8,
            background: saving ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.85)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            border: "none",
            cursor: saving ? "not-allowed" : "pointer",
            marginTop: 4,
          }}
        >
          {saving ? "Saving…" : "Save & start"}
        </button>
      </div>
    </div>
  )
}

function Field({
  label, placeholder, value, onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: 11, marginBottom: 4 }}>
        {label}
      </label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "7px 10px",
          borderRadius: 7,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "#fff",
          fontSize: 12,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  )
}
