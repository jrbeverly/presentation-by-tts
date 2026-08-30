# Presentation by TTS

> [!WARNING]
> **AI-authored:** This change was autonomously planned and implemented by an AI software factory from a human-authored specification, with possible subsequent human review or modification.

Compiles sprint data into a structured slide deck, synchronized narration, and a narrated MP4.

```
src/      narrate.py, build.mjs, deck.css
data/     sprint.json, presentation.yaml
voice/    candidate reference voices
docs/     AI-SPEC.md and sample output
build/    all generated audio, slides, and video
```

```sh
npm install
npm run install-browser

python3 -m venv .venv
.venv/bin/pip install -r requirements-tts.txt
.venv/bin/python src/narrate.py
npm run build
```

`src/narrate.py --voice voice/ben-tucker.json` narrates with the other candidate voice; `voice/README.md` covers both.

## Notes

- TTS/AI-generated sprint presentation concept: separate reporting/demo needs from the team’s actual sprint review so the review can focus on technical interrogation, quality, problems, and improvement rather than becoming a status meeting.
- Let lower-level team meetings naturally adapt to what is most effective for the team; avoid forcing everyone into presentation mode simply because reporting artifacts are required.
- Use AI to analyze sprint/review meetings and extract relevant status updates, demo moments, decisions, and discussion snippets automatically.
- Generate a clean sprint presentation containing metrics, notable work completed, demo snippets, and the team’s own discussion of problems and intended improvements.
- Could also address increasing demand for demos to explain business value without requiring engineers to rehearse scripted business-value narratives.
- AI can connect demonstrated work back to existing documentation describing broader, intermediate, and short-term business objectives; generate the connective explanation automatically.
- Desired outcome: leadership gets clear reporting, demos, metrics, visuals, and business-context framing while the delivery team retains flexibility to operate as a high-efficiency problem-solving team.
