# buddy

> A minimal desktop AI assistant, press a hotkey, draw a region, hear the answer spoken aloud.
```
Ctrl+Shift+Space  →  draw a region  →  Claude sees it  →  ElevenLabs speaks the answer
```

[![CI](https://github.com/ekaone/buddy/actions/workflows/ci.yml/badge.svg)](https://github.com/ekaone/buddy/actions/workflows/ci.yml)
[![Release](https://github.com/ekaone/buddy/actions/workflows/release.yml/badge.svg)](https://github.com/ekaone/buddy/releases)

---

## What it does

buddy sits silently in your **system tray**. Press the hotkey anywhere and a fullscreen crosshair selector appears. Draw a rectangle around anything on screen — a question, an error message, a diagram, a document — and within seconds Claude describes it and ElevenLabs reads the answer out loud. The overlay card disappears automatically after speaking.

No window stays open. No taskbar button. Just a hotkey.

---

## Requirements

| | |
|---|---|
| **OS** | Windows 10 / 11 (macOS planned) |
| **Anthropic API key** | [console.anthropic.com](https://console.anthropic.com) — free tier works |
| **ElevenLabs API key** | [elevenlabs.io](https://elevenlabs.io) — free tier: 10 k chars/month |
| **ElevenLabs Voice ID** | Any voice from the library |

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

### 1. Trigger buddy

Press **Ctrl+Shift+Space** from anywhere on your desktop.

A dark fullscreen overlay appears with the message *"Drag to select an area"*.

### 2. Select a region

Click and drag to draw a rectangle around what you want Claude to analyse.  
A dimension badge (e.g. `823×418`) appears at the top-left of your selection.

| Key / Action | Result |
|---|---|
| **Drag** | Draw selection |
| **Release mouse** | Confirm selection, start pipeline |
| **Esc** | Cancel — close the selector |
| **Ctrl+Shift+Space** (again) | Cancel current response and reopen selector |

### 3. Watch the pipeline

After releasing the mouse, the selector closes and a small overlay card appears in the **bottom-right corner** of your screen:

| Badge | What's happening |
|---|---|
| 🔵 `capturing…` | Taking a screenshot of your selected area |
| 🟣 `thinking…` | Sending the image to Claude for analysis |
| 🟢 `speaking…` | ElevenLabs is reading the answer aloud |
| `idle` | Done — overlay auto-hides in 4 seconds |
| `error` | Something went wrong (see Troubleshooting) |

The full Claude response is shown as scrollable text inside the card.

### 4. Listen and read

Claude's answer is read aloud automatically. The card shows the full transcript in case you miss anything or want to re-read it.

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
- Right-click the tray icon → there is no settings option yet (v0.2.0 roadmap).
- For now: delete `%APPDATA%\com.buddy.dev\config.json` and restart buddy to re-enter your keys.

**macOS: "buddy is damaged and can't be opened"**
```bash
xattr -cr /Applications/buddy.app
```

**`Error 1412 Failed to unregister class Chrome_WidgetWin_0` on quit**
Harmless — a WebView2 cleanup race during process exit. The app exits correctly.

---

## Roadmap

### v0.1.0 ✅ (current)
- Global hotkey listener
- Fullscreen area selector
- Claude vision analysis
- ElevenLabs TTS playback
- System tray with auto-start
- First-run API key setup screen

### v0.2.0 (planned)
- [ ] Settings screen accessible from tray (to update keys)
- [ ] Hotkey customization UI
- [ ] Voice selector
- [ ] Transcript history
- [ ] Multi-monitor support
- [ ] Mute / abort mid-speech

---

## License

MIT © [Eka Prasetia](https://prasetia.me)
