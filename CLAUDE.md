# buddy — CLAUDE.md

> Living documentation of the actual codebase. Keep this file in sync when making architectural changes.

---

## What buddy does

A minimal desktop AI assistant that lives in the Windows system tray. Press a global hotkey, drag a region on screen, and Claude analyses it — then ElevenLabs reads the answer aloud.

```
Ctrl+Shift+Space  →  fullscreen area selector  →  xcap screenshot  →  Claude vision  →  ElevenLabs TTS  →  spoken answer
```

No `.env` file. No API keys baked into the binary. Users enter their own keys at first launch; keys are stored locally in `%APPDATA%\com.buddy.dev\config.json` via `tauri-plugin-store`.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Desktop shell | **Tauri v2** + Rust | `tauri = "2"` — use v2 APIs only |
| Screenshot | `xcap 0.8` | `png 0.17` used directly for encoding (avoids `image` crate conflicts) |
| Frontend | **React 19** + **Tailwind v4** | Tailwind loaded via `@tailwindcss/vite` plugin — no `tailwind.config.js` |
| State | **Zustand 5** | `useBuddyStore` — status + transcript |
| AI vision | `@anthropic-ai/sdk` | `dangerouslyAllowBrowser: true` is intentional (Tauri WebView, not public web) |
| TTS | `@elevenlabs/elevenlabs-js` | Web Audio API playback (chunks → Blob → `new Audio()`) — `play()` is Node-only |
| Config storage | `tauri-plugin-store 2` | `config.json` via `load()` + `autoSave: true, defaults: {}` |
| Autostart | `tauri-plugin-autostart 2` | Enabled silently on first run |
| Build | Vite 8 | Dev server on port 1420 |
| Package manager | pnpm | Always use pnpm, never npm/yarn |

---

## Directory structure (actual)

```
buddy/
├── .github/
│   └── workflows/
│       ├── ci.yml          # type-check (ubuntu) + cargo check (windows) on push/PR
│       └── release.yml     # tauri-action matrix: windows + macos arm + macos intel, triggered by v* tag
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json     # main window: 420×380, transparent, no decorations, hidden at start
│   ├── capabilities/
│   │   └── default.json    # permissions for both "main" and "selector" windows
│   └── src/
│       ├── main.rs         # calls lib::run()
│       ├── lib.rs          # all Tauri setup: tray, hotkey, windows, commands
│       └── screenshot.rs   # xcap capture → base64 PNG (capture_screen, capture_region)
├── src/
│   ├── main.tsx            # React entry — routes "selector" label → <Selector>, else → <App>
│   ├── App.tsx             # overlay logic: config check, pipeline runner, event listeners, stop handler
│   ├── Selector.tsx        # fullscreen drag-to-select UI, emits buddy:region / buddy:cancel
│   ├── Settings.tsx        # first-run API key form, Esc/× to dismiss
│   ├── pipeline.ts         # capture → Claude → ElevenLabs pipeline with AbortSignal support
│   ├── store.ts            # Zustand store: status, transcript
│   ├── config.ts           # loadConfig / saveConfig / isConfigured via tauri-plugin-store
│   ├── index.css           # @import "tailwindcss" (v4 syntax), transparent html/body/#root
│   ├── vite-env.d.ts       # /// <reference types="vite/client" /> — required for CSS imports
│   └── components/
│       ├── Overlay.tsx     # status card UI: badge + transcript + stop button
│       └── ui/
│           ├── badge.tsx   # CVA variants: idle / capturing / thinking / speaking / error
│           └── card.tsx    # glass-morphism card (bg-black/50 backdrop-blur)
├── src/lib/
│   └── utils.ts            # cn() = clsx + tailwind-merge
├── index.html              # inline <style> sets background:transparent to prevent white flash
├── vite.config.ts          # plugins: react(), tailwindcss(); dev port 1420
├── tsconfig.json           # strict: true, target ES2020, moduleResolution: bundler
└── package.json
```

---

## Key architectural decisions

### Multi-window routing
There are two Tauri windows — `main` (the overlay card) and `selector` (fullscreen crosshair). Both load the same React bundle. `main.tsx` detects the current window label:

```ts
const label = getCurrentWebviewWindow().label
// "selector" → <Selector />, anything else → <App />
```

The `selector` window is **pre-created in Rust** during `setup()` (hidden), not spawned from JavaScript. This avoids Tauri v2 capability complexity.

### Runtime API keys (no .env)
Keys are never compiled into the binary. `src/config.ts` uses `tauri-plugin-store`:

```ts
// ⚠️ defaults: {} is required — StoreOptions.defaults is mandatory in plugin-store 2.4+
return load(STORE_FILE, { autoSave: true, defaults: {} })
```

`isConfigured()` is called on every `buddy:trigger` event — if keys are missing, the overlay shows the Settings form instead of the selector.

### AbortController pipeline cancellation
`App.tsx` holds a `controllerRef`. `handleStop()` (also wired to Esc) does:
1. `controller.abort()` — stops capture delay / Claude fetch / audio mid-playback
2. Clear the 4-second auto-hide timer
3. `setStatus("idle")` + `setTranscript("")`
4. `invoke("hide_overlay")` — dismiss immediately

### DPI-aware window positioning
`monitor.size()` returns **physical** pixels; `tauri.conf.json` dimensions are **logical**. On 125%+ DPI screens these differ. `lib.rs` setup uses:

```rust
let scale = monitor.scale_factor();
let work  = monitor.work_area(); // physical px, already excludes taskbar
let win_w = (420.0 * scale) as i32;
let win_h = (380.0 * scale) as i32;
```

`work_area()` is available on `tauri::Monitor` in Tauri 2.11+ and returns a struct with `.position.x / .position.y / .size.width / .size.height`.

### TTS audio playback (Web Audio API)
`elevenlabs.textToSpeech.convert()` returns `AsyncIterable<Uint8Array>`. The SDK's `play()` helper is Node.js-only and crashes in Tauri. Instead:

```ts
const chunks: Uint8Array<ArrayBuffer>[] = []
for await (const chunk of stream) {
  chunks.push(chunk as Uint8Array<ArrayBuffer>) // TS 5.7+ generic Uint8Array — cast required
}
const blob = new Blob(chunks, { type: "audio/mpeg" })
const url  = URL.createObjectURL(blob)
new Audio(url).play()
```

### Tailwind v4
No `tailwind.config.js`, no `@tailwind` directives. Config is:
- `vite.config.ts` → `import tailwindcss from "@tailwindcss/vite"` in plugins
- `src/index.css` → `@import "tailwindcss"` (first line)
- `src/vite-env.d.ts` → `/// <reference types="vite/client" />` (required for the CSS import to type-check)

---

## Rust commands (IPC surface)

| Command | Description |
|---|---|
| `capture_screen` | Full primary monitor → base64 PNG |
| `capture_region(x, y, width, height)` | Crop region from primary monitor → base64 PNG. All values in **physical pixels**. Bounds-clamped. |
| `show_overlay` / `hide_overlay` | Show/hide the `main` window |
| `show_selector` / `hide_selector` | Show/hide the `selector` window |

### DPI scaling in capture_region
CSS mouse coordinates (logical px) must be multiplied by `window.devicePixelRatio` before being passed to `capture_region`. This happens in `Selector.tsx`:

```ts
const scale = window.devicePixelRatio || 1
emit("buddy:region", {
  x: Math.round(rect.x * scale),
  y: Math.round(rect.y * scale),
  width:  Math.round(rect.w * scale),
  height: Math.round(rect.h * scale),
})
```

---

## Tauri events

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `buddy:trigger` | Rust → JS | `()` | Hotkey fired — show selector or settings |
| `buddy:region` | JS → JS | `{ x, y, width, height }` | Selector confirmed a region |
| `buddy:cancel` | JS → JS | `()` | Selector dismissed (Esc or tiny drag) |

---

## Tauri capabilities (`src-tauri/capabilities/default.json`)

Both windows (`main` and `selector`) share one capability file. Required permissions:
- `core:default`
- `global-shortcut:allow-register/unregister/is-registered`
- `autostart:allow-enable/disable/is-enabled`
- `store:allow-get/set/save/load`

---

## Rust dependencies (Cargo.toml)

```toml
tauri                    = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-autostart   = "2"
tauri-plugin-store       = "2"
xcap                     = "0.2"
base64                   = "0.22"
png                      = "0.17"   # used directly — avoids xcap/image crate version conflicts
serde                    = { version = "1", features = ["derive"] }
serde_json               = "1"
tokio                    = { version = "1", features = ["full"] }
```

---

## Development

```bash
pnpm install
pnpm tauri dev        # hot-reload frontend + Rust (first compile: ~3 min)
```

```bash
pnpm tauri build      # production installer → src-tauri/target/release/bundle/
```

### Type-check only (fast)
```bash
pnpm tsc --noEmit     # frontend
cd src-tauri && cargo check  # Rust
```

---

## CI / Release

**CI** (`.github/workflows/ci.yml`) — runs on push to `main`/`dev` and PRs:
- `frontend` job: `pnpm tsc --noEmit` on ubuntu-latest
- `rust` job: `cargo check` on windows-latest

**Release** (`.github/workflows/release.yml`) — triggered by a version tag:
```bash
git tag v0.2.0
git push origin v0.2.0
# → builds Windows (.exe + .msi), macOS arm64 (.dmg), macOS x64 (.dmg)
# → creates a draft GitHub Release — review before publishing
```

No VITE_* secrets needed. `GITHUB_TOKEN` is auto-provided. Keys are runtime, not build-time.

---

## Status values and pipeline flow

```
idle → capturing → thinking → speaking → idle
                                       ↘ error (on any throw)
```

`App.tsx` auto-shows the overlay on any non-idle/non-error status and auto-hides 4 seconds after returning to idle. `handleStop()` or Esc skips the 4-second wait and hides immediately.

---

## Known gotchas

| Gotcha | Detail |
|---|---|
| `StoreOptions.defaults` required | `load(file, { autoSave: true })` fails — must include `defaults: {}` |
| `Uint8Array` generic in TS 5.7+ | `Uint8Array<ArrayBufferLike>` ≠ `BlobPart`; use `Uint8Array<ArrayBuffer>[]` and cast at push |
| CSS import type error | `import "./index.css"` needs `src/vite-env.d.ts` with `/// <reference types="vite/client" />` |
| ElevenLabs `play()` Node-only | Use Web Audio API (chunks → Blob → `new Audio(url)`) instead |
| xcap primary monitor | Use `.find(|m| m.is_primary())` — `into_iter().next()` is not guaranteed to be primary |
| Close → hide | `on_window_event` intercepts `CloseRequested` and calls `prevent_close()` + `hide()` |
| White flash on startup | Inline `<style>` in `index.html` sets `background: transparent` before JS loads |
| Error 1412 on quit | `Failed to unregister class Chrome_WidgetWin_0` — harmless WebView2 cleanup race, app exits correctly |

---

## Roadmap

### v0.1.0 ✅ (shipped)
- Global hotkey (`Ctrl+Shift+Space`)
- Fullscreen area selector with dimension badge
- Claude vision analysis (`claude-haiku-4-5`)
- ElevenLabs TTS (`eleven_flash_v2_5`) via Web Audio API
- Overlay status card with transcript (scrollable)
- Stop button (`×`) + Esc shortcut to abort mid-pipeline
- System tray with `Start on login` toggle (CheckMenuItem)
- Auto-start on login (enabled on first run)
- First-run Settings screen for API keys (runtime, not env vars)
- Esc / × to dismiss Settings without saving
- DPI-aware window positioning using `work_area()`
- CI (type-check + cargo check) + Release workflows (Windows + macOS)

### v0.2.0 (planned)
- [ ] Settings accessible from tray menu (update keys without deleting config.json)
- [ ] Hotkey customization UI
- [ ] Voice selector (list ElevenLabs voices)
- [ ] Transcript history
- [ ] Multi-monitor support (let user pick which monitor xcap captures)
- [ ] macOS code signing (Gatekeeper)
