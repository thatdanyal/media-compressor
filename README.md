# Media Compressor

Shrink videos and pictures to the **exact file size you need** — "make this 8 MB" — instead of guessing at quality sliders.

Drop files in, type a target size, done. Works on Windows, macOS and Linux, and updates itself.

## Download

Grab the latest installer from the [Releases page](https://github.com/thatdanyal/media-compressor/releases/latest):

| Platform | File                                                                    |
| -------- | ----------------------------------------------------------------------- |
| Windows  | `media-compressor-x.y.z-setup.exe`                                      |
| macOS    | `media-compressor-x.y.z-arm64.dmg` (Apple Silicon) / `-x64.dmg` (Intel) |
| Linux    | `media-compressor-x.y.z.AppImage`                                       |

> **Windows:** SmartScreen may warn on first run because the installer isn't code-signed. Click _More info → Run anyway_.
>
> **macOS:** the app isn't notarized. Right-click the app → _Open_ the first time. Auto-update is not available on macOS without an Apple Developer certificate; download new versions manually.

## Features

Two modes:

- **Target size** — type a size in KB or MB (or pick a preset: 8 MB for Discord, 25 MB for email, …) and the output lands just under it. Fast.
- **Max Squeeze** — the smallest file that still looks good, using up to **10 minutes per video** (pictures take seconds). It never runs longer than that: encodes project their own finish time and fall back to faster settings if they'd overrun. Output is H.265 MP4 / WebP.

Plus:

- **Video** — MP4, MOV, MKV, WebM, AVI and more → H.264 MP4 (or H.265). Two-pass encoding hits the target on the first try; automatically downscales resolution when the budget is too small for the source size.
- **Pictures** — JPG, PNG, WebP, HEIC, AVIF and more → JPEG or WebP. Binary-searches quality, then shrinks dimensions if needed. Strips EXIF/location metadata by default.
- Batch queue with per-file progress, cancel, retry and "show in folder"
- Choose an output folder or save next to the originals
- **Auto-update** from GitHub Releases (Windows & Linux)

## How the target size is hit

**Video:** `bitrate = target_bytes × 8 ÷ duration`, minus the audio budget and ~3% container overhead. If that bitrate is too low for the source resolution, the output is downscaled (1080p → 720p → 480p …) so it stays watchable. Encoded with two-pass libx264. If the result still overshoots, it retries with a proportionally lower bitrate.

**Image:** the image is decoded once, then re-encoded in a binary search over quality 5–95 for the highest quality that fits. If even low quality overshoots, the image is scaled down 15% and the search repeats — fewer pixels at good quality beats a blocky full-size image.

## How Max Squeeze uses its 10 minutes

Video is capped at 1080p and encoded with H.265 at CRF 30 (about 40% smaller than H.264 at similar quality, but ~3× slower). Once the encode has run for a few seconds it projects its finish time; if that overruns the budget it's killed and the video is re-encoded with fast H.264 instead, and as a last resort at 720p. Slower presets and AV1 were benchmarked and dropped — they weren't smaller for the time spent. Pictures become WebP at quality 75 with maximum encoder effort, capped at 2048 px.

## Development

```bash
npm install
npm run dev          # launch with hot reload
npm run try -- path/to/file.mp4 8MB   # exercise the engine without the UI
npm run try -- path/to/file.mp4 squeeze:2   # Max Squeeze with a 2-minute budget
npm run build:win    # local installer -> dist/
```

ffmpeg is bundled via `ffmpeg-static`; no system install needed.

### Releasing

```bash
npm version patch    # or minor / major — bumps package.json and tags vX.Y.Z
git push --follow-tags
```

GitHub Actions builds all three platforms and publishes the release. Installed copies pick it up on next launch.

## License

MIT
