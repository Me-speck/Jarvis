import os
import shutil
import subprocess
import wave
from functools import lru_cache
from importlib.util import find_spec
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock

MODEL_PATH = Path(os.environ.get("JARVIS_MODEL_PATH", "models/jarvis.gguf"))
VOICE_ROOT = Path(os.environ.get("JARVIS_VOICE_MODELS", "models"))
WHISPER_DIR = VOICE_ROOT / "sherpa-onnx-whisper-base.en"
PIPER_DIR = VOICE_ROOT / "vits-piper-en_US-lessac-medium"
FFMPEG = shutil.which("ffmpeg")
AUDIO_FORMATS = {
    "audio/webm": "matroska",
    "audio/ogg": "ogg",
    "audio/mp4": "mov",
    "audio/wav": "wav",
}
SYSTEM_PROMPT = (
    "You are Jarvis, a concise personal assistant. Help with questions, analysis, "
    "and planning. Be honest about your capabilities. Only explicitly recognized "
    "commands can change the workspace. Never claim to have taken external actions."
)
model_lock = Lock()
speech_lock = Lock()
voice_lock = Lock()


def neural_transcription():
    return find_spec("sherpa_onnx") is not None and all(
        (WHISPER_DIR / name).is_file() for name in (
            "base.en-encoder.int8.onnx", "base.en-decoder.int8.onnx", "base.en-tokens.txt",
        )
    )


def neural_speech():
    return find_spec("sherpa_onnx") is not None and all(
        (PIPER_DIR / name).exists() for name in ("en_US-lessac-medium.onnx", "tokens.txt", "espeak-ng-data")
    )


@lru_cache(maxsize=1)
def flite_available():
    if not FFMPEG:
        return False
    try:
        return b" flite " in run_audio(["-filters"])
    except (OSError, subprocess.SubprocessError):
        return False


def capabilities():
    return {
        "conversation": MODEL_PATH.is_file() and find_spec("llama_cpp") is not None,
        "transcription": bool(FFMPEG and (neural_transcription() or find_spec("pocketsphinx"))),
        "speech": neural_speech() or flite_available(),
    }


@lru_cache(maxsize=1)
def load_model():
    from llama_cpp import Llama

    return Llama(
        model_path=str(MODEL_PATH),
        n_ctx=4096,
        n_threads=min(4, os.cpu_count() or 1),
        verbose=False,
    )


def converse(
    text, history, *, instructions=SYSTEM_PROMPT, max_tokens=384,
    response_format=None, temperature=0.2,
):
    messages = [{"role": "system", "content": instructions}]
    for item in history[-6:]:
        if (
            isinstance(item, dict) and item.get("role") in ("user", "assistant")
            and isinstance(item.get("content"), str)
        ):
            messages.append({"role": item["role"], "content": item["content"][:400]})
    messages.append({"role": "user", "content": text})

    with model_lock:
        result = load_model().create_chat_completion(
            messages=messages, max_tokens=max_tokens, response_format=response_format,
            temperature=temperature,
        )
    reply = result["choices"][0]["message"]["content"]
    return (reply or "").strip() or "I couldn't generate a reply. Try a shorter question."


def run_audio(args, **kwargs):
    result = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
        check=True,
        **kwargs,
    )
    return result.stdout


@lru_cache(maxsize=1)
def load_decoder():
    from pocketsphinx import Decoder

    return Decoder(loglevel="ERROR")


@lru_cache(maxsize=1)
def load_whisper():
    from sherpa_onnx import OfflineRecognizer

    return OfflineRecognizer.from_whisper(
        encoder=str(WHISPER_DIR / "base.en-encoder.int8.onnx"),
        decoder=str(WHISPER_DIR / "base.en-decoder.int8.onnx"),
        tokens=str(WHISPER_DIR / "base.en-tokens.txt"),
        num_threads=2,
    )


def transcribe(audio, audio_format):
    pcm = run_audio(
        [
            "-protocol_whitelist", "pipe", "-f", audio_format, "-i", "pipe:0",
            "-t", "15", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1",
        ],
        input=audio,
    )
    with speech_lock:
        if neural_transcription():
            import numpy as np

            samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
            if not len(samples) or np.sqrt(np.mean(samples ** 2)) < 0.003:
                return ""
            recognizer = load_whisper()
            stream = recognizer.create_stream()
            stream.accept_waveform(16000, samples)
            recognizer.decode_stream(stream)
            return stream.result.text.strip()
        decoder = load_decoder()
        decoder.start_utt()
        try:
            decoder.process_raw(pcm, False, True)
        finally:
            decoder.end_utt()
        hypothesis = decoder.hyp()
    return hypothesis.hypstr if hypothesis else ""


@lru_cache(maxsize=1)
def load_neural_voice():
    from sherpa_onnx import OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig, OfflineTtsVitsModelConfig

    vits = OfflineTtsVitsModelConfig(
        model=str(PIPER_DIR / "en_US-lessac-medium.onnx"),
        tokens=str(PIPER_DIR / "tokens.txt"),
        data_dir=str(PIPER_DIR / "espeak-ng-data"),
    )
    return OfflineTts(OfflineTtsConfig(
        model=OfflineTtsModelConfig(vits=vits, num_threads=2),
    ))


def wav_bytes(pcm, rate):
    buffer = BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(pcm)
    return buffer.getvalue()


def synthesize(text):
    if neural_speech():
        import numpy as np

        with voice_lock:
            audio = load_neural_voice().generate(text, speed=1.04)
        pcm = (np.clip(audio.samples, -1, 1) * 32767).astype("<i2").tobytes()
        return wav_bytes(pcm, audio.sample_rate)
    with TemporaryDirectory() as directory:
        (Path(directory) / "speech.txt").write_text(text, encoding="utf-8")
        pcm = run_audio(
            ["-f", "lavfi", "-i", "flite=textfile=speech.txt:voice=rms", "-t", "45",
             "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
            cwd=directory,
        )
        return wav_bytes(pcm, 16000)
