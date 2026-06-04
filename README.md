# buddy

<p align="center">
  <img src="https://res.cloudinary.com/ddjsyskef/image/upload/v1780574229/Github/ui5eeucvvlm7jnfx6kcc.png" alt="Alt Text" />
</p>

> A minimal desktop AI assistant — analyse anything on screen, or transcribe a live meeting in real time.
```
Ctrl+Shift+Space  →  draw a region  →  Claude sees it  →  ElevenLabs speaks the answer
Ctrl+Shift+R      →  toggle recording  →  system audio  →  ElevenLabs Scribe v2  →  live transcript
```

[![CI](https://github.com/ekaone/buddy/actions/workflows/ci.yml/badge.svg)](https://github.com/ekaone/buddy/actions/workflows/ci.yml)
[![Release](https://github.com/ekaone/buddy/actions/workflows/release.yml/badge.svg)](https://github.com/ekaone/buddy/releases)

---

## What it does

buddy sits silently in your **system tray**. Two modes:

**Screen analysis (v0.1.0)**  
Press `Ctrl+Shift+Space` and draw a rectangle around anything on screen — a question, an error message, a diagram. Within seconds Claude describes it and ElevenLabs reads the answer aloud. The overlay card disappears automatically.

**Live meeting transcription (v0.2.0)**  
Press `Ctrl+Shift+R` to start capturing system audio (what comes out of your speakers — other participants' voices). ElevenLabs Scribe v2 transcribes in real time and a side drawer shows the live rolling transcript. Press `Ctrl+Shift+R` again to stop.

No window stays open. No taskbar button. Just hotkeys.

---

## Requirements

| | |
|---|---|
| **OS** | Windows 10 / 11 (macOS planned) |
| **Anthropic API key** | [console.anthropic.com](https://console.anthropic.com) — free tier works |
| **ElevenLabs API key** | [elevenlabs.io](https://elevenlabs.io) — free tier: 10 k chars/month |
| **ElevenLabs Voice ID** | Any voice from the library (for TTS in v0.1.0) |
| **ElevenLabs Scribe v2** | Required for live transcription (v0.2.0) — check your plan includes it |

---

## Installation

### Option A — Download the installer (recommended)

1. Go to [**Releases**](https://github.com/ekaone/buddy/releases)
2. Download the file for your platform:
   - **Windows** → `buddy_x.x.x_x64-setup.exe`
   - **macOS Apple Silicon** → `buddy_x.x.x_aarch64.dmg`
   - **macOS Intel** → `buddy_x.x.x_x64.dmg`
3. Run the installer
4. buddy starts and asks for your API keys — [see First-run setup below](#first-run-setup)

> **macOS only:** If macOS blocks the app, open Terminal and run:
> ```bash
> xattr -cr /Applications/buddy.app
> ```

### Option B — Build from source

```bash
git clone https://github.com/ekaone/buddy
cd buddy
pnpm install
pnpm tauri dev       # dev mode
# or
pnpm tauri build     # build installer → src-tauri/target/release/bundle/
```

> First Rust compile takes ~2–5 minutes. Subsequent runs are fast.

**Requirements for building from source:**
- Node.js ≥ 18 + pnpm
- Rust toolchain (`rustup` — [rustup.rs](https://rustup.rs))

---

## First-run setup

On first launch, buddy shows a **Setup screen** to collect your API keys.  
Keys are saved **only on your machine** (`%APPDATA%\com.buddy.dev\config.json` on Windows). They are never sent anywhere other than the respective APIs.

<details>
<summary>Where to find each key</summary>

**Anthropic API key**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. API Keys → Create Key
3. Copy the `sk-ant-…` value

**ElevenLabs API key**
1. Go to [elevenlabs.io](https://elevenlabs.io) → sign in
2. Profile → API Keys → copy your key

**ElevenLabs Voice ID**
1. Go to [elevenlabs.io/app/voice-lab](https://elevenlabs.io/app/voice-lab)
2. Click any voice — the ID is in the URL:
   `…/voice-lab/edit/{VOICE_ID}`
3. Copy the ID segment

</details>

After saving, the setup screen disappears and buddy is ready. Your keys are loaded automatically on every future launch.

---

## How to use

### Mode 1 — Screen analysis

**1. Trigger buddy**

Press **Ctrl+Shift+Space** from anywhere. A dark fullscreen overlay appears: *"Drag to select an area"*.

**2. Select a region**

Click and drag around what you want Claude to analyse. Release to confirm.

| Key / Action | Result |
|---|---|
| **Drag** | Draw selection |
| **Release mouse** | Confirm, start pipeline |
| **Esc** | Cancel |
| **Ctrl+Shift+Space** (again) | Cancel current response, reopen selector |

**3. Watch the pipeline**

A small overlay card appears bottom-right:

| Badge | What's happening |
|---|---|
| `capturing…` | Taking a screenshot of the selected region |
| `thinking…` | Claude is analysing the image |
| `speaking…` | ElevenLabs is reading the answer aloud |
| `idle` | Done — overlay auto-hides after 4 seconds |
| `error` | Something went wrong (see Troubleshooting) |

---

### Mode 2 — Live meeting transcription

**1. Start recording**

Press **Ctrl+Shift+R**. The overlay expands to a full-height side drawer on the right edge of your screen with a pulsing **● REC** badge.

buddy captures **system audio** (what comes out of your speakers — meeting participants' voices), not your microphone.

**2. Watch the transcript**

Words appear in real time as Scribe processes the audio:
- **Grey / italic** — partial result (still being refined)
- **White / normal** — committed (final)

The drawer auto-scrolls to the latest text. Scroll up to read back; a **↓ latest** button appears to jump back down.

**3. Stop recording**

Press **Ctrl+Shift+R** again, or click the **Stop** button in the drawer header.  
The drawer shows "● REC stopped" for 3 seconds, then collapses back to the compact card.

---

## System tray

buddy runs silently in the **system tray** (the hidden icons area, bottom-right of the taskbar).

**Right-click the tray icon** for the menu:

| Item | Action |
|---|---|
| ✓ **Start on login** | Checkmark = enabled. Click to toggle Windows startup. |
| **Quit buddy** | Exit the app completely |

> **Closing the overlay card** only *hides* the window — buddy keeps running in the tray.  
> To stop it entirely, use **Quit buddy** from the tray menu.

buddy enables **Start on login** automatically on first run so you never need to manually start it.

---

## Changing the hotkey

The default hotkey is `Ctrl+Shift+Space`. To change it:

1. Open `src-tauri/src/lib.rs`
2. Find `"CmdOrCtrl+Shift+Space"` and replace it with your preferred shortcut
3. Restart with `pnpm tauri dev` or rebuild

Valid modifier keys: `CmdOrCtrl`, `Ctrl`, `Alt`, `Shift`, `Super`

---

## Building a release

```bash
pnpm tauri build
```

Installers are written to `src-tauri/target/release/bundle/`:

```
bundle/
  nsis/   buddy_0.1.0_x64-setup.exe   ← Windows installer (share this)
  msi/    buddy_0.1.0_x64_en-US.msi   ← MSI alternative
```

GitHub Actions builds Windows + macOS automatically when you push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
# → CI builds all platforms and creates a draft GitHub Release
```

---

## Troubleshooting

**Setup screen keeps appearing after saving keys**
- Make sure all three fields are filled before clicking Save & start.

**Selector appears white/blank instead of showing a dark overlay**
- Restart `pnpm tauri dev`. WebView2 occasionally needs a warm frame on first show.

**Screenshot captures the desktop background instead of my app**
- buddy captures the **primary monitor**. Move your work to the primary display or change it in: Settings → System → Display → drag the primary monitor marker.

**No audio after `speaking…` status**
- Check your system volume and default audio output device.
- Verify your ElevenLabs Voice ID is valid (not the placeholder text).

**Error on startup: API key invalid**
- Delete `%APPDATA%\com.buddy.dev\config.json` and restart buddy to re-enter your keys via the setup screen.

**macOS: "buddy is damaged and can't be opened"**
```bash
xattr -cr /Applications/buddy.app
```

**`Error 1412 Failed to unregister class Chrome_WidgetWin_0` on quit**
Harmless — a WebView2 cleanup race during process exit. The app exits correctly.

---

## Roadmap

### v0.1.0 ✅
- Global hotkey (`Ctrl+Shift+Space`)
- Fullscreen region selector
- Claude vision analysis
- ElevenLabs TTS playback
- System tray with auto-start
- First-run API key setup screen

### v0.2.0 ✅ (current)
- Global hotkey (`Ctrl+Shift+R`) to toggle meeting capture
- WASAPI loopback — captures system audio, not the mic
- ElevenLabs Scribe v2 realtime streaming transcription
- Live transcript side drawer with partial / committed segments
- Auto-scroll with manual scroll-back support

### v0.3.0 (planned)
- [ ] Real-time translation of committed sentences via Claude Haiku
- [ ] Sentence-boundary buffering (handles verb-final languages)
- [ ] Two-line segment UI — original + translation
- [ ] Target language selector in drawer header

### Deferred
- Speaker diarization
- Save / export transcript
- Hotkey customization UI
- Multi-monitor support
- macOS ScreenCaptureKit audio path

---

## License

MIT © [Eka Prasetia](https://prasetia.me)
