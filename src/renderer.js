'use strict';

const $ = (id) => document.getElementById(id);

let config = {};
let answerBuffer = '';

// Audio capture state
let capturing = false;
let captureStream = null;
let mediaRecorder = null;
let autoAnswer = false;
let autoTimer = null;
const WINDOW_MS = 2000; // length of each audio window sent for transcription (lower = faster, less context)
const MIME = 'audio/webm;codecs=opus';

let audioCtx = null;
let analyser = null;
let meterTimer = null;
let processedStream = null; // the cleaned stream we actually record
let gateGain = null;        // noise-gate gain node
let cleanAudio = true;      // toggle: apply the cleanup chain
let windowPeak = 0;         // max RMS observed during the current window
const SPEECH_RMS_THRESHOLD = 0.012; // below this = treat the window as silence
const GATE_OPEN_RMS = 0.02;   // gate opens above this (let speech through)
const GATE_CLOSE_RMS = 0.012; // gate closes below this (cut reverb tail/noise)

/* ----------------------------------------------------------------
   Tab switching
----------------------------------------------------------------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    $('view-' + tab.dataset.view).classList.add('active');
  });
});

/* ----------------------------------------------------------------
   Window controls
----------------------------------------------------------------- */
$('btn-min').addEventListener('click', () => window.api.minimize());
$('btn-close').addEventListener('click', () => window.api.close());

/* ----------------------------------------------------------------
   Load + save config
----------------------------------------------------------------- */
async function loadConfig() {
  config = await window.api.getConfig();
  $('f-model').value = config.model || 'gpt-4o-mini';

  // The API key always comes from the bundled .env (OPENAI_API_KEY) — there is
  // no key field in the UI.
  if (config.modelFromEnv) {
    $('f-model').disabled = true;
  }
  $('f-jobTitle').value = config.jobTitle || '';
  $('f-company').value = config.company || '';
  $('f-note').value = config.note || '';
  $('f-jobDescription').value = config.jobDescription || '';
  $('f-resumeText').value = config.resumeText || '';
  $('resume-name').textContent = config.resumeFileName || 'No file selected';

  $('tg-aot').checked = !!config.alwaysOnTop;
  $('tg-stealth').checked = !!config.stealth;
}

$('btn-save').addEventListener('click', async () => {
  const patch = {
    model: $('f-model').value,
    jobTitle: $('f-jobTitle').value.trim(),
    company: $('f-company').value.trim(),
    note: $('f-note').value.trim(),
    jobDescription: $('f-jobDescription').value.trim(),
    resumeText: $('f-resumeText').value.trim(),
  };
  await window.api.setConfig(patch);
  config = await window.api.getConfig();
  const s = $('save-status');
  s.textContent = '✓ Saved';
  s.className = 'status ok';
  setTimeout(() => { s.textContent = ''; }, 2000);
});

/* ----------------------------------------------------------------
   Resume PDF picker
----------------------------------------------------------------- */
$('btn-pick-resume').addEventListener('click', async () => {
  const res = await window.api.pickResume();
  if (!res) return;
  $('resume-name').textContent = res.fileName;
  if (res.error) {
    $('f-resumeText').value = '';
    $('resume-name').textContent = res.fileName + ' (could not read — paste text manually)';
    return;
  }
  $('f-resumeText').value = res.text || '';
  await window.api.setConfig({ resumeText: res.text || '', resumeFileName: res.fileName });
});

/* ----------------------------------------------------------------
   Toggles: always-on-top + stealth
----------------------------------------------------------------- */
$('tg-aot').addEventListener('change', (e) => window.api.setAlwaysOnTop(e.target.checked));
$('tg-stealth').addEventListener('change', (e) => window.api.setStealth(e.target.checked));
// Keep the checkbox in sync when stealth is toggled from the tray menu.
window.api.onStealthChanged((v) => { $('tg-stealth').checked = !!v; });

/* ----------------------------------------------------------------
   Live audio capture -> OpenAI transcription (no typing needed).

   "Meeting audio" captures the system/loopback audio (what the
   interviewer says coming through your speakers). "Microphone"
   captures your own mic. Audio is recorded in short windows and
   each window is transcribed by Whisper, then appended below.
----------------------------------------------------------------- */
async function getStream(source) {
  if (source === 'mic') {
    // WebRTC echo cancellation + noise suppression help a lot with room reverb.
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  }
  // System/meeting audio via loopback. getDisplayMedia requires a video
  // request; the main process supplies loopback audio. We drop the video.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (stream.getAudioTracks().length === 0) {
    throw new Error('No system audio track. Make sure something is playing audio.');
  }
  return stream;
}

function recordWindow() {
  if (!capturing || !captureStream) return;
  let chunks = [];
  let rec;
  try {
    rec = new MediaRecorder(processedStream || captureStream, { mimeType: MIME });
  } catch (e) {
    setStatus('Recorder error: ' + e.message, 'err');
    return;
  }
  mediaRecorder = rec;

  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  rec.onstop = async () => {
    const peak = windowPeak; // loudness measured during THIS window
    // Start the next window immediately to minimise the gap (resets windowPeak).
    if (capturing) recordWindow();

    if (!chunks.length) return;
    // Voice-activity gate: skip windows that were essentially silent so Whisper
    // never gets a chance to hallucinate words onto silence.
    if (peak < SPEECH_RMS_THRESHOLD) return;

    const blob = new Blob(chunks, { type: MIME });
    if (blob.size < 1200) return;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await window.api.transcribe(bytes);
      if (res && res.error) { setStatus(res.error, 'err'); return; }
      const text = (res && res.text ? res.text : '').trim();
      if (text && !isLikelyNoise(text)) {
        appendTranscript(text);
        if (capturing) setStatus('● listening…');
      }
    } catch (err) {
      setStatus('Transcribe failed: ' + (err && err.message), 'err');
    }
  };

  windowPeak = 0; // reset loudness measurement for this window
  rec.start();
  setTimeout(() => { try { rec.stop(); } catch {} }, WINDOW_MS);
}

// Build the audio processing graph. When cleanAudio is on:
//   source -> highpass -> lowpass -> compressor -> [analyser] -> gate -> dest
// The analyser drives both the per-window loudness (VAD) and the noise gate.
// We record `processedStream` (post-gate), so reverb tails/background are removed.
function setupAudioGraph() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(captureStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;

    if (cleanAudio) {
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 120; // cut low rumble/room boom

      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7500; // cut hiss above speech band

      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -30; comp.knee.value = 20; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.25;

      gateGain = audioCtx.createGain();
      gateGain.gain.value = 0; // start closed

      const dest = audioCtx.createMediaStreamDestination();
      source.connect(hp); hp.connect(lp); lp.connect(comp);
      comp.connect(analyser); analyser.connect(gateGain); gateGain.connect(dest);
      processedStream = dest.stream;
    } else {
      gateGain = null;
      source.connect(analyser); // analyser only taps the signal
      processedStream = captureStream; // record the raw stream
    }

    const data = new Float32Array(analyser.fftSize);
    let open = false; // current gate state (hysteresis)
    meterTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      if (rms > windowPeak) windowPeak = rms;

      if (gateGain) {
        if (!open && rms > GATE_OPEN_RMS) open = true;
        else if (open && rms < GATE_CLOSE_RMS) open = false;
        // Fast attack so we don't clip word onsets; slower release to sound natural.
        gateGain.gain.setTargetAtTime(open ? 1 : 0, audioCtx.currentTime, open ? 0.01 : 0.06);
      }
    }, 25);
  } catch {
    processedStream = captureStream; // fall back to raw on any failure
  }
}

function teardownAudio() {
  clearInterval(meterTimer);
  meterTimer = null;
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  analyser = null;
  gateGain = null;
  processedStream = null;
  windowPeak = 0;
}

// Backup filter for Whisper's classic silence/background hallucinations.
function isLikelyNoise(text) {
  const t = text.toLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  const words = t.split(' ');
  const uniq = new Set(words);
  // Repeated single short word, e.g. "you you you".
  if (uniq.size === 1 && words[0].length <= 4) return true;
  const NOISE = new Set([
    'you', 'thank you', 'thanks', 'thank you very much', 'thanks for watching',
    'thank you for watching', 'please subscribe', 'subscribe', 'bye', 'bye bye',
    'okay', 'ok', 'uh', 'um', 'mm', 'hmm', 'yeah', 'so', 'the', 'a', 'i',
  ]);
  return NOISE.has(t);
}

function appendTranscript(text) {
  const ta = $('transcript');
  ta.value = (ta.value ? ta.value.trim() + ' ' : '') + text;
  ta.scrollTop = ta.scrollHeight;
  if (autoAnswer) scheduleAutoAnswer();
}

function scheduleAutoAnswer() {
  clearTimeout(autoTimer);
  // Wait for a short pause in speech, then answer automatically.
  autoTimer = setTimeout(() => { ask(); }, 1800);
}

async function startCapture() {
  const source = 'system'; // always listen to meeting audio (the other person), never the mic
  try {
    captureStream = await getStream(source);
  } catch (e) {
    setStatus('Capture failed: ' + (e && e.message || e), 'err');
    return;
  }
  captureStream.getAudioTracks().forEach((t) => {
    t.onended = () => { if (capturing) stopCapture(); };
  });
  capturing = true;
  $('btn-listen').textContent = '⏹ Stop listening';
  $('btn-listen').classList.add('listening');
  setStatus(source === 'mic' ? '● listening to mic…' : '● listening to meeting…');
  setupAudioGraph();
  recordWindow();
}

function stopCapture() {
  capturing = false;
  clearTimeout(autoTimer);
  teardownAudio();
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
  if (captureStream) {
    captureStream.getTracks().forEach((t) => t.stop());
    captureStream = null;
  }
  $('btn-listen').textContent = '🎙 Start listening';
  $('btn-listen').classList.remove('listening');
  setStatus('');
}

$('btn-listen').addEventListener('click', () => {
  if (capturing) stopCapture();
  else startCapture();
});

$('tg-auto').addEventListener('change', (e) => { autoAnswer = e.target.checked; });
$('tg-clean').addEventListener('change', (e) => {
  cleanAudio = e.target.checked;
  // Rebuild the audio graph live so the change takes effect immediately.
  if (capturing) { teardownAudio(); setupAudioGraph(); }
});

$('btn-clear-q').addEventListener('click', () => {
  $('transcript').value = '';
});

/* ----------------------------------------------------------------
   Build the system prompt from saved context
----------------------------------------------------------------- */
function buildSystemPrompt() {
  const c = config;
  const parts = [];
  parts.push(
    'You help a developer answer interview questions during a LIVE video call. They are NOT a native English speaker and will read your answer out loud right away, so it must be very easy to say.'
  );
  if (c.jobTitle) parts.push(`Role: ${c.jobTitle}${c.company ? ' at ' + c.company : ''}.`);
  if (c.jobDescription) parts.push(`Job description:\n${c.jobDescription}`);
  if (c.resumeText) parts.push(`Candidate's resume:\n${c.resumeText}`);
  if (c.note) parts.push(`Candidate's note: ${c.note}`);

  parts.push(
    'The question may be HR/behavioral OR technical (concepts, tools, experience) — answer whatever is asked. For behavioral questions, be warm and use the resume. For technical questions, be correct and concrete, but do NOT write code.'
  );

  parts.push(
    'ANSWER RULES (very important):\n' +
    '- Speak in the FIRST PERSON, as the candidate ("I", "my").\n' +
    '- MAXIMUM 3 short sentences. Shorter is better.\n' +
    '- Use very simple, easy English. Short common words. Short sentences. Easy to pronounce.\n' +
    '- Sound natural, calm, and confident.\n' +
    '- Give ONLY the answer. No greeting, no "Here is", no notes, no markdown, no bullet points, no code.'
  );
  return parts.join('\n\n');
}

/* ----------------------------------------------------------------
   Ask ChatGPT (streaming)
----------------------------------------------------------------- */
function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text || '';
  s.className = 'status' + (cls ? ' ' + cls : '');
}

function ask() {
  const question = $('transcript').value.trim();
  if (!question) { setStatus('Nothing to answer yet', 'err'); return; }
  if (!config.apiKey) { setStatus('No API key — set OPENAI_API_KEY in the .env file', 'err'); return; }

  answerBuffer = '';
  $('answer').innerHTML = '<span class="cursor">&nbsp;</span>';
  setStatus('Thinking…');
  $('btn-stop').disabled = false;

  window.api.ask({
    model: config.model,
    apiKey: config.apiKey,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: question }],
    maxTokens: 200, // answers are max 3 short sentences -> faster completion
  });

  // Clear the question box so the next thing the interviewer says starts fresh.
  $('transcript').value = '';
}

$('btn-ask').addEventListener('click', ask);
$('btn-stop').addEventListener('click', () => window.api.stop());

// Ctrl+Enter from the transcript box also triggers an answer.
$('transcript').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(); }
});

window.api.onChunk((text) => {
  answerBuffer += text;
  $('answer').innerHTML = renderMarkdown(answerBuffer) + '<span class="cursor">&nbsp;</span>';
  $('answer').scrollTop = $('answer').scrollHeight;
  setStatus('Streaming…');
});

window.api.onDone(() => {
  $('answer').innerHTML = renderMarkdown(answerBuffer);
  setStatus('Done', 'ok');
  $('btn-stop').disabled = true;
});

window.api.onError((msg) => {
  setStatus(msg, 'err');
  $('btn-stop').disabled = true;
});

/* ----------------------------------------------------------------
   Tiny, safe markdown renderer (code fences, inline code, headings,
   bold, lists, paragraphs). Escapes HTML first to avoid injection.
----------------------------------------------------------------- */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(md) {
  // Extract fenced code blocks first so their content isn't mangled.
  const blocks = [];
  md = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(code.replace(/\n$/, ''));
    return ` BLOCK${blocks.length - 1} `;
  });

  let html = escapeHtml(md);

  // inline code
  html = html.replace(/`([^`]+)`/g, (_m, c) => `<code class="inline">${c}</code>`);
  // bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // headings
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // unordered lists
  html = html.replace(/(?:^[-*]\s+.*(?:\n|$))+/gm, (block) => {
    const items = block.trim().split('\n').map((l) => l.replace(/^[-*]\s+/, '')).map((t) => `<li>${t}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  // ordered lists
  html = html.replace(/(?:^\d+\.\s+.*(?:\n|$))+/gm, (block) => {
    const items = block.trim().split('\n').map((l) => l.replace(/^\d+\.\s+/, '')).map((t) => `<li>${t}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // paragraphs / line breaks for remaining text
  html = html.split(/\n{2,}/).map((chunk) => {
    if (/^\s*<(h\d|ul|ol|pre)/.test(chunk)) return chunk;
    return '<p>' + chunk.replace(/\n/g, '<br/>') + '</p>';
  }).join('');

  // restore code blocks
  html = html.replace(/ BLOCK(\d+) /g, (_m, i) => `<pre><code>${escapeHtml(blocks[Number(i)])}</code></pre>`);

  return html;
}

/* ----------------------------------------------------------------
   Init
----------------------------------------------------------------- */
loadConfig();
