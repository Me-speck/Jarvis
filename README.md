# Jarvis

Jarvis runs on your machine. Notes, tasks, timers, arithmetic, English voice
transcription, and spoken replies use local code and data. It needs no service
accounts, API keys, or subscriptions. Setup downloads software and, for
open-ended conversation, a free model file. After setup, the app works offline.

## Install

Jarvis is a browser app backed by a local server. Run the server on a MacBook
or a supported Chromebook. An iPhone can use the same voice assistant and
workbench through Safari while the server is running. No API keys or accounts
are required to run Jarvis.

### MacBook

1. Install [Homebrew](https://brew.sh/) and Apple's command line tools
   (`xcode-select --install`) if needed.
2. Open Terminal and run:

   ```sh
   brew install python@3.12 ffmpeg cmake
   git clone https://github.com/Me-speck/Jarvis.git
   cd Jarvis
   "$(brew --prefix python@3.12)/bin/python3.12" -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements.txt -r requirements-voice.txt -r requirements-model.txt
   python scripts/download_models.py
   JARVIS_HOST=127.0.0.1 python -B app.py
   ```

3. Open `http://localhost:5000` in Safari or Chrome. Choose **Start voice
   conversation** and allow microphone access. Leave Terminal open while
   using Jarvis.

### Chromebook

1. In ChromeOS Settings, enable **Linux development environment** under
   **About ChromeOS → Developers**. If your Chromebook is managed or Linux
   is unavailable, use Chrome as a client on the same Wi-Fi as a Jarvis host
   and follow the trusted HTTPS steps below.
2. In the Linux Terminal, run:

   ```sh
   sudo apt update
   sudo apt install -y git python3 python3-venv python3-dev ffmpeg build-essential cmake
   git clone https://github.com/Me-speck/Jarvis.git
   cd Jarvis
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r requirements.txt -r requirements-voice.txt -r requirements-model.txt
   python scripts/download_models.py
   python -B app.py
   ```

3. In Chrome on the Chromebook, open `http://localhost:5000`, select
   **Start voice conversation**, and allow microphone access. If ChromeOS
   does not forward the port automatically, add Linux port **5000/TCP** in
   **Settings → Developers → Linux development environment → Port forwarding**.
   Keep the Linux Terminal running. Prefer a separate host on devices
   without enough free memory or disk for the model files.

### iPhone

The iPhone is the microphone, speaker, and display. A MacBook or Linux
computer on the same trusted Wi-Fi runs the model. Mobile Safari needs
**trusted HTTPS** to access the microphone. A plain HTTP LAN address can
display the page but cannot start voice input.

1. Set up Jarvis on the host and run it with
   `JARVIS_HOST=127.0.0.1 python -B app.py`. Find the computer's Wi-Fi IP
   address in its network settings. Keep the server on the trusted network.
2. Install [Caddy](https://caddyserver.com/docs/install) on the host
   (`brew install caddy` on macOS). Save a file named `Caddyfile` next to
   the checkout, replacing `192.168.1.23` with the host's Wi-Fi IP:

   ```caddyfile
   https://192.168.1.23:8443 {
       tls internal
       reverse_proxy 127.0.0.1:5000
   }
   ```

   From the directory containing that file, run
   `caddy run --config Caddyfile` in a separate Terminal window. If needed,
   allow TCP 8443 in the host's firewall for your local network only.
3. Locate Caddy's data directory with `caddy environ` and find
   `pki/authorities/local/root.crt` inside that directory. Transfer **only
   the root certificate**, never the private key, to your own iPhone
   securely, such as via AirDrop from your Mac. Install the downloaded
   profile in **Settings**, then turn on full trust for that certificate
   under **Settings → General → About → Certificate Trust Settings**.
   Trust only a certificate you created on your own host. Remove it when
   you stop using this setup.
4. On the same Wi-Fi, open `https://192.168.1.23:8443` in Safari with your
   host's actual IP. Use **Share → Add to Home Screen** to keep a shortcut,
   then choose **Start voice conversation** and allow the microphone.
   Keep Jarvis visible while speaking. The host must stay on and reachable.
   If the host IP changes, update your Caddyfile and shortcut.

A Chromebook using a separate Jarvis host can open the same HTTPS URL after
trusting the host CA in Chrome's certificate settings. School or employer
policy may control certificate installation.

### Models and Docker

The model downloader fetches and verifies Qwen2.5 3B, Whisper Base English,
and the Piper Lessac voice. Allow several GB of free disk space. After that
download, the assistant, voice processing, and workbench can run without
internet access. The model files are kept out of Git. A different trusted
llama.cpp-compatible GGUF can be selected with `JARVIS_MODEL_PATH`. Voice
model paths can be overridden with `JARVIS_VOICE_MODELS`. Restart after
changing a model. [Qwen model listing](https://hub.docker.com/r/ai/qwen2.5) ·
[Sherpa-ONNX model releases](https://github.com/k2-fsa/sherpa-onnx/releases)

For Docker, use `docker build --build-arg INSTALL_MODEL_RUNTIME=1 -t jarvis .`
and mount the downloaded models using
`docker run --rm -p 127.0.0.1:5000:5000 -v "${PWD}/models:/app/models:ro" jarvis`.

## Commands

| Command | Result |
| --- | --- |
| `Take note: Check the prototype` | Save a note |
| `Add task: Review the plans` | Add a task you can check off |
| `Set a timer for five minutes` | Start a countdown |
| `Calculate 24 * 7` | Evaluate arithmetic |
| `What time is it?` | Show the browser's local time |

You can prefix commands with `Jarvis,`. Notes, tasks, and timers persist in
your current browser. Keep the page open for timer alerts. A timer that
expires while the page is closed will show as complete when you reopen it.

Choose **Start voice conversation** once and speak naturally. Pause after each
utterance so Jarvis can transcribe it, reply aloud, and automatically listen
again. It remembers the recent turns in the open page. Try a follow-up like
“Can you explain that more simply?” or a command like “Read my notes.” Say
“Stop listening” or tap **End voice conversation** to release the microphone.
Keep the app in the foreground. It also stops listening when you leave the
page. The mic is paused while Jarvis speaks to avoid recording its own voice.

The small microphone button offers manual dictation with editable
transcripts. The typed field remains available, and **Voice on** reads
typed-command replies aloud. Voice recognition is English. Background noise
can affect turn detection and transcription. The engineering workbench uses
visual controls for mesh inspection, editing, and downloads. Check
`GET /health` to see which local components are available.

## Engineering workbench

Open **Engineering workbench** from the assistant header.

- **Design** opens binary and ASCII STL files, renders the mesh in an orbitable
  3D viewport, and reports dimensions, surface area, winding, and basic topology.
  The **Part builder** makes editable blocks, solid cylinders, tubes or
  washers, and tapered cylinders. **Export STL** downloads the displayed mesh.
  Estimated volume is available when basic edge and face checks pass.
  STL files lack unit metadata, so the UI assumes millimeters. Edge checks
  compare identical vertex coordinates. Use a dedicated mesh checker or slicer
  for tolerances, self-intersections, and fabrication validation.
- **Cantilever simulation** estimates the tip deflection, maximum bending
  stress, and mass of a solid rectangular beam with a fixed end and a static
  tip load. It uses linear elastic beam theory and nominal material presets.
  **Compare materials** shows the deflection and mass for each preset under
  identical geometry and load.
  It does not simulate imported meshes or replace engineering validation.
  **Show beam** returns the viewport to the generated geometry. Export that
  geometry or the imported mesh as binary STL.
- **Code** imports text files into a browser workspace. Create, rename, edit,
  and download files. Python and JSON checks report syntax errors without
  executing the source. The local model can explain code or draft snippets
  using the active file or selected text. Review its suggestions before
  applying them. **Draft edit** creates a replacement for the current file
  or selection, and **Review edit** opens it for inspection. Python and JSON edits
  must pass a syntax check before being applied. Changes in the editor and
  the last successful part dimensions are saved in the current browser.
- **Assembly** creates a manual fabrication checklist from the current
  geometry and exports it as Markdown. The STL goes to your slicer or other
  fabrication software. No physical scanner, printer, CNC tool, or robot is
  required for this workbench. Hardware control requires a device-specific
  integration.

The generated beam settings are saved in the current browser. Imported meshes
and assembly checkmarks are kept for the current session. Export them to retain
them. The workbench works without internet services after setup.
