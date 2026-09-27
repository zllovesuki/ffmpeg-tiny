# ffmpeg-tiny

A small [FFmpeg](https://ffmpeg.org/) WebAssembly build for extracting video
frames, with **H.264, HEVC, VP8 and VP9** decoding.

The npm package includes the compiled decoder and a TypeScript API. Give it a
keyframe packet and it returns YUV planes you can sample to make a thumbnail.
Installation needs no compiler or build scripts.

## Use

Install with `pnpm add ffmpeg-tiny`. In a Cloudflare Worker:

```ts
import { decodeFrame } from "ffmpeg-tiny";
import module from "ffmpeg-tiny/decoder.wasm";

const frame = await decodeFrame(module, {
  codec: "h264",
  data: keyframeBytes,
  description: avcCBytes,
});
try {
  // Read each row using its plane's stride; row padding is not pixels.
  const luma = frame.y.data[y * frame.y.stride + x];
  // Resize, convert to RGB and encode while the frame is open.
} finally {
  frame.close();
}
```

The [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/reference/non-javascript-modules/)
and Wrangler include the imported WASM in the Worker deployment. Other runtimes
can load and compile the exported bytes themselves. WebAssembly SIMD is required.

## Working with frames

The caller reads the container and selects a complete, independently decodable
packet. [Mediabunny](https://mediabunny.dev/guide/media-sinks#encodedpacketsink)
can do this for MP4 and WebM; translate its `avc` codec name to `h264`.
Pass the track's avcC or hvcC configuration as `description` when needed.
H.264 Annex B packets containing their own parameter sets can omit it.

Frames expose 8-bit YUV 4:2:0 planes, their dimensions and byte strides, and the
display size after cropping. `fullRange` is `null` when unspecified. Plane data
is borrowed from the decoder: finish reading it before calling `close()`, or
copy it to keep it longer. Closing twice is harmless.

Resizing, rotation, pixel aspect ratio, color conversion and image encoding
belong to the caller. The TypeScript declarations describe the API.

## Limits

FFmpeg's usual error recovery is enabled, so minor damage can still produce a
frame. Inputs that cannot produce a supported frame reject with an error.
Other pixel layouts, including 10-bit and 4:4:4, are unsupported. There is no
HDR tone mapping, and the first keyframe may be black or unrepresentative.

Each call has its own decoder and a WASM heap that grows from 2 MiB up to
64 MiB. A thumbnail still needs a full decoded YUV frame. `wasmMemoryBytes`
excludes caller buffers, JS objects and runtime overhead; concurrent calls use
additional heaps. Closing frees decoder allocations. Dropping the frame and
its views allows the runtime to reclaim the heap.

Decoding runs synchronously. A JavaScript timeout cannot interrupt it, so
applications must use their runtime's execution limits and account for concurrent
requests. Malformed-input diagnostics are suppressed to avoid flooding logs.

## Credits and license

The decoders come from FFmpeg. The build tooling, wrapper and tests were
developed with [GPT-6 Astra](https://openai.com/index/gpt-6-astra/), with human
direction.

The package uses [LGPL-2.1-or-later](LICENSE). Its archive includes the matching
FFmpeg source and [third-party notices](NOTICE). That source adds to the npm
download size but stays out of the Worker bundle. See [Building](BUILDING.md)
to reproduce or modify the decoder and publish a release.
