"""Fetch verified public model files once. Jarvis uses them offline afterward."""

import hashlib
import json
import shutil
import tarfile
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1] / "models"
RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
WHISPER = "sherpa-onnx-whisper-base.en"
VOICE = "vits-piper-en_US-lessac-medium"
CHAT_DIGEST = "48f4925de3417c3e259c5b460024ec9907458c52c9a7aab81269a4befd473e5e"


def download(request, destination, expected):
    digest = hashlib.sha256()
    with urlopen(request, timeout=120) as response, destination.open("xb") as output:
        while block := response.read(1024 * 1024):
            digest.update(block)
            output.write(block)
    if digest.hexdigest() != expected:
        raise SystemExit(f"Checksum mismatch for {destination.name}. The file was discarded.")


def fetch_archive(directory, group, checksum, required, include):
    target = ROOT / directory
    if target.is_dir() and all((target / name).exists() for name in required):
        print(f"Found {directory}")
        return
    if target.exists():
        raise SystemExit(f"{target} already exists and is incomplete. Move it aside before retrying.")
    print(f"Downloading {directory}…", flush=True)
    with TemporaryDirectory(dir=ROOT) as temporary:
        cache = Path(temporary)
        archive = cache / "model.tar.bz2"
        download(f"{RELEASES}/{group}/{directory}.tar.bz2", archive, checksum)
        with tarfile.open(archive) as package:
            for member in package:
                path = Path(member.name)
                if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != directory:
                    raise SystemExit("Unexpected path inside model archive.")
                if member.isfile() and include(path):
                    output = cache / path
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with package.extractfile(member) as source, output.open("xb") as file:
                        shutil.copyfileobj(source, file)
        if not all((cache / directory / name).exists() for name in required):
            raise SystemExit("Verified archive did not contain the expected model files.")
        (cache / directory).rename(target)


def fetch_chat():
    path = ROOT / "jarvis.gguf"
    if path.is_file():
        print("Found jarvis.gguf")
        return
    print("Downloading the 1.93 GB Qwen2.5 3B model…", flush=True)
    authorization = (
        "https://auth.docker.io/token?service=registry.docker.io&scope=repository:ai/qwen2.5:pull"
    )
    with urlopen(authorization, timeout=30) as response:
        token = json.load(response)["token"]
    request = Request(f"https://registry-1.docker.io/v2/ai/qwen2.5/blobs/sha256:{CHAT_DIGEST}")
    # urllib follows redirects with ordinary headers. Keep the registry token on its origin.
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    with TemporaryDirectory(dir=ROOT) as temporary:
        model = Path(temporary) / "jarvis.gguf"
        download(request, model, CHAT_DIGEST)
        model.rename(path)


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    whisper_files = ("base.en-encoder.int8.onnx", "base.en-decoder.int8.onnx", "base.en-tokens.txt")
    fetch_archive(
        WHISPER, "asr-models", "475bc7052ce299c007f6d5d5407ba8601f819a2867f6eecee510ed17df581542",
        whisper_files, lambda path: len(path.parts) == 2 and path.name in whisper_files,
    )
    fetch_archive(
        VOICE, "tts-models", "9e3febfacf0abf4270172d2958bcec246032b7e88efc2720840cc80c93de334e",
        ("en_US-lessac-medium.onnx", "tokens.txt", "espeak-ng-data"), lambda path: True,
    )
    fetch_chat()
    print("Models are ready.")
