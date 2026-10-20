# generate-captions

Batch-generate WebVTT/SRT captions for videos using ffmpeg + whisper.cpp. Runs locally, no npm dependencies.

## Requirements

- Node 18.3+
- `ffmpeg` and `whisper-cli` on your PATH: `brew install whisper-cpp ffmpeg`
- A whisper.cpp model, e.g. [ggml-large-v3-turbo.bin](https://huggingface.co/ggerganov/whisper.cpp/tree/main), saved to `~/whisper-models/` (or set `GENERATE_CAPTIONS_MODEL`)

## Install

```sh
cd generate-captions
npm link
```

## Usage

```sh
generate-captions <file-or-folder>... [options]
```

| Option | Description |
| --- | --- |
| `-m, --model <path>` | Whisper model file (default: `$GENERATE_CAPTIONS_MODEL` or `~/whisper-models/ggml-large-v3-turbo.bin`) |
| `-l, --lang <code>` | Language code, or `auto` (default: `en`) |
| `-p, --prompt <text>` | Hint text with names/terms to improve spelling of proper nouns |
| `-o, --format <fmt>` | `vtt`, `srt`, or `both` (default: `vtt`) |
| `-f, --force` | Re-caption videos that already have captions |
| `-r, --recursive` | Include subfolders |
| `-v, --verbose` | Show full ffmpeg/whisper output |

Captions are written next to each video with the same name: `intro.mp4` → `intro.vtt`.

### Examples

```sh
generate-captions ./videos
generate-captions ./videos -r --prompt "Sun Valley, Averell Harriman, Bald Mountain"
generate-captions intro.mp4 outro.mov --format both --force
```
