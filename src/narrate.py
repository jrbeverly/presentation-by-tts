import argparse
import hashlib
import json
import random
import re
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).parent.parent

UNITS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split()


def say_two_digits(value):
    if value < 20:
        return UNITS[value]
    tens, unit = divmod(value, 10)
    return f"{TENS[tens - 2]}-{UNITS[unit]}" if unit else TENS[tens - 2]


def say_year(text):
    year = int(text)
    if year % 1000 == 0:
        return f"{UNITS[year // 1000]} thousand"
    century, remainder = divmod(year, 100)
    if remainder == 0:
        return f"{say_two_digits(century)} hundred"
    if remainder < 10:
        return f"{say_two_digits(century)} oh {UNITS[remainder]}"
    return f"{say_two_digits(century)} {say_two_digits(remainder)}"


def say_digits(text):
    return " ".join(UNITS[int(digit)] for digit in text)


CORRECTIONS = [
    (
        r"\b(\d{4})\.(\d{2})\.(\d{2})\b",
        lambda match: f"{say_year(match[1])} dot {say_digits(match[2])} dot {say_digits(match[3])}",
    ),
    (r"\b(?:1\d|20)\d{2}\b", lambda match: say_year(match[0])),
]


def correct(text):
    for pattern, replacement in CORRECTIONS:
        text = re.sub(pattern, replacement, text)
    return text


def ffmpeg(args):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


def probe(path):
    result = subprocess.run([
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ], check=True, capture_output=True, text=True)
    return round(float(result.stdout), 6)


def load_model(level, device):
    if level == "full":
        from chatterbox.tts import ChatterboxTTS

        return ChatterboxTTS.from_pretrained(device=device)

    from chatterbox.tts_turbo import ChatterboxTurboTTS

    if level == "turbo":
        return ChatterboxTurboTTS.from_pretrained(device=device)
    if level == "nano":
        return ChatterboxTurboTTS.from_pretrained(device=device, nano=True)
    raise ValueError(f"Unknown Chatterbox model: {level}")


def seed_everything(seed):
    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def generate(model, level, text, settings):
    if level == "full":
        return model.generate(
            text,
            temperature=settings["temperature"],
            min_p=settings["min_p"],
            top_p=settings["top_p"],
            repetition_penalty=settings["repetition_penalty"],
            exaggeration=settings["exaggeration"],
            cfg_weight=settings["cfg_weight"],
        )

    return model.generate(
        text,
        temperature=settings["temperature"],
        top_p=settings["top_p"],
        top_k=settings["top_k"],
        repetition_penalty=settings["repetition_penalty"],
    )


def process(raw, output, post, pause_ms):
    trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08"
    filters = [
        trim,
        "areverse",
        trim,
        "areverse",
        f"highpass=f={post['highpass_hz']}",
        f"equalizer=f={post['warmth_hz']}:width_type=q:w=1:g={post['warmth_db']}",
        f"equalizer=f={post['clarity_hz']}:width_type=q:w=0.9:g={post['clarity_db']}",
        f"acompressor=threshold={post['compressor_threshold_db']}dB:ratio=2:attack=15:release=250:makeup=1",
        f"atempo={post['tempo']}",
        "afade=t=in:d=0.01",
        f"apad=pad_dur={pause_ms / 1000}",
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg([
        "-i", str(raw),
        "-af", ",".join(filters),
        "-ar", "24000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output),
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("presentation", nargs="?", default=ROOT / "data" / "presentation.yaml", type=Path)
    parser.add_argument("--voice", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source = yaml.safe_load(args.presentation.read_text())["presentation"]
    voice = source["voice"]
    profile_path = args.voice or ROOT / voice["profile"]
    profile = json.loads(profile_path.read_text())
    reference = profile_path.parent / profile["reference_audio"]
    cues = [cue for slide in source["slides"] for cue in slide["narration"]]
    for cue in cues:
        if cue.get("kind") != "silence":
            cue["spoken"] = correct(cue["text"])

    print(f"{source['title']}: {voice['model']} on {voice['device']} with {profile['name']}")
    for index, cue in enumerate(cues, 1):
        text = cue.get("spoken") or f"[{cue['duration_seconds']} seconds of silence]"
        print(f"  {index:02d} {cue['target']}: {text}")
    if args.dry_run:
        return

    raw_dir = ROOT / "build" / "narration-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    reference_hash = hashlib.sha256(reference.read_bytes()).hexdigest()
    model = None
    prepared = False

    sections = []
    clock = 0.0

    for index, cue in enumerate(cues, 1):
        if cue.get("kind") == "silence":
            silence = float(cue["duration_seconds"])
            print(f"  derived   {cue['audio']} during npm run build")
            sections.append({
                "id": cue["id"],
                "target": cue["target"],
                "kind": "silence",
                "audio": cue["audio"],
                "start": round(clock, 6),
                "duration": silence,
            })
            clock += silence
            continue
        settings = profile["tts"] | cue.get("tts", {})
        seed = cue.get("seed", voice["seed"])
        identity = json.dumps({
            "model": voice["model"],
            "reference": reference_hash,
            "text": cue["spoken"],
            "settings": settings,
            "seed": seed,
        }, sort_keys=True)
        digest = hashlib.sha256(identity.encode()).hexdigest()[:10]
        raw = raw_dir / f"{index:02d}-{cue['id']}-{digest}.wav"
        output = ROOT / cue["audio"]

        if not raw.exists():
            if model is None:
                model = load_model(voice["model"], voice["device"])
            if not prepared:
                if voice["model"] == "full":
                    model.prepare_conditionals(str(reference), exaggeration=settings["exaggeration"])
                else:
                    model.prepare_conditionals(str(reference))
                prepared = True
            seed_everything(seed)
            wave = generate(model, voice["model"], cue["spoken"], settings)
            import torchaudio

            torchaudio.save(str(raw), wave.cpu(), model.sr)
            print(f"  generated {raw.relative_to(ROOT)}")
        else:
            print(f"  cached    {raw.relative_to(ROOT)}")

        process(raw, output, profile["post"], cue["pause_after_ms"])
        duration = probe(output)
        sections.append({
            "id": cue["id"],
            "target": cue["target"],
            "audio": cue["audio"],
            "start": round(clock, 6),
            "duration": duration,
            "text": cue["text"],
            "spoken": cue["spoken"],
        })
        clock += duration

    manifest = ROOT / "build" / "narration" / "manifest.json"
    manifest.write_text(json.dumps({
        "title": source["title"],
        "voice": profile["name"],
        "profile": profile_path.name,
        "total_duration": round(clock, 6),
        "sections": sections,
    }, indent=2) + "\n")

    print(f"Wrote {len(cues)} synchronized cues and {manifest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
