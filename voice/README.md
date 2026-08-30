# Reference voices

Candidate Chatterbox voices for the deck. Each `<reader>.json` is one profile: the reference clip it speaks from, its TTS and post settings, and where the audio came from.

| profile | voice | reader |
| --- | --- | --- |
| `karen-savage.json` | Corporate Female 01 | Karen Savage |
| `ben-tucker.json` | Technical SME Male 01 | Ben Tucker |

## Usage

```sh
python3 src/narrate.py --voice voice/ben-tucker.json
```

Run `narrate.py` from the experiment root; without `--voice` it uses the profile named in `data/presentation.yaml`. Each `clip` block records the window its wav was cut from:

```sh
ffmpeg -ss 313.3 -t 10 -i 333_00_crawford_64kb.mp3 \
  -af highpass=f=80,loudnorm=I=-27:TP=-2:LRA=7 \
  -ar 24000 -ac 1 -c:a pcm_s16le ben-tucker.wav
```

## Notes

- Both clips are 10 seconds. A whole LibriVox chapter as the reference is slow and drags the "This is a LibriVox recording" boilerplate into the voice.
- `silencedetect=noise=-30dB:d=0.3` locates the sentence gaps, which is how the Ben Tucker window landed on 313.3 seconds: speech on both edges, no dead air, no clipped word.
- Single-pass `loudnorm` lands within about a loudness unit of the -27 LUFS target; the two clips measure -26.9 and -26.0 LUFS.
- The mp3 sources are gitignored. `source.audio_url` plus the `clip` window re-derives a byte-comparable clip, so only the 10-second wav is worth keeping.
- An mp3's own `comment` ID3 tag carries the archive.org item URL, which confirmed provenance faster than the catalog: the Ben Tucker profile arrived describing a different recording by the same reader.
- The raw cache in `build/narration-raw/` keys on the reference bytes and TTS settings, so auditioning a second voice keeps the first voice's takes and switching back re-runs only ffmpeg.
- LibriVox recordings are public domain in the United States, but voice-rights implications of cloning a named reader are unresolved; both profiles stay `candidate` for that reason.
