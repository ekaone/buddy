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

## Deferred (v0.2.0)

- Hotkey customization UI
- Voice selector
- Transcript history
- Settings panel
- Multi-monitor support (xcap monitor picker)
- Mute / abort mid-speech

---

## Notes for Claude Code

1. Scaffold all files listed in the directory structure above
2. Use `pnpm` as the package manager
3. Use Tauri v2 APIs only — not v1 (`@tauri-apps/api/core` not `@tauri-apps/api/tauri`)
4. The `dangerouslyAllowBrowser: true` flag on the Anthropic client is intentional — this runs inside Tauri, not a public browser
5. Use `eleven_flash_v2_5` model for lowest latency TTS
6. Use `claude-haiku-4-5` for lowest latency vision — swap to `claude-sonnet-4-5` only if accuracy needs improvement
7. Keep the overlay UI minimal — this is a background utility, not a primary app window