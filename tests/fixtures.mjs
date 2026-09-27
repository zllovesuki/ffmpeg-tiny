import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BufferSource, EncodedPacketSink, Input, MP4, WEBM } from "mediabunny";

export const cases = [
  {
    name: "h264",
    codec: "h264",
    encoder: "libx264",
    extension: "mp4",
    args: ["-preset", "fast"],
  },
  {
    name: "hevc",
    codec: "hevc",
    encoder: "libx265",
    extension: "mp4",
    args: [
      "-preset",
      "ultrafast",
      "-x265-params",
      "log-level=error:pools=none:frame-threads=1",
    ],
  },
  {
    name: "vp8",
    codec: "vp8",
    encoder: "libvpx",
    extension: "webm",
    args: ["-deadline", "realtime"],
  },
  {
    name: "vp9",
    codec: "vp9",
    encoder: "libvpx-vp9",
    extension: "webm",
    args: ["-deadline", "realtime"],
  },
];

export async function fixture(sample) {
  const directory = mkdtempSync(join(tmpdir(), "ffmpeg-tiny-"));
  const filename = join(directory, `video.${sample.extension}`);
  try {
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=${sample.size ?? "640x360"}:r=24:d=0.2`,
      "-an",
      "-c:v",
      sample.encoder,
      "-threads",
      "2",
      ...sample.args,
      "-pix_fmt",
      sample.pixelFormat ?? "yuv420p",
      filename,
    ]);
    const source = new Input({
      formats: [MP4, WEBM],
      source: new BufferSource(readFileSync(filename)),
    });
    try {
      const track = await source.getPrimaryVideoTrack();
      if (!track) throw new Error("Fixture has no video track");
      const config = await track.getDecoderConfig();
      const packet = await new EncodedPacketSink(track).getFirstKeyPacket({
        verifyKeyPackets: true,
      });
      if (!config || !packet) throw new Error("Fixture has no keyframe");
      const description = config.description
        ? new Uint8Array(
            config.description.buffer ?? config.description,
            config.description.byteOffset ?? 0,
            config.description.byteLength,
          )
        : new Uint8Array();
      const raw = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-flags",
          "+unaligned",
          "-i",
          filename,
          "-frames:v",
          "1",
          "-pix_fmt",
          sample.pixelFormat ?? "yuv420p",
          "-f",
          "rawvideo",
          "pipe:1",
        ],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      return {
        input: { codec: sample.codec, data: packet.data, description },
        raw,
        width: sample.expectedWidth ?? config.codedWidth,
        height: sample.expectedHeight ?? config.codedHeight,
      };
    } finally {
      source.dispose();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function flatten(frame) {
  const bytes = new Uint8Array(
    frame.width * frame.height + 2 * frame.u.width * frame.u.height,
  );
  let offset = 0;
  for (const plane of [frame.y, frame.u, frame.v]) {
    for (let row = 0; row < plane.height; row++) {
      bytes.set(
        plane.data.subarray(
          row * plane.stride,
          row * plane.stride + plane.width,
        ),
        offset,
      );
      offset += plane.width;
    }
  }
  return bytes;
}

export function meanError(actual, expected) {
  if (actual.length !== expected.length) return Infinity;
  let total = 0;
  for (let index = 0; index < actual.length; index++)
    total += Math.abs(actual[index] - expected[index]);
  return total / actual.length;
}

export function serialize(input) {
  const extra = input.description ?? new Uint8Array();
  const bytes = new Uint8Array(4 + extra.length + input.data.length);
  new DataView(bytes.buffer).setUint32(0, extra.length, true);
  bytes.set(extra, 4);
  bytes.set(input.data, 4 + extra.length);
  return bytes;
}
