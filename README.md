# Interview Copilot

A private, real-time AI interview assistant for you and a friend — a self-hosted
alternative to LockedIn AI, powered by **your own OpenAI (ChatGPT) API key**.

Single Electron desktop app. Nothing is sent anywhere except directly to the
OpenAI API with your key. Config and resume text are stored locally on your
machine only.

## Overview

Interview Copilot is a frameless desktop overlay that sits invisibly on top of your
video call and feeds you answers in real time. It listens to the **interviewer's
voice** through your computer's system audio, transcribes it with **OpenAI Whisper**,
and streams back a short, ready-to-read answer from **ChatGPT** — all using your own
API key, with nothing routed through any third-party server.

**How it works:**

1. **Listen** — the app captures system/loopback audio (what the interviewer says in
   Zoom/Teams/Meet) in ~5-second windows. A loudness gate and phrase filter drop
   silence and Whisper hallucinations so only real speech is transcribed.
2. **Transcribe** — each window is sent to Whisper and appended to the live transcript.
3. **Answer** — ChatGPT generates a reply tailored by your **resume, job title,
   company, and job description**, written as **max 3 short sentences in easy English**,
   first-person, ready to read aloud. Trigger it with **⚡ Get answer** or let
   **Auto-answer** fire automatically after each pause in speech.

**Designed to stay out of the way:** the overlay is hidden from screen sharing and
recordings, has no taskbar button, stays always-on-top, and is summoned with a global
hotkey or the system tray icon.

**Built with:** Electron (main + renderer, no bundler), plain HTML/CSS/JS, and direct
REST calls to the OpenAI API (chat completions with SSE streaming + audio
transcriptions) — no AI SDK dependency. PDF resumes are parsed locally with
`pdf-parse`.

> ⚠️ For practice and prep. Using AI assistance during a real interview may violate the
> employer's or platform's rules — use responsibly.

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
