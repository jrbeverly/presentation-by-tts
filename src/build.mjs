import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";
import YAML from "yaml";

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const WIDTH = 1920;
const HEIGHT = 1080;
const RECORDING_TAIL_SECONDS = 2;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function targetId(slideId, itemId) {
  return `${slideId}.${itemId}`;
}

function itemIds(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) itemIds(item, found);
  } else if (value && typeof value === "object") {
    if (typeof value.id === "string") found.add(value.id);
    for (const child of Object.values(value)) itemIds(child, found);
  }
  return found;
}

function validate(presentation) {
  const slideIds = new Set();
  const cueIds = new Set();
  const audioPaths = new Set();

  for (const slide of presentation.slides) {
    if (slideIds.has(slide.id)) throw new Error(`Duplicate slide id: ${slide.id}`);
    slideIds.add(slide.id);
    const elements = itemIds(slide.content);
    if (!slide.narration?.length) throw new Error(`Slide ${slide.id} has no narration`);

    for (const cue of slide.narration) {
      if (cueIds.has(cue.id)) throw new Error(`Duplicate cue id: ${cue.id}`);
      if (audioPaths.has(cue.audio)) throw new Error(`Duplicate cue audio path: ${cue.audio}`);
      cueIds.add(cue.id);
      audioPaths.add(cue.audio);

      const [targetSlide, targetElement] = cue.target.split(".", 2);
      if (targetSlide !== slide.id || (targetElement && !elements.has(targetElement))) {
        throw new Error(`Cue ${cue.id} has unresolved target: ${cue.target}`);
      }
    }
  }
}

function metricCard(slide, metric) {
  const accent = metric.accent ? ` accent-${escapeHtml(metric.accent)}` : "";
  return `<article id="${escapeHtml(targetId(slide.id, metric.id))}" class="metric${accent}">
    <div class="metric-value">${escapeHtml(metric.value)}</div>
    <div class="metric-label">${escapeHtml(metric.label)}</div>
    ${metric.note ? `<div class="metric-note">${escapeHtml(metric.note)}</div>` : ""}
  </article>`;
}

function renderBody(slide) {
  const content = slide.content;

  if (slide.layout === "title") {
    return `<div class="agenda-grid">${content.sections.map((item) => `
      <article id="${escapeHtml(targetId(slide.id, item.id))}" class="agenda-item">
        <span class="agenda-number">${escapeHtml(item.number)}</span>
        <span class="agenda-label">${escapeHtml(item.label)}</span>
      </article>`).join("")}</div>`;
  }

  if (slide.layout === "metrics") {
    return `<div class="metric-grid count-${content.metrics.length}">
      ${content.metrics.map((metric) => metricCard(slide, metric)).join("")}
    </div>`;
  }

  if (slide.layout === "cards") {
    return `<div class="cards-grid">${content.cards.map((card) => `
      <article id="${escapeHtml(targetId(slide.id, card.id))}" class="outcome-card">
        <span class="card-index">${escapeHtml(card.index)}</span>
        <h2>${escapeHtml(card.title)}</h2>
        <p>${escapeHtml(card.body)}</p>
      </article>`).join("")}</div>`;
  }

  if (slide.layout === "flow") {
    return `<div class="flow-grid">${content.steps.map((step) => `
      <article id="${escapeHtml(targetId(slide.id, step.id))}" class="flow-step">
        <span class="step-index">${escapeHtml(step.index)}</span>
        <h2>${escapeHtml(step.title)}</h2>
        <p>${escapeHtml(step.body)}</p>
      </article>`).join("")}</div>`;
  }

  if (slide.layout === "video") {
    const video = content.video;
    return `<div id="${escapeHtml(targetId(slide.id, video.id))}" class="video-stage">
      <div class="video-frame">
        <video muted loop playsinline preload="auto">
          <source src="/${escapeHtml(video.source)}" type="video/mp4">
        </video>
      </div>
      <aside class="video-notes">
        <span class="video-label">${escapeHtml(video.label)}</span>
        <p>${escapeHtml(video.caption)}</p>
        <ol>${video.callouts.map((callout) => `<li>${escapeHtml(callout)}</li>`).join("")}</ol>
      </aside>
    </div>`;
  }

  if (slide.layout === "findings") {
    return `<div class="findings-grid">${content.findings.map((finding) => `
      <article id="${escapeHtml(targetId(slide.id, finding.id))}" class="finding">
        <div class="finding-signal">${escapeHtml(finding.signal)}</div>
        <h2>${escapeHtml(finding.title)}</h2>
        <p>${escapeHtml(finding.before)}</p>
        <p class="finding-after">${escapeHtml(finding.after)}</p>
      </article>`).join("")}</div>`;
  }

  if (slide.layout === "comparison") {
    const comparison = content.comparison;
    const scale = Math.max(comparison.current, comparison.baseline);
    const currentWidth = (comparison.current / scale) * 100;
    const baselineWidth = (comparison.baseline / scale) * 100;
    return `<div class="comparison-grid">
      <article id="${escapeHtml(targetId(slide.id, comparison.id))}" class="comparison-card">
        <div class="comparison-label">${escapeHtml(comparison.label)}</div>
        <div class="bar-row">
          <span>${escapeHtml(comparison.current_label)}</span>
          <span class="bar-track"><span class="bar-fill" style="display:block;width:${currentWidth}%"></span></span>
          <span class="bar-value">${escapeHtml(comparison.current)}</span>
        </div>
        <div class="bar-row">
          <span>${escapeHtml(comparison.baseline_label)}</span>
          <span class="bar-track"><span class="bar-fill baseline" style="display:block;width:${baselineWidth}%"></span></span>
          <span class="bar-value">${escapeHtml(comparison.baseline)}</span>
        </div>
      </article>
      ${content.metrics.map((metric) => metricCard(slide, metric)).join("")}
    </div>`;
  }

  if (slide.layout === "next") {
    return `<div class="next-grid">
      <article id="${escapeHtml(targetId(slide.id, content.capacity.id))}" class="capacity-card">
        <div class="capacity-value">${escapeHtml(content.capacity.value)}</div>
        <h2>${escapeHtml(content.capacity.label)}</h2>
        <div class="capacity-note">${escapeHtml(content.capacity.note)}</div>
      </article>
      <div class="goals">${content.goals.map((goal) => `
        <article id="${escapeHtml(targetId(slide.id, goal.id))}" class="goal">
          <span class="goal-index">${escapeHtml(goal.index)}</span>
          <h2>${escapeHtml(goal.title)}</h2>
          <p>${escapeHtml(goal.body)}</p>
        </article>`).join("")}</div>
    </div>`;
  }

  throw new Error(`Unknown slide layout: ${slide.layout}`);
}

function renderDeck(presentation) {
  const sections = presentation.slides.map((slide, index) => `
    <section id="${escapeHtml(slide.id)}" data-slide-id="${escapeHtml(slide.id)}">
      <div class="slide-shell ${escapeHtml(slide.layout)}-layout">
        <div class="topline">
          <span class="eyebrow">${escapeHtml(slide.eyebrow)}</span>
          <span class="page-number">${String(index + 1).padStart(2, "0")} / ${String(presentation.slides.length).padStart(2, "0")}</span>
        </div>
        <h1>${escapeHtml(slide.title)}</h1>
        ${slide.content.lede ? `<p class="lede">${escapeHtml(slide.content.lede)}</p>` : ""}
        <div class="content">${renderBody(slide)}</div>
        <div class="footer">${escapeHtml(slide.content.footer ?? presentation.title)}</div>
      </div>
    </section>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(presentation.title)}</title>
  <link rel="stylesheet" href="/node_modules/reveal.js/dist/reveal.css">
  <link rel="stylesheet" href="/src/deck.css">
</head>
<body>
  <div class="reveal"><div class="slides">${sections}</div></div>
  <script type="module">
    import Reveal from "/node_modules/reveal.js/dist/reveal.mjs";
    window.Reveal = Reveal;
    await Reveal.initialize({
      controls: false,
      progress: false,
      history: false,
      keyboard: false,
      overview: false,
      touch: false,
      center: false,
      width: ${WIDTH},
      height: ${HEIGHT},
      margin: 0,
      minScale: 1,
      maxScale: 1,
      transition: "fade",
      transitionSpeed: "fast",
      backgroundTransition: "none"
    });
    Reveal.slide(0);
    window.deckReady = true;
  </script>
</body>
</html>`;
}

async function duration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number(stdout.trim());
}

async function ffmpeg(args) {
  await run("ffmpeg", ["-y", "-v", "error", ...args], { maxBuffer: 10 * 1024 * 1024 });
}

async function buildGeneratedMedia(presentation) {
  for (const slide of presentation.slides) {
    if (slide.layout !== "video") continue;
    const video = slide.content.video;
    const seconds = Number(video.duration_seconds);
    const videoPath = path.join(ROOT, video.source);
    await mkdir(path.dirname(videoPath), { recursive: true });

    const videoFilter = [
      "drawgrid=width=80:height=80:thickness=1:color=0x65a8ff@0.14",
      "drawbox=x=72:y=62:w=1136:h=596:color=0x101d36@0.96:t=fill",
      "drawbox=x=72:y=62:w=1136:h=8:color=0xff8066:t=fill",
      "drawbox=x=106:y=102:w=18:h=18:color=0xff8066:t=fill:enable='lt(mod(t,2),1)'",
      "drawtext=font='DejaVu Sans':text='PLAYING':fontcolor=0xa9b2c4:fontsize=22:x=140:y=98",
      "drawtext=font='DejaVu Sans':text='DEMO PLACEHOLDER':fontcolor=0xf6f3ee:fontsize=68:x=(w-text_w)/2:y=(h-text_h)/2-24",
      "drawtext=font='DejaVu Sans':text='Synthetic product walkthrough':fontcolor=0x68e0bd:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+72",
      "drawtext=font='DejaVu Sans Mono':text='%{pts\\:hms}':fontcolor=0xa9b2c4:fontsize=24:x=w-text_w-110:y=h-118",
    ].join(",");

    await ffmpeg([
      "-f", "lavfi",
      "-i", `color=c=0x07101f:s=1280x720:r=30:d=${seconds}`,
      "-vf", videoFilter,
      "-an",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      videoPath,
    ]);

    for (const cue of slide.narration.filter((item) => item.kind === "silence")) {
      if (Number(cue.duration_seconds) !== seconds) {
        throw new Error(`Video ${video.id} and silence cue ${cue.id} must have the same duration`);
      }
      const silencePath = path.join(ROOT, cue.audio);
      await mkdir(path.dirname(silencePath), { recursive: true });
      await ffmpeg([
        "-f", "lavfi",
        "-i", "anullsrc=r=24000:cl=mono",
        "-t", String(cue.duration_seconds),
        "-c:a", "pcm_s16le",
        silencePath,
      ]);
    }
    console.log(`Generated ${path.relative(ROOT, videoPath)} (${seconds.toFixed(2)}s).`);
  }
}

async function buildTiming(presentation) {
  const slides = [];
  const allCues = [];
  let clock = 0;

  for (let slideIndex = 0; slideIndex < presentation.slides.length; slideIndex += 1) {
    const slide = presentation.slides[slideIndex];
    const slideStart = clock;
    const cues = [];

    for (const cue of slide.narration) {
      const audioPath = path.join(ROOT, cue.audio);
      let cueDuration;
      try {
        cueDuration = await duration(audioPath);
      } catch {
        throw new Error(`Missing or unreadable narration cue ${cue.audio}. Run src/narrate.py first.`);
      }
      const measured = Number(cueDuration.toFixed(6));
      cues.push({
        id: cue.id,
        target: cue.target,
        audio: cue.audio,
        start: Number(clock.toFixed(6)),
        duration: measured,
      });
      allCues.push({ ...cue, absoluteAudioPath: audioPath });
      clock += cueDuration;
    }

    slides.push({
      id: slide.id,
      index: slideIndex,
      start: Number(slideStart.toFixed(6)),
      duration: Number((clock - slideStart).toFixed(6)),
      cues,
    });
  }

  return {
    title: presentation.title,
    total_duration: Number(clock.toFixed(6)),
    slides,
    allCues,
  };
}

async function buildNarration(cues, output) {
  const args = [];
  for (const cue of cues) args.push("-i", cue.absoluteAudioPath);
  const inputs = cues.map((_, index) => `[${index}:a]`).join("");
  const filter = `${inputs}concat=n=${cues.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.84:level=false[out]`;
  await ffmpeg([
    ...args,
    "-filter_complex", filter,
    "-map", "[out]",
    "-ar", "48000",
    "-ac", "2",
    "-c:a", "pcm_s16le",
    output,
  ]);
}

function mimeType(file) {
  const extension = path.extname(file);
  return {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".map": "application/json",
  }[extension] ?? "application/octet-stream";
}

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.join(ROOT, pathname);
      const data = await readFile(file);
      response.writeHead(200, { "content-type": mimeType(file) });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

async function recordDeck(timing, output) {
  const recordingDir = path.join(BUILD, "recordings");
  await rm(recordingDir, { recursive: true, force: true });
  const server = await startServer();
  const address = server.address();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      recordVideo: { dir: recordingDir, size: { width: WIDTH, height: HEIGHT } },
    });
    const page = await context.newPage();
    const video = page.video();
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`  browser: ${message.text()}`);
    });
    page.on("pageerror", (error) => console.error(`  browser: ${error.message}`));
    await page.goto(`http://127.0.0.1:${address.port}/build/deck.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.deckReady === true);
    await page.waitForFunction(() => [...document.querySelectorAll("video")].every((video) => video.readyState >= 2));

    for (const slide of timing.slides) {
      console.log(`  recording ${String(slide.index + 1).padStart(2, "0")}/${timing.slides.length} ${slide.id} (${slide.duration.toFixed(2)}s)`);
      await page.evaluate(async (index) => {
        window.Reveal.slide(index);
        const videos = [...document.querySelectorAll("section.present video")];
        for (const video of videos) {
          video.currentTime = 0;
          await video.play();
        }
      }, slide.index);
      await page.waitForTimeout(slide.duration * 1000);
    }
    await page.waitForTimeout(RECORDING_TAIL_SECONDS * 1000);
    await context.close();
    await copyFile(await video.path(), output);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(recordingDir, { recursive: true, force: true });
  }
}

async function main() {
  await mkdir(BUILD, { recursive: true });
  const source = YAML.parse(await readFile(path.join(ROOT, "data", "presentation.yaml"), "utf8"));
  const presentation = source.presentation;
  validate(presentation);
  await buildGeneratedMedia(presentation);

  const timing = await buildTiming(presentation);
  const publicTiming = { ...timing };
  delete publicTiming.allCues;

  await writeFile(path.join(BUILD, "deck.html"), renderDeck(presentation));
  await writeFile(path.join(BUILD, "timing.json"), `${JSON.stringify(publicTiming, null, 2)}\n`);
  console.log(`Compiled ${presentation.slides.length} slides and ${timing.allCues.length} narration cues.`);

  const narrationPath = path.join(BUILD, "narration.wav");
  console.log("Mastering narration...");
  await buildNarration(timing.allCues, narrationPath);

  const visualPath = path.join(BUILD, "presentation-visual.webm");
  console.log("Recording the Reveal.js deck...");
  await recordDeck(timing, visualPath);

  const recordedDuration = await duration(visualPath);
  const lead = Math.max(0, recordedDuration - timing.total_duration - RECORDING_TAIL_SECONDS);
  const outputPath = path.join(BUILD, "presentation.mp4");
  console.log("Muxing synchronized video and narration...");
  await ffmpeg([
    "-ss", lead.toFixed(6),
    "-i", visualPath,
    "-i", narrationPath,
    "-t", timing.total_duration.toFixed(6),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", `fps=30,scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    outputPath,
  ]);

  console.log(`Built ${path.relative(ROOT, outputPath)} (${timing.total_duration.toFixed(2)}s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
