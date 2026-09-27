import { decodeFrame, type VideoCodec } from "ffmpeg-tiny";
import module from "ffmpeg-tiny/decoder.wasm";

export default {
  async fetch(request: Request) {
    const body = new Uint8Array(await request.arrayBuffer());
    const length = new DataView(body.buffer).getUint32(0, true);
    const frame = await decodeFrame(module, {
      codec: new URL(request.url).pathname.slice(1) as VideoCodec,
      description: body.subarray(4, 4 + length),
      data: body.subarray(4 + length),
    });
    try {
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
      return new Response(bytes, {
        headers: {
          "X-Width": String(frame.width),
          "X-Height": String(frame.height),
          "X-Wasm-Memory": String(frame.wasmMemoryBytes),
          "X-WebCodecs": String("VideoDecoder" in globalThis),
        },
      });
    } finally {
      frame.close();
    }
  },
};
