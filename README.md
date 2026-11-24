# Jarvis

Jarvis runs on your machine. Notes, tasks, timers, arithmetic, English voice
transcription, and spoken replies use local code and data. It needs no service
accounts, API keys, or subscriptions. Setup downloads software and, for
open-ended conversation, a free model file. After setup, the app works offline.

## Install

**No Linux environment is required.** Run Jarvis directly on your MacBook.
Your Chromebook and iPhone open it in Chrome or Safari on the same Wi-Fi.
The Mac runs the voice and conversation models. The other devices need no
terminal, Python, model downloads, or paid services. Keep the Mac awake and
Jarvis running while you use it.

### MacBook

1. Install [Homebrew](https://brew.sh/) on the Mac. If Apple’s command line
   tools are missing, open Terminal and run `xcode-select --install`.
2. Open Terminal and run:

   ```sh
   git clone https://github.com/Me-speck/Jarvis.git
   cd Jarvis
   ./start-jarvis.command
   ```

   If you already cloned Jarvis, run `git pull` in the existing directory
   first. The launcher installs the missing software and downloads the model
   files on first launch. On later launches, run it again or double-click
   **start-jarvis.command** in Finder.
3. When the browser opens `http://localhost:8765`, choose **Start voice
   conversation** and allow microphone access. Leave Terminal open while
   using Jarvis.

The launcher defaults to 8765 to avoid conflicts with macOS services on port
5000. If you already used Jarvis at `http://localhost:5000`, run
`JARVIS_PORT=5000 ./start-jarvis.command` to keep using that browser workspace
if the port is free.

### Share from the Mac over Wi-Fi

Stop the local launcher with **Control-C**, then run this from the Jarvis
folder on the Mac:

```sh
./start-jarvis.command --share
```

The launcher installs Caddy if needed and prints the HTTPS address and
the location of the public certificate. If it chooses the wrong network
interface, enter the Wi-Fi IP shown in the Mac’s Network settings. For example:

```sh
./start-jarvis.command --share 192.168.1.23
```

Use sharing on your own trusted network. It makes the app available to
devices that can reach the Mac on TCP port 8443. If a Mac firewall prompt
appears, allow Caddy on the local network. Transfer only the printed
`root.crt` file from your Mac, never the private key. The trust step below
is required for browser microphone access.

### Chromebook without Linux

1. Put the Chromebook on the same Wi-Fi as the Mac. Transfer the Mac’s
   `root.crt` securely to your own Chromebook, such as on a USB drive.
2. In Chrome, open `chrome://settings/certificates`. Under **Authorities**
   or **Custom → Authorities**, import that certificate and allow it to
   identify websites if asked. Only trust a certificate that you created on
   your Mac. A school or employer may block certificate imports.
3. Open the HTTPS address printed by the Mac launcher in Chrome. Choose
   **Start voice conversation** and allow the microphone. Bookmark the
   address for later. Keep the Jarvis launcher open on the Mac.

This setup uses ChromeOS directly. A Chromebook by itself needs a different
build to run the models entirely in the browser.

### iPhone

1. Put the iPhone on the same Wi-Fi as the Mac. AirDrop the printed
   `root.crt` file from your Mac to your iPhone.
2. Install the downloaded profile in **Settings**, then turn on full trust
   for that certificate under **Settings → General → About → Certificate
   Trust Settings**. Trust only the certificate you created on your Mac.
3. Open the HTTPS address printed by the Mac launcher in Safari. Choose
   **Start voice conversation** and allow the microphone. Use **Share → Add
   to Home Screen** for a shortcut. Keep Jarvis visible while speaking.

If the Mac’s Wi-Fi IP changes, use the new address printed by the launcher.
Remove the Jarvis certificate trust from your devices when you stop using
this setup.

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
