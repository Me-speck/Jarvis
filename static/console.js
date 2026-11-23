import { VoiceSession } from "./voice-session.js";

const byId = (id) => document.getElementById(id);
const form = byId("command-form");
const input = byId("command");
const status = byId("status");
const messages = byId("messages");
const mic = byId("mic");
const speak = byId("speak");
const handsFree = byId("hands-free");
const storageKey = "jarvis-workspace-v1";
const history = [];
let workspace = { notes: [], tasks: [], timers: [] };
let busy = false;
let voiceEnabled = false;
let speechSequence = 0;
const player = new Audio();
let speechURL;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Object.keys(workspace).every((key) => Array.isArray(saved[key]))) {
    workspace = saved;
  }
} catch {
  status.textContent = "Saved workspace could not be loaded.";
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(workspace));
  } catch {
    status.textContent = "Browser storage is unavailable. Changes last for this session.";
  }
}

function addMessage(role, content) {
  byId("welcome")?.remove();
  const row = document.createElement("article");
  row.className = "message " + role;
  const name = document.createElement("strong");
  name.textContent = role === "user" ? "You" : "Jarvis";
  const body = document.createElement("p");
  body.textContent = content;
  row.append(name, body);
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
}

function updateTimerLabel(label, deadline, now) {
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  label.textContent = remaining ? minutes + ":" + seconds : "Complete";
}

function renderList(key, empty) {
  const list = byId(key);
  list.replaceChildren();
  if (!workspace[key].length) {
    const placeholder = document.createElement("li");
    placeholder.className = "empty";
    placeholder.textContent = empty;
    list.append(placeholder);
    return;
  }
  workspace[key].forEach((item, index) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    if (key === "timers") {
      label.dataset.deadline = item.deadline;
      updateTimerLabel(label, item.deadline, Date.now());
    } else {
      label.textContent = item.text;
    }
    if (key === "tasks") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("aria-label", "Complete task: " + item.text);
      checkbox.checked = item.done;
      label.classList.toggle("done", item.done);
      checkbox.addEventListener("change", () => {
        item.done = checkbox.checked;
        label.classList.toggle("done", item.done);
        save();
      });
      row.append(checkbox);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove " + key.slice(0, -1));
    remove.addEventListener("click", () => {
      workspace[key].splice(index, 1);
      save();
      renderWorkspace();
      (list.querySelectorAll(".remove")[index] || list.querySelector(".remove") || input).focus();
    });
    row.append(label, remove);
    list.append(row);
  });
}

function renderWorkspace() {
  renderList("timers", "No timers yet");
  renderList("tasks", "No tasks yet");
  renderList("notes", "No notes yet");
}

function tick() {
  const date = new Date();
  byId("clock").textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  byId("date").textContent = date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  document.querySelectorAll("[data-deadline]").forEach((label) => {
    updateTimerLabel(label, Number(label.dataset.deadline), date.getTime());
  });
  const finished = workspace.timers.filter((timer) => !timer.announced && timer.deadline <= date.getTime());
  if (finished.length) {
    finished.forEach((timer) => { timer.announced = true; });
    save();
    const notice = finished.length === 1 ? "Your timer is complete." : finished.length + " timers are complete.";
    addMessage("assistant", notice);
    if (session.state === "listening" && !session.utterance && !busy) {
      const context = session.context;
      speakInSession(notice, context).finally(() => {
        if (session.context === context) session.resume();
      });
    } else if (voiceEnabled && session.state === "off") {
      readAloud(notice);
    }
  }
}

function applyAction(action) {
  if (action.kind === "clock") {
    return "Your local date and time: " + new Date().toLocaleString();
  }
  if (action.kind === "list") {
    const entries = workspace[action.list];
    if (!entries.length) return "You have no " + action.list + ".";
    const summary = entries.slice(0, 4).map(item =>
      item.text.slice(0, 90) + (action.list === "tasks" ? (item.done ? " (complete)" : " (open)") : "")
    ).join(". ");
    return `You have ${entries.length} ${action.list}. ${summary}`;
  }
  const key = action.kind + "s";
  if (workspace[key].length >= 50) {
    return "You have 50 " + key + ". Remove one in the sidebar to make room.";
  }
  const item = action.kind === "timer"
    ? { deadline: Date.now() + action.seconds * 1000, announced: false }
    : { text: action.text, done: false };
  workspace[key].unshift(item);
  save();
  renderWorkspace();
  if (action.kind === "note") return "Note saved.";
  if (action.kind === "task") return "Task added.";
  return "Timer started.";
}

async function sendCommand(command, context = null) {
  if (!command || busy) return;
  if (context && /^(?:(?:hey )?jarvis[,:]? +)?(?:stop listening|end (?:the )?conversation|good(?:-| )?bye)[!.?]*$/i.test(command)) {
    addMessage("user", command);
    addMessage("assistant", "Voice conversation ended.");
    session.stop();
    status.textContent = "Voice conversation ended.";
    return;
  }
  busy = true;
  byId("send").disabled = true;
  if (context) session.pause("thinking");
  else status.textContent = "Working…";
  addMessage("user", command);
  try {
    const response = await fetch("/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, history: history.slice(-12), voice: Boolean(context) }),
    });
    const data = await response.json();
    const reply = data.action ? applyAction(data.action) : data.response;
    addMessage("assistant", reply);
    if (response.ok && !data.action) {
      history.push(
        { role: "user", content: command.slice(0, 600) },
        { role: "assistant", content: reply.slice(0, 600) },
      );
      if (history.length > 12) history.splice(0, history.length - 12);
    }
    if (context) await speakInSession(reply, context);
    else if (voiceEnabled) readAloud(reply);
  } catch {
    const reply = "The server couldn't be reached. Please try again.";
    addMessage("assistant", reply);
    if (context) await speakInSession(reply, context);
    else {
      if (voiceEnabled) readAloud(reply);
      if (!input.value) input.value = command;
    }
  } finally {
    busy = false;
    byId("send").disabled = false;
    if (context && session.context === context) session.resume();
    else if (!context && session.state === "off") status.textContent = "";
    refreshVoiceControls();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const command = input.value.trim();
  if (!command || busy || (session.state !== "off" && session.state !== "listening")) return;
  input.value = "";
  sendCommand(command, session.context);
});

document.querySelectorAll("[data-draft]").forEach((button) => {
  button.addEventListener("click", () => {
    input.value = button.dataset.draft;
    input.focus();
  });
});

function stopPlayback() {
  ++speechSequence;
  player.pause();
  player.removeAttribute("src");
  if (speechURL) {
    URL.revokeObjectURL(speechURL);
    speechURL = undefined;
  }
}

async function requestSpeech(text) {
  const response = await fetch("/speech/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 600) }),
  });
  if (!response.ok) throw new Error("Speech synthesis failed.");
  return response;
}

async function readAloud(text) {
  stopPlayback();
  const sequence = speechSequence;
  try {
    const audio = await (await requestSpeech(text)).blob();
    if (sequence !== speechSequence) return;
    speechURL = URL.createObjectURL(audio);
    player.src = speechURL;
    await player.play();
  } catch {
    if (sequence !== speechSequence) return;
    stopPlayback();
    status.textContent = "Couldn't play the local voice. The reply is still in the chat.";
  }
}

player.addEventListener("ended", stopPlayback);

if (document.body.dataset.speech === "true") {
  speak.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    speak.textContent = voiceEnabled ? "Voice on" : "Voice off";
    speak.setAttribute("aria-pressed", String(voiceEnabled));
    if (!voiceEnabled) stopPlayback();
  });
} else {
  speak.disabled = true;
  speak.textContent = "Voice unavailable";
}

const mediaTypes = ["audio/webm", "audio/ogg", "audio/mp4"];
const recordingType = window.MediaRecorder && mediaTypes.find((type) => MediaRecorder.isTypeSupported(type));
let recorder;

const states = {
  off: "", starting: "Waiting for microphone access…", listening: "Listening. Speak naturally.",
  transcribing: "Transcribing locally…", thinking: "Jarvis is thinking…", speaking: "Jarvis is speaking…",
};

function refreshVoiceControls() {
  const active = session.state !== "off";
  handsFree.disabled = !handsFreeSupported || (!active && (busy || Boolean(recorder)));
  handsFree.textContent = active ? "End voice conversation" : "Start voice conversation";
  handsFree.setAttribute("aria-pressed", String(active));
  mic.disabled = !manualSupported || active || (Boolean(recorder) && recorder.state !== "recording");
  speak.disabled = document.body.dataset.speech !== "true" || active;
}

async function speakInSession(text, context) {
  if (session.context !== context) return;
  session.pause("speaking");
  try {
    const audio = await (await requestSpeech(text)).arrayBuffer();
    if (session.context === context) await session.play(audio);
  } catch {
    if (session.context === context) addMessage("assistant", "The spoken reply could not be played.");
  }
}

async function transcribeBlob(blob) {
  const response = await fetch("/speech/transcribe", { method: "POST", body: blob });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data.transcript?.trim().slice(0, 2000) ?? "";
}

const manualSupported = document.body.dataset.transcription === "true" && recordingType &&
  Boolean(navigator.mediaDevices?.getUserMedia);
const handsFreeSupported = document.body.dataset.transcription === "true" &&
  document.body.dataset.speech === "true" && Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
const session = new VoiceSession(async audio => {
  const context = session.context;
  try {
    const transcript = await transcribeBlob(audio);
    if (session.context !== context) return;
    if (transcript) await sendCommand(transcript, context);
    else session.resume();
  } catch {
    if (session.context === context) {
      session.resume();
      status.textContent = "Couldn't transcribe that. Try speaking again.";
    }
  }
}, state => {
  status.textContent = states[state];
  byId("voice-indicator").dataset.state = state;
  refreshVoiceControls();
});

handsFree.addEventListener("click", async () => {
  if (session.state !== "off") {
    session.stop();
    return;
  }
  stopPlayback();
  try {
    await session.start();
  } catch {
    status.textContent = "Couldn't start voice. Check microphone permissions and use HTTPS or localhost.";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && session.state !== "off") session.stop();
});
window.addEventListener("pagehide", () => {
  if (session.state !== "off") session.stop();
});

async function recordSpeech() {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  mic.disabled = true;
  handsFree.disabled = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream, { mimeType: recordingType, audioBitsPerSecond: 32000 });
    const recording = recorder;
    const chunks = [];
    recording.ondataavailable = (event) => chunks.push(event.data);
    const limit = window.setTimeout(() => {
      if (recording.state === "recording") recording.stop();
    }, 15000);
    recording.onstop = async () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      mic.disabled = true;
      mic.classList.remove("listening");
      mic.setAttribute("aria-label", "Start voice input");
      status.textContent = "Transcribing locally…";
      try {
        const audio = new Blob(chunks, { type: recording.mimeType });
        const transcript = await transcribeBlob(audio);
        if (transcript) {
          input.value = transcript;
          input.focus();
          status.textContent = "Review the transcript before sending.";
        } else {
          status.textContent = "No speech detected.";
        }
      } catch {
        status.textContent = "Offline transcription failed. Try a shorter recording.";
      } finally {
        recorder = undefined;
        refreshVoiceControls();
      }
    };
    recording.start();
    mic.disabled = false;
    mic.classList.add("listening");
    mic.setAttribute("aria-label", "Stop voice input");
    status.textContent = "Recording. Click the microphone to stop.";
  } catch {
    stream?.getTracks().forEach((track) => track.stop());
    recorder = undefined;
    refreshVoiceControls();
    status.textContent = "Couldn't access the microphone. Check your browser permissions.";
  }
}

if (manualSupported) {
  mic.addEventListener("click", recordSpeech);
} else {
  mic.disabled = true;
  mic.title = "Offline voice input is unavailable";
}

if (!handsFreeSupported) handsFree.title = "Voice conversation requires local voice models and HTTPS or localhost";
refreshVoiceControls();
renderWorkspace();
tick();
window.setInterval(tick, 250);
