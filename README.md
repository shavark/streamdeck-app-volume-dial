# App Volume Dial

**One Stream Deck + dial that controls the volume of whatever is making sound
on your PC right now.**

Turn it to change the volume. Click it to jump to the next program. That's it
It only lets you cycle between apps and programs that are actively running! you're free to 
manually remove bloat app's that don't make much noise to declutter the mess.

---

## The problem this solves

Most methods for creating a knob cycle for audio have issues: either programs
randomly dropping, or having to manually add individual audio programs into an
infinite cycle pool, which just becomes tedious when said programs are no
longer running.

Programs you closed months ago still sit in the rotation.

You end up with an endless pool of dead and pointless entries to click past
before you reach the one thing you actually wanted to turn down. It's not
worth using.

## What this does instead

**It builds the list itself, continuously, from whatever is actually playing
audio.**

- Open a game — it appears on the dial.
- Close it — it's gone.
- Start something brand new — it's already there, no setup.

You never configure anything. There's no list to maintain, nothing to point at
a file path, nothing that can rot. If a program is making sound, it's on your
dial. If it isn't, it isn't.

## Controls

| What you do | What happens |
|---|---|
| **Turn the dial** | Volume of the program shown |
| **Click the dial** | Jump to the next program making sound |
| **Hold the dial (3 seconds)** | **Banish** that program — see below |
| **Tap the screen** | Mute / unmute it |
| **Hold the screen** | Bring every banished program back |

The dial shows the program's real icon, its name, where you are in the
rotation (`2/4`), the volume percentage and a level bar.

## Banishing

Some programs make sound but you never want to adjust them. A chat app, a
launcher, a screenshot tool. They sit at 100% forever and you'd rather not
click past them.

**Hold the dial for 3 seconds and that program is gone from the rotation.**

While you hold, the dial counts down and fills a bar, so you always know it's
coming and can let go to cancel. It's deliberately slow — banishing should
never happen by accident on a dial you're spinning all day.

Banished programs stay banished. Closing them, reopening them, rebooting —
they won't come back on their own. This solves the issue of having too many
programs on the dial as a default. I want the user to feel comfortable knowing
that only important programs that require manual editing are accessible, and
stress free. So, you choose to banish some programs (they will stay at the
audio level of your choice) so the dial won't have to worry about dealing with
them in the cycle.

### Getting them back

**Hold the touchscreen** (the little display above the dial, not the dial
itself). Everything you've banished returns at once, and it tells you how many
came back.

That's all-or-nothing for now — there's no way to un-banish a single program.
I may think of a smarter way to return a specific individual audio track, or
maybe a Ctrl+Z type of method for restoring deleted apps. But for now, it
stays as is. It gets the job done; I've given you 3 seconds to make your
choice! Suffer the consequences of fully resetting all audio tracks and having
to banish unwanted programs.

## Why banishing is manual

Windows only tells us two things about a program: it's making sound right
now, or it isn't. That's all.

So an idle screenshot tool and a *paused game* look exactly the same from
here. Any clever auto-hiding rule would eventually decide your game was
inactive and remove it mid-session, which is far more annoying than clicking
past something once. One deliberate hold beats a guess that fails at the worst
moment.

## Install

There's no installer yet, so it's a copy-a-folder job. Five minutes, and you
only do it once.

1. **Download it.** Green **Code** button at the top of this page →
   **Download ZIP**.

2. **Extract it.** You'll get a folder called
   `streamdeck-app-volume-dial-main`.

3. **Rename that folder** to exactly:

   ```
   com.varkness.appvoldial.sdPlugin
   ```

   The name matters — Stream Deck ignores folders that don't end in
   `.sdPlugin`. If Windows hides file extensions you may not see the
   `.sdPlugin` part after renaming; that's fine.

4. **Open the plugins folder.** Press `Win + R`, paste this, press Enter:

   ```
   %APPDATA%\Elgato\StreamDeck\Plugins
   ```

5. **Move your renamed folder into it.**

6. **Fully quit Stream Deck and reopen it.** Right-click the Stream Deck icon
   in the system tray → **Quit**. Closing the window isn't enough — it keeps
   running in the tray and won't notice the new plugin.

7. In Stream Deck, find **App Volume Dial** in the actions list on the right
   and **drag "App Volume (press to cycle)" onto one of your dials.**

The dial should immediately show whatever is making sound. If nothing is
playing, it'll say `No audio` until something does.

### If it doesn't show up

Check `%APPDATA%\Elgato\StreamDeck\logs\com.varkness.appvoldial0.log`. Working
looks like this:

```
registered with Stream Deck
audio helper ready
```

No log file at all almost always means the folder name is wrong, or the folder
isn't directly inside `Plugins` — a common slip is ending up with
`Plugins\com.varkness.appvoldial.sdPlugin\streamdeck-app-volume-dial-main\`,
one level too deep. `manifest.json` must sit directly inside the
`.sdPlugin` folder.

If the log says `registered with Stream Deck` but never `audio helper ready`,
Windows is refusing to run the helper script. This was tested on a normal
Windows 11 machine with the files still marked as internet-downloaded and it
worked fine, so you shouldn't hit it — but on a locked-down or work machine,
right-click the ZIP → **Properties** → tick **Unblock** → **OK**, then
extract and install again.

### Requirements

Windows 10 or later, and Stream Deck software 6.5+ with a device that has
dials (Stream Deck +). Nothing else to install — no packages, no extra
services, no account, no admin rights.

## Known limits

- **Browser tabs can't be separated.** Chrome and Brave mix every tab into one
  audio stream, so three YouTube tabs show up as a single "Brave" and move
  together. Windows doesn't offer per-tab volume to any program, so nothing
  can fix this. If you need two videos balanced against each other, play one
  in a different browser.
- **Un-banishing is all-or-nothing**, as above.

---

## For developers

Two pieces, no dependencies:

- **`bin/plugin.js`** — the plugin. Speaks the Stream Deck WebSocket protocol
  directly over a TCP socket with a small hand-written RFC 6455 client, since
  the bundled Node 20 has no global `WebSocket` and this avoids any npm
  install.
- **`bin/audio-helper.ps1`** — a long-lived helper. One command per line on
  stdin, one JSON line out (`list`, `set <pid> <vol>`, `toggle <pid>`,
  `icon <pid>`). Talks to Core Audio through P/Invoke. Stays running so dial
  turns never pay process-startup cost.

Two traps worth knowing if you build something similar:

- **Don't call `IsSystemSoundsSession()` through this interop.** Its HRESULT
  marshals unreliably and silently returned zero sessions for me. The Windows
  system-sounds session reports PID 0, so filter on that instead.
- **Chromium and Electron apps own their audio in a child process.** Brave's
  window was PID 72380 while its audio session was PID 68992. Anything that
  resolves an `.exe` to a process and matches that PID will always fail on
  Brave, Chrome, Discord and Electron apps. Enumerating audio sessions avoids
  the problem entirely — and is why this plugin works on them when others
  don't.

## Licence

MIT — see `LICENSE`.
