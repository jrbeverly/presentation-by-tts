npm install
npm run install-browser
npm run build

python3 -m venv .venv
.venv/bin/pip install -r requirements-tts.txt
# .venv/bin/python src/narrate.py --voice voice/karen-savage.json
# npm run build

.venv/bin/python src/narrate.py --voice voice/ben-tucker.json
npm run build

