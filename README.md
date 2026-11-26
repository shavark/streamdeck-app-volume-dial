# App Volume Dial

A Stream Deck + plugin that gives you **per-app volume on a single dial**.

Turn the dial to change the volume of one app. **Click the dial to jump to the
next app that is actually making sound right now.** The list builds itself from
the Windows audio session API, so you never configure anything and closed
programs never clutter the rotation.

| Gesture | Does |
|---|---|
| Turn | Volume of the selected app (2% per tick) |
| Click the dial | Next app that is making sound |
| Hold the dial 3s | Hide that app from the cycle (remembered) |
| Tap the screen | Mute / unmute |
| Hold the screen | Un-hide everything |

The dial shows the app's real icon, its name, its position in the cycle
(`2/4`), the volume percentage and a level bar.

## Why this exists

Elgato's own Volume Controller plugin can't do this, in two different ways:

- Its **Manual Software Detection** pins each entry to an `.exe` path. Those
  paths rot — Discord renames its install folder on every update, and the
  entry silently dies.
- Its **Auto Software Detection** finds live apps correctly, but puts the
  cycling on separate *key* actions and leaves the dial press as mute. On a
  Stream Deck + you only have four dials; spending two keys to work around a
  dial that already clicks defeats the point of the hardware.

A dial stack of several auto-volume entries doesn't help either — the plugin
assigns apps by dial *position*, so every slot in the stack shows the same app.

As far as I can tell, nothing on Windows does press-to-cycle over live audio
apps. The plugins that do are Linux/OpenDeck only. Hence this.

## Requirements

- Windows 10 or later
- Stream Deck software 6.5+ with a device that has dials (Stream Deck +)
- Nothing else. No npm packages, no .NET SDK, no extra services.

## Install

1. Copy the `appvoldial` folder into your plugins directory, named exactly:

   ```
   %APPDATA%\Elgato\StreamDeck\Plugins\com.varkness.appvoldial.sdPlugin\
   ```

2. Restart the Stream Deck app.
3. Drag **App Volume (press to cycle)** onto a dial.

To confirm it loaded, check
`%APPDATA%\Elgato\StreamDeck\logs\com.varkness.appvoldial0.log` — you should see
`registered with Stream Deck` and `audio helper ready`.

## How it works

Two pieces:

- **`bin/plugin.js`** — the plugin. Speaks the Stream Deck WebSocket protocol
  directly over a TCP socket, with a small hand-written RFC 6455 client.
  Stream Deck bundles Node 20, which has no global `WebSocket`, and this way
  there are no dependencies to install or audit.
- **`bin/audio-helper.ps1`** — a long-lived helper process. One command per
  line on stdin, one JSON line per reply on stdout (`list`, `set <pid> <vol>`,
  `toggle <pid>`, `icon <pid>`). It talks to Core Audio
  (`IAudioSessionManager2` / `IAudioSessionControl2` / `ISimpleAudioVolume`)
  through P/Invoke. It stays running so turning the dial never pays process
  startup cost.

Two things worth knowing if you build on this:

- **Don't call `IsSystemSoundsSession()` through this interop.** Its HRESULT
  marshals unreliably and silently returned zero sessions. The Windows
  system-sounds session reports PID 0, so filtering on that covers it.
- **Chromium and Electron apps own their audio in a child process.** Brave's
  window was PID 72380 while its audio session was PID 68992
  (`--utility-sub-type=audio.mojom.AudioService`). Anything that resolves an
  `.exe` to a process and matches that PID will always fail on Brave, Chrome,
  Discord and Electron apps. Enumerating sessions avoids the problem entirely.

## Limitations

- **Browser tabs can't be separated.** Chromium mixes all tabs into one audio
  session, so several YouTube tabs appear as a single "Brave" and move
  together. Windows doesn't expose per-tab volume to anyone. Put the second
  video in a different browser if you need independent control.
- **Un-hiding is all-or-nothing.** Holding the screen restores every hidden
  app. Per-app un-hiding (and a user-settable hold duration) would need a
  Property Inspector, which isn't built.
- **Hiding is manual by design.** Windows only reports "making sound now" or
  "not", so an idle screenshot tool and a paused game look identical. Any
  auto-hide heuristic would eventually hide a game mid-session.

## Licence

MIT — see `LICENSE`.
