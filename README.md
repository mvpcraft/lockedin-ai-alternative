# Interview Copilot

A private, real-time AI interview assistant for you and a friend — a self-hosted
alternative to LockedIn AI, powered by **your own OpenAI (ChatGPT) API key**.

Single Electron desktop app. Nothing is sent anywhere except directly to the
OpenAI API with your key. Config and resume text are stored locally on your
machine only.

## Features

- **Setup**: job title, company, "note for AI", job description, and **resume PDF
  upload** (text is auto-extracted).
- **Live**: automatically captures and transcribes the **interviewer's voice**
  (system/loopback audio) via Whisper — no typing — then streams ChatGPT's answer.
  Optional **Auto-answer** for fully hands-free use.
- **Short, fast answers**: replies are max **3 short sentences** in **easy English**
  (made for non-native speakers to read out loud), first-person, no preamble.
- **Any question type**: it automatically handles both HR/behavioral and technical
  questions (no mode to pick) — no live coding. Optimized for quick HR and tech
  interviews.
- **Stealth**: *Hide from screen share* (the overlay is invisible in Zoom/Teams/Meet
  screen sharing and recordings) and *Always on top*.
- **Finding the window**: the app has no taskbar button (by design). To bring it back:
  - click the **green tray icon** next to the clock (right-click it for a menu), or
  - press **Ctrl+\\** to show/hide, or **Ctrl+Shift+\\** to force it to the front, or
  - **Alt+Tab** to it.

## Setup

```bash
npm install
cp .env.example .env      # then edit .env and paste your key
npm start
```

Put your OpenAI API key in **`.env`**:

```
OPENAI_API_KEY=sk-...
# optional: OPENAI_MODEL=gpt-4o
```

The app reads the key from `.env` (it takes priority over the UI, and the Setup
field becomes read-only when a `.env` key is present). `.env` is gitignored.

Then in the app:

1. Open **Setup**, pick a model, fill in the job details, and upload your resume PDF.
   Click **Save**. (No need to enter the API key here if it's in `.env`.)
2. Go to **Live**.

## Capturing the interviewer's voice (no typing)

On the **Live** tab choose the audio source and click **Start listening**:

- **🔊 Meeting audio (them)** — captures your computer's system/loopback audio, i.e.
  whatever the interviewer says through Zoom/Teams/Meet. *No virtual cable or Stereo
  Mix needed* — it's captured directly. (Windows works out of the box; on macOS,
  system-audio loopback may need a helper like BlackHole.)
- **🎤 Microphone (you)** — captures your own mic instead.

Audio is recorded in ~5-second windows and transcribed by **OpenAI Whisper**, then
appended to the box automatically. Then click **⚡ Get answer**, or enable
**Auto-answer** to have GPT respond hands-free after each pause in speech.

> Transcription uses your OpenAI key (the `whisper-1` model by default; override with
> `OPENAI_TRANSCRIBE_MODEL` in `.env`). You can still paste/type a question manually
> anytime.

## Build an installer

```bash
npm run dist:win     # Windows .exe (NSIS)
# or: npm run dist   # current platform
```

## Notes

- Models are selectable in Setup. **GPT-4o mini is the default** (fastest, lowest
  latency — best for live use); GPT-4o / GPT-4.1 are smarter but a bit slower.
- Using AI assistance during a real interview may violate the employer's or
  platform's rules. Use responsibly — this is great for **practice and prep**.
