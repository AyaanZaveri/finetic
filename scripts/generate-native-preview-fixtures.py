"""Synthetic WEB-DL-like files, not copies of commercial media."""
import pathlib
import subprocess
import sys

directory = pathlib.Path(sys.argv[1])
directory.mkdir(parents=True, exist_ok=True)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def encode(name, channels, codec, options):
    path = directory / name
    ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24000/1001:duration=30",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
        "-map", "0:v", "-map", "1:a", "-c:v", codec, "-pix_fmt", "yuv420p",
        "-threads", "4", *options, "-c:a", "eac3", "-ac", str(channels),
        "-b:a", "192k" if channels == 2 else "640k", str(path),
    )
    print(name, path.stat().st_size, flush=True)
    subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                    "stream=codec_name,profile,width,height,channels:format=duration,size",
                    "-of", "compact", str(path)], check=True)


encode("avc-stereo.mkv", 2, "libx264",
       ["-preset", "veryfast", "-profile:v", "high", "-crf", "24", "-g", "96", "-bf", "3"])
encode("avc-surround-open-gop.mkv", 6, "libx264",
       ["-preset", "veryfast", "-profile:v", "high", "-crf", "20", "-g", "120",
        "-bf", "3", "-x264-params", "open-gop=1:scenecut=0"])
encode("hevc-control.mkv", 6, "libx265",
       ["-preset", "ultrafast", "-crf", "12", "-x265-params", "pools=4:frame-threads=2:keyint=48:log-level=error"])

source = directory / "avc-stereo.mkv"
ffmpeg("-i", str(source), "-map", "0", "-c", "copy", "-cues_to_front", "1",
       str(directory / "avc-front-cues.mkv"))
# A streaming-style Matroska file intentionally omits the cue index. Keep it
# as a diagnostic control, separate from the normal indexed WEB-DL cases.
ffmpeg("-i", str(source), "-map", "0", "-c", "copy", "-live", "1",
       str(directory / "avc-no-cues.mkv"))


def vint(data, offset, identifier=False):
    first = data[offset]
    width = next(n for n in range(1, 9) if first & (0x80 >> (n - 1)))
    value = int.from_bytes(data[offset:offset + width], "big")
    return (value if identifier else value & ((1 << (7 * width)) - 1)), width


def elements(data, start, end):
    while start < end:
        identifier, id_width = vint(data, start, True)
        length, size_width = vint(data, start + id_width)
        body = start + id_width + size_width
        limit = min(end, body + length)
        yield identifier, body, limit
        start = limit


# Reproduce a sparse-reader packet error after a successful index open.
# CueClusterPosition stays correct, but CueRelativePosition points at the
# cluster timestamp rather than the video block. The full demuxer can seek
# using the cluster and read the actual frame.
damaged = bytearray(source.read_bytes())
relative_offsets = 0
for segment_id, segment_start, segment_end in elements(damaged, 0, len(damaged)):
    if segment_id != 0x18538067:
        continue
    for element, start, end in elements(damaged, segment_start, segment_end):
        if element != 0x1C53BB6B:
            continue
        for point, p_start, p_end in elements(damaged, start, end):
            if point != 0xBB:
                continue
            for positions, t_start, t_end in elements(damaged, p_start, p_end):
                if positions != 0xB7:
                    continue
                for field, f_start, f_end in elements(damaged, t_start, t_end):
                    if field == 0xF0:
                        damaged[f_start:f_end] = bytes(f_end - f_start)
                        relative_offsets += 1
assert relative_offsets > 0, "FFmpeg fixture must have CueRelativePosition entries"
(directory / "avc-bad-cue-offsets.mkv").write_bytes(damaged)
print(f"Damaged {relative_offsets} relative cue offsets for packet failure fixture", flush=True)

# Same AVC video packets, different container/index layouts. AAC makes the
# files usable in the browser as well as in the bundled native player.
ffmpeg("-i", str(source), "-map", "0", "-c:v", "copy", "-c:a", "aac",
       str(directory / "avc-tail.mp4"))
ffmpeg("-i", str(directory / "avc-tail.mp4"), "-map", "0", "-c", "copy",
       "-movflags", "+faststart", str(directory / "avc-front.mp4"))
ffmpeg("-i", str(directory / "avc-tail.mp4"), "-map", "0", "-c", "copy",
       "-movflags", "+frag_keyframe+empty_moov+default_base_moof", str(directory / "avc-fragmented.mp4"))
ffmpeg("-i", str(directory / "avc-tail.mp4"), "-map", "0", "-c", "copy",
       str(directory / "avc.mov"))
ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=30",
       "-f", "lavfi", "-i", "sine=frequency=660:duration=30",
       "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6",
       "-threads", "4", "-row-mt", "1", "-g", "96", "-pix_fmt", "yuv420p",
       "-c:a", "libopus", str(directory / "vp9.webm"))
