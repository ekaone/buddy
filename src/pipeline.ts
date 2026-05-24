import Anthropic from "@anthropic-ai/sdk"
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js"
import { invoke } from "@tauri-apps/api/core"
import { loadConfig } from "./config"

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

async function playAudioStream(
  stream: AsyncIterable<Uint8Array>,
  signal: AbortSignal
): Promise<void> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for await (const chunk of stream) {
    if (signal.aborted) return
    chunks.push(chunk as Uint8Array<ArrayBuffer>)
  }
  const blob = new Blob(chunks, { type: "audio/mpeg" })
  const url = URL.createObjectURL(blob)
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(url)
    const cleanup = () => { URL.revokeObjectURL(url); resolve() }
    signal.addEventListener("abort", () => { audio.pause(); cleanup() }, { once: true })
    audio.onended = cleanup
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Audio playback failed")) }
    audio.play().catch(reject)
  })
}

export async function runPipeline(
  onStatus: (s: string) => void,
  onTranscript: (t: string) => void,
  signal: AbortSignal,
  region: Region,
) {
  // Load keys from local config at runtime — never baked into the binary
  const cfg = await loadConfig()

  const anthropic = new Anthropic({
    apiKey: cfg.anthropicApiKey ?? "",
    dangerouslyAllowBrowser: true,
  })
  const elevenlabs = new ElevenLabsClient({
    apiKey: cfg.elevenLabsApiKey ?? "",
  })

  // 1. Capture — delay lets the selector window fully disappear
  onStatus("capturing")
  await new Promise<void>((r) => setTimeout(r, 250))
  if (signal.aborted) return

  const base64Png: string = await invoke("capture_region", {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  })
  if (signal.aborted) return

  // 2. Claude vision
  onStatus("thinking")
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: base64Png },
          },
          {
            type: "text",
            text: "Describe what is on the screen concisely and answer any visible question or task.",
          },
        ],
      },
    ],
  })
  if (signal.aborted) return

  const text =
    response.content[0].type === "text" ? response.content[0].text : ""
  onTranscript(text)

  // 3. TTS — Web Audio API (play() is Node.js-only)
  onStatus("speaking")
  const audioStream = await elevenlabs.textToSpeech.convert(
    cfg.elevenLabsVoiceId ?? "",
    { text, modelId: "eleven_flash_v2_5" }
  )
  await playAudioStream(audioStream, signal)

  if (!signal.aborted) onStatus("idle")
}
