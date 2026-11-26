# App Volume Dial

**One Stream Deck + dial that controls the volume of whatever is making sound
on your PC right now.**

Turn it to change the volume. Click it to jump to the next program. That's it.

---

## The problem this solves

Most methods for creating a knob cycle for audio has issues, either programs randomly dropping, or 
having to manually add individual audio programs into an infinite cycle pool which just becomes tedious when said programs are no longer runing 

Programs you closed months ago still sit in the
rotation. 

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
they won't come back on their own. This solves the issue of having too many programs on the dial 
as a default. I want the user to feel comfortable knowing that only important programs that require manual 
editing is accessible and stress free. So, choose you banish some programs (they will stay at the audio level of your choice) 
so the button won't have to worry about dealing with it in the cycle. 

### Getting them back

**Hold the touchscreen** (the little display above the dial, not the dial
itself). Everything you've banished returns at once, and it tells you how many
came back.

That's all-or-nothing for now — there's no way to un-banish a single program. I may think of a smarter way to return specific individual audio track, or maybe a control+Z type of method for restoring deleted apps
But for now, it stays as is. It gets the job done; Ive given you 3 seconds to make your choice! suffer the consequences of fully resetting all audio tracks and having to banish unwanted programs

## Why banishing is manual

Windows only tells us two things about a program: it's making sound right
now, or it isn't. That's all.

So an idle screenshot tool and a *paused game* look exactly the same from
here. Any clever auto-hiding rule would eventually decide your game was
inactive and remove it mid-session, which is far more annoying than clicking
past something once. One deliberate hold beats a guess that fails at the worst
moment.

## Install

1. Copy the `appvoldial` folder into your Stream Deck plugins directory,
   renamed exactly:

   ```
   %APPDATA%\Elgato\StreamDeck\Plugins\com.varkness.appvoldial.sdPlugin\
   ```

2. Restart the Stream Deck app.
3. Drag **App Volume (press to cycle)** onto a dial.

Needs Windows 10 or later and Stream Deck software 6.5+ with a device that has
dials. Nothing else to install — no packages, no extra services, no account.

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
