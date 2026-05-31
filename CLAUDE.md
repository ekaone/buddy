# buddy — CLAUDE.md

> Cross-platform desktop AI assistant (Tauri v2). Read this file fully before scaffolding anything.

---

## Project overview

**buddy** is a minimal desktop AI assistant triggered by a global hotkey.

```
hotkey → screenshot (xcap) → Claude vision API → ElevenLabs TTS → speak answer
```

MVP target: `v0.1.0`, Windows first, cross-platform ready.

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 + Rust |
| Screenshot | `xcap` crate |
| Frontend | React + Tailwind CSS + shadcn/ui |
| State | Zustand |
| AI vision | Anthropic SDK (`@anthropic-ai/sdk`) — direct, no wrapper |
| TTS | ElevenLabs JS SDK (`@elevenlabs/elevenlabs-js`) — `play()` built-in |
| Build | Vite |
| Package manager | pnpm |

No `@ekaone/rendition`. No `@ekaone/use-claude`. No `@ekaone/agent-relay`. Direct SDKs only.

---

## Target directory structure

```
buddy/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs          # Tauri app entry, hotkey registration
│       ├── screenshot.rs    # xcap capture → base64 PNG
│       └── lib.rs           # expose Tauri commands
├── src/
│   ├── main.tsx             # React entry
│   ├── App.tsx              # root component, IPC listeners
│   ├── pipeline.ts          # Anthropic SDK + ElevenLabs SDK pipeline
│   ├── store.ts             # Zustand store (status, transcript)
│   └── components/
│       └── Overlay.tsx      # floating status card UI
├── index.html
├── vite.config.ts
├── package.json
└── CLAUDE.md                # this file
```

---

## Rust side

### Cargo.toml dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["global-shortcut"] }
xcap = "0.2"
base64 = "0.22"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

### src-tauri/src/screenshot.rs

- Use `xcap::Monitor::all()` to get the primary monitor
- Capture as `image::RgbaImage`, encode to PNG bytes, return as base64 string
- Expose as Tauri command: `#[tauri::command] fn capture_screen() -> Result<String, String>`

### src-tauri/src/main.rs

- Register global shortcut (default: `CmdOrCtrl+Shift+Space`) via `tauri_plugin_global_shortcut`
- On hotkey fire: emit Tauri event `"buddy:trigger"` to frontend
- Register commands: `capture_screen`
- Window: frameless, always-on-top, transparent background, small size (~400×120px), positioned bottom-right

### tauri.conf.json notes

```json
{
  "app": {
    "windows": [{
      "title": "buddy",
      "width": 400,
      "height": 120,
      "decorations": false,
      "alwaysOnTop": true,
      "transparent": true,
      "resizable": false
    }]
  },
  "plugins": {
    "global-shortcut": {}
  }
}
```

---

## TypeScript / React side

### package.json dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "@elevenlabs/elevenlabs-js": "latest",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-global-shortcut": "^2",
    "react": "^18",
    "react-dom": "^18",
    "zustand": "^4",
    "tailwindcss": "^3",
    "shadcn-ui": "latest"
  }
}
```

### src/pipeline.ts

Core pipeline — called when hotkey fires:

```ts
import Anthropic from "@anthropic-ai/sdk"
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js"
import { invoke } from "@tauri-apps/api/core"

const anthropic = new Anthropic({ apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true })
const elevenlabs = new ElevenLabsClient({ apiKey: import.meta.env.VITE_ELEVENLABS_API_KEY })

export async function runPipeline(onStatus: (s: string) => void, onTranscript: (t: string) => void) {
  // 1. capture screen
  onStatus("capturing")
  const base64Png: string = await invoke("capture_screen")

  // 2. Claude vision
  onStatus("thinking")
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: base64Png } },
        { type: "text", text: "Describe what is on the screen concisely and answer any visible question or task." }
      ]
    }]
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  onTranscript(text)

  // 3. TTS + play
  onStatus("speaking")
  const audio = await elevenlabs.textToSpeech.convert(
    import.meta.env.VITE_ELEVENLABS_VOICE_ID,
    { text, modelId: "eleven_flash_v2_5" }
  )
  await play(audio)

  onStatus("idle")
}
```

### src/store.ts

```ts
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
```

### src/App.tsx

- Listen for Tauri event `"buddy:trigger"` via `listen()` from `@tauri-apps/api/event`
- On event: call `runPipeline(setStatus, setTranscript)`
- Render `<Overlay />`

### src/components/Overlay.tsx

Minimal floating card:
- Show status badge (idle / capturing / thinking / speaking)
- Show last transcript text (truncated, ~2 lines max)
- Tailwind + shadcn `Badge` and `Card` components
- Transparent background, rounded, backdrop blur

---

## Environment variables

Create `.env` at project root (never commit):

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
VITE_ELEVENLABS_API_KEY=...
VITE_ELEVENLABS_VOICE_ID=...   # any ElevenLabs voice ID
```

---

## MVP scope (v0.1.0) — what to build

- [x] Global hotkey listener (Rust)
- [x] `xcap` screen capture → base64 (Rust)
- [x] Tauri IPC command `capture_screen`
- [x] Tauri event `buddy:trigger` emitted on hotkey
- [x] Claude vision call via Anthropic SDK (TS)
- [x] ElevenLabs TTS + `play()` (TS)
- [x] Zustand store for status + transcript
- [x] Floating overlay React UI
- [x] `.env` config for API keys + voice ID

---

# v0.2.0 — Meeting audio capture + transcription

> Build this only after v0.1.0 ships and works. Goal of THIS release: prove buddy can reliably hear the meeting and transcribe it. No translation yet — that is v0.3.0. Keeping these separate means if loopback capture is flaky on Windows, you debug it without translation logic in the way.

## Feature flow (v0.2.0)

```
toggle hotkey ON  → cpal loopback capture → buffer PCM
                  → ElevenLabs Scribe v2 (streaming STT)
                  → raw transcript → live text overlay
toggle hotkey OFF → stop capture, finalize
```

**Decided behavior:**
- **Output: text overlay only.** Raw transcript scrolling in the side drawer.
- **Trigger: toggle on/off.** One hotkey press starts capturing the whole meeting; press again to stop. Not push-to-talk.

## The audio capture problem (read carefully)

buddy must capture the **other participants' voices** — i.e. system/loopback audio (what comes out of the speakers), NOT the local mic.

| Platform | Method | Notes |
|---|---|---|
| Windows (priority) | WASAPI loopback | Native, no extra setup. Use `cpal`. |
| macOS | ScreenCaptureKit (13+) or BlackHole virtual device | No native loopback; needs permission or virtual device |
| Linux | PulseAudio/PipeWire monitor source | via `cpal` |

Use the [`cpal`](https://crates.io/crates/cpal) crate — cross-platform audio I/O, supports WASAPI loopback on Windows.

### New Cargo deps

```toml
cpal = "0.15"
hound = "3"          # WAV encoding if needed for buffering
ringbuf = "0.4"      # lock-free audio ring buffer
```

## Rust side — new files

### src-tauri/src/audio.rs

- `start_capture()` Tauri command — opens default loopback device via `cpal`, streams PCM f32 samples into a ring buffer
- Background thread drains the ring buffer into ~250ms PCM chunks
- Each chunk emitted to frontend via Tauri event `"buddy:audio_chunk"` (base64 PCM) — OR forwarded to a Rust-side Scribe websocket (decide below)
- `stop_capture()` Tauri command — tears down the stream, stops the thread
- Target format for Scribe: PCM 16-bit, 16kHz mono (resample from device native rate)

### src-tauri/src/main.rs additions

- New global shortcut for translation toggle: `CmdOrCtrl+Shift+T`
- Maintain capture state (capturing: bool); toggle emits `"buddy:translate_toggle"` to frontend

## STT — ElevenLabs Scribe v2 streaming

Scribe v2 supports real-time streaming transcription. Two architecture options:

- **Option 1 (recommended): Rust → Scribe websocket directly.** Lower latency, keeps PCM in Rust. Frontend only receives transcribed text events.
- **Option 2: stream PCM chunks to frontend, frontend → Scribe.** Simpler to write with the JS SDK, but doubles the data hops.

Start with Option 2 for speed of implementation; migrate to Option 1 if latency is poor.

## Store additions (src/store.ts) — v0.2.0

```ts
interface BuddyStore {
  // ...existing
  isCapturing: boolean
  liveTranscript: { id: string; text: string; committed: boolean }[]
  setCapturing: (b: boolean) => void
  appendSegment: (seg: { id: string; text: string; committed: boolean }) => void
  updateSegment: (id: string, text: string, committed: boolean) => void
}
```

Note: keep the segment shape extensible — v0.3.0 will add `translated` and reuse this same list.

## UI — switch to side drawer for capture mode

The minimal bottom-right card works for v0.1.0 one-shot answers. Live transcription needs vertical space for scrolling text.

- When `isCapturing` is true, overlay expands into a **right-edge side drawer** (~360px wide, full height)
- Scrolling list of transcript segments
- Interim (not-yet-final) Scribe results shown greyed / italic; firm up to normal once committed
- Auto-scroll to newest; "● REC" indicator at top while capturing
- Toggle off → drawer collapses back to the compact card

## v0.2.0 checklist

- [ ] `cpal` loopback capture (Windows WASAPI first)
- [ ] `start_capture` / `stop_capture` Tauri commands
- [ ] PCM resample to 16kHz mono
- [ ] Capture toggle hotkey `CmdOrCtrl+Shift+T`
- [ ] Scribe v2 streaming STT wired (Option 2 first)
- [ ] Live transcript store (interim + committed)
- [ ] Side-drawer overlay UI with scrolling segments
- [ ] "● REC" indicator while capturing

**v0.2.0 done = buddy reliably hears the meeting and shows an accurate live transcript. No translation.**

---

# v0.3.0 — Add the intelligence (translation)

> Build this only after v0.2.0 transcription is solid. This layer sits on top of the working capture+transcribe pipeline from v0.2.0. Do not start until raw transcription is reliable.

## What changes

The v0.2.0 flow ended at "raw transcript → overlay". v0.3.0 inserts a buffering + translation step:

```
... Scribe v2 transcript
                  → sentence-boundary buffer
                  → Claude (translate) → translated text in overlay
```

## The SOV / verb-final problem

Verb-final languages (Japanese, Korean, German subordinate clauses) can't be correctly translated until the clause completes. Strategy:

- Buffer Scribe interim results until a **sentence boundary** (terminal punctuation, or a pause > 800ms of silence detected in the PCM)
- Only send **committed** sentences to Claude for translation
- Keep showing the raw (untranslated) STT text greyed out; replace with translation once committed
- Accept that the live transcript will have brief "settling" as interims firm up

## Translation — Claude

```ts
const response = await anthropic.messages.create({
  model: "claude-haiku-4-5",            // low latency; bump to sonnet for quality
  max_tokens: 512,
  system: "You are a real-time interpreter. Translate the user's text to {targetLang}. Output ONLY the translation, no notes, no preamble.",
  messages: [{ role: "user", content: committedSentence }]
})
```

- Target language configurable via settings (default: English)
- Source language: let Scribe auto-detect

## Store additions (src/store.ts) — v0.3.0

Extend the v0.2.0 segment shape — do not create a parallel list:

```ts
// segment grows from { id, text, committed }
// to        { id, text, translated, committed }
interface BuddyStore {
  // ...existing from v0.2.0
  targetLang: string
  setTargetLang: (l: string) => void
  commitTranslation: (id: string, translated: string) => void
}
```

## UI changes — v0.3.0

- Each segment now shows: original (small, muted) above translation (primary text)
- Uncommitted segments: show raw STT greyed/italic until the translation lands
- Add a target-language selector to the drawer header

## v0.3.0 checklist

- [ ] Sentence-boundary buffering (punctuation + silence detection)
- [ ] Claude translation of committed sentences only
- [ ] Extend segment shape with `translated` field
- [ ] Two-line segment UI (original + translation)
- [ ] Target language setting + selector in drawer header

**v0.3.0 done = live meeting translation working end to end.**

---

## Deferred beyond v0.3.0

- Speaker diarization (who said what)
- Save / export meeting transcript
- Hotkey customization UI
- Multi-monitor support (xcap monitor picker)
- macOS ScreenCaptureKit audio path
- Optional spoken translation mode
- Rolling meeting summary (Claude summarizes the running transcript on demand)

---

## Notes for Claude Code

1. Scaffold all files listed in the directory structure above
2. Do not add `@ekaone/rendition`, `@ekaone/use-claude`, or `@ekaone/agent-relay` — not used in this project
3. Use `pnpm` as the package manager
4. Use Tauri v2 APIs only — not v1 (`@tauri-apps/api/core` not `@tauri-apps/api/tauri`)
5. The `dangerouslyAllowBrowser: true` flag on the Anthropic client is intentional — this runs inside Tauri, not a public browser
6. Use `eleven_flash_v2_5` model for lowest latency TTS
7. Use `claude-haiku-4-5` for lowest latency vision — swap to `claude-sonnet-4-5` only if accuracy needs improvement
8. Keep the overlay UI minimal — this is a background utility, not a primary app window
9. Ship in order: v0.1.0 (screenshot → vision → speak) → v0.2.0 (capture + transcribe) → v0.3.0 (translation). Do NOT start a release until the previous one works end to end.
10. v0.2.0 is transcription ONLY — no translation. Its done-criteria is: buddy reliably hears the meeting and shows an accurate live transcript. Translation is deliberately held back to v0.3.0 so loopback capture can be validated in isolation.
11. For audio: capture LOOPBACK/system audio (other participants), not the local mic. Use `cpal` with WASAPI loopback on Windows.
12. Translation output (v0.3.0) is text-overlay-only (no TTS) and the capture trigger is a toggle on/off hotkey, not push-to-talk.
13. v0.3.0 extends the v0.2.0 transcript segment shape (adds a `translated` field) — it does NOT create a second parallel transcript list.