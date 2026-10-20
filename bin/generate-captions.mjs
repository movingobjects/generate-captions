#!/usr/bin/env node
// generate-captions
// Batch-generate WebVTT/SRT captions for videos using ffmpeg + whisper.cpp.
//
// Captions are written next to each video with the same name: intro.mp4 -> intro.vtt
// Requires Node 18.3+, ffmpeg, and whisper-cli (brew install whisper-cpp ffmpeg). No npm dependencies.

import { spawn } from 'node:child_process';
import {
  access,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  homedir,
  tmpdir,
} from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const VERSION = '1.0.0';

const VIDEO_EXTS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);

const FORMATS = new Set([
  'vtt',
  'srt',
  'both',
]);

const DEFAULT_MODEL = process.env.GENERATE_CAPTIONS_MODEL
  || path.join(homedir(), 'whisper-models', 'ggml-large-v3-turbo.bin');

const HELP = `generate-captions ${VERSION}
Batch-generate captions for videos using ffmpeg + whisper.cpp.

Usage:
  generate-captions <file-or-folder>... [options]

Options:
  -m, --model <path>    Whisper model file
                        (default: $GENERATE_CAPTIONS_MODEL or ~/whisper-models/ggml-large-v3-turbo.bin)
  -l, --lang <code>     Language code, or "auto" (default: en)
  -p, --prompt <text>   Hint text with names/terms to improve spelling of proper nouns
  -o, --format <fmt>    Caption format: vtt, srt, or both (default: vtt)
  -f, --force           Re-caption videos that already have captions
  -r, --recursive       Include subfolders
  -v, --verbose         Show full ffmpeg/whisper output
  -h, --help            Show this help
      --version         Show version

Captions are written next to each video with the same name: intro.mp4 -> intro.vtt

Requires ffmpeg and whisper-cli on your PATH (brew install whisper-cpp ffmpeg).
Models: https://huggingface.co/ggerganov/whisper.cpp/tree/main
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      model: {
        type: 'string',
        short: 'm',
        default: DEFAULT_MODEL,
      },
      lang: {
        type: 'string',
        short: 'l',
        default: 'en',
      },
      prompt: {
        type: 'string',
        short: 'p',
      },
      format: {
        type: 'string',
        short: 'o',
        default: 'vtt',
      },
      force: {
        type: 'boolean',
        short: 'f',
        default: false,
      },
      recursive: {
        type: 'boolean',
        short: 'r',
        default: false,
      },
      verbose: {
        type: 'boolean',
        short: 'v',
        default: false,
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
      version: {
        type: 'boolean',
        default: false,
      },
    },
  });
} catch(err) {
  console.error(`${err.message}\n\nRun "generate-captions --help" for usage.`);
  process.exit(1);
}

const {
  values: opts, positionals,
} = parsed;

// Run a command; quiet by default, but keep the tail of stderr for error messages.
function run(cmd, args, { verbose = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: verbose ? 'inherit' : [
        'ignore',
        'ignore',
        'pipe',
      ],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error(`"${cmd}" not found. Is it installed and on your PATH?`));
      else reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}\n${stderr.trim()}`));
    });
  });
}

// Expand a leading ~ to the home directory (the shell doesn't when it's quoted or in --opt=~/...)
function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

async function exists(p) {
  try {
    await access(p); return true;
  } catch {
    return false;
  }
}

// Show paths relative to cwd when they're inside it, otherwise absolute
function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith('..') || path.isAbsolute(rel) ? path.resolve(p) : rel;
}

function isVideo(file) {
  return VIDEO_EXTS.has(path.extname(file).toLowerCase());
}

async function findVideos(dir, recursive) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      found.push(...(await findVideos(full, true)));
    } else if (entry.isFile() && isVideo(entry.name)) {
      found.push(full);
    }
  }
  return found.sort();
}

// Resolve each input (file or folder) to a list of videos, de-duplicated, in input order.
async function collectVideos(inputs, recursive) {
  const videos = [];
  const seen = new Set();
  for (const input of inputs) {
    const info = await stat(input).catch(() => null);
    let found;
    if (info?.isDirectory()) {
      found = await findVideos(input, recursive);
    } else if (info?.isFile()) {
      if (!isVideo(input)) throw new Error(`Not a supported video file: ${input}`);
      found = [input];
    } else {
      throw new Error(`Not found: ${input}`);
    }
    for (const video of found) {
      const key = path.resolve(video);
      if (seen.has(key)) continue;
      seen.add(key);
      videos.push(video);
    }
  }
  return videos;
}

async function main() {
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    console.log(VERSION);
    return;
  }

  const inputs = positionals.map(expandHome);
  if (inputs.length === 0) {
    console.error('Usage: generate-captions <file-or-folder>... [options]\nRun "generate-captions --help" for details.');
    process.exit(1);
  }
  if (!FORMATS.has(opts.format)) {
    console.error(`Invalid --format "${opts.format}". Use vtt, srt, or both.`);
    process.exit(1);
  }
  opts.model = expandHome(opts.model);
  if (!(await exists(opts.model))) {
    console.error(`Model not found: ${opts.model}\nUse --model or $GENERATE_CAPTIONS_MODEL to point to your .bin file.`);
    process.exit(1);
  }

  let videos;
  try {
    videos = await collectVideos(inputs, opts.recursive);
  } catch(err) {
    console.error(err.message);
    process.exit(1);
  }
  if (videos.length === 0) {
    console.log('No videos found.');
    return;
  }
  console.log(`Found ${videos.length} video(s). Model: ${path.basename(opts.model)}\n`);

  const exts = opts.format === 'both' ? [
    'vtt',
    'srt',
  ] : [opts.format];

  let done = 0,
    skipped = 0,
    failed = 0;
  const batchStart = Date.now();

  for (const [i, video] of videos.entries()) {
    const base = video.slice(0, -path.extname(video).length);
    const outputs = exts.map((ext) => `${base}.${ext}`);
    const label = `[${i + 1}/${videos.length}] ${displayPath(video)}`;

    if (!opts.force && (await Promise.all(outputs.map(exists))).every(Boolean)) {
      console.log(`${label}: skipped (captions already exist)`);
      skipped++;
      continue;
    }

    console.log(`${label}: transcribing...`);
    const wav = path.join(tmpdir(), `caption-${process.pid}-${i}.wav`);
    const start = Date.now();

    try {
      // 1. Extract audio as 16 kHz mono WAV (what whisper.cpp expects)
      await run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        video,
        '-vn',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        wav,
      ], opts);

      // 2. Transcribe to captions next to the video
      const whisperArgs = [
        '-m',
        opts.model,
        '-f',
        wav,
        '-l',
        opts.lang,
        ...exts.map((ext) => `-o${ext}`),
        '-of',
        base,
      ];
      if (opts.prompt) whisperArgs.push('--prompt', opts.prompt);
      await run('whisper-cli', whisperArgs, opts);

      // 3. whisper.cpp starts each cue's text with a space; strip leading whitespace per line
      for (const output of outputs) {
        const raw = await readFile(output, 'utf8');
        await writeFile(output, raw.replace(/^[ \t]+/gm, ''));
      }

      const written = outputs.map((o) => path.basename(o)).join(', ');
      console.log(`  done in ${((Date.now() - start) / 1000).toFixed(1)}s -> ${written}`);
      done++;
    } catch(err) {
      console.error(`  FAILED: ${err.message}`);
      failed++;
    } finally {
      await unlink(wav).catch(() => {});
    }
  }

  const mins = ((Date.now() - batchStart) / 60000).toFixed(1);
  console.log(`\nFinished in ${mins} min: ${done} captioned, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
