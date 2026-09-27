// SPDX-License-Identifier: LGPL-2.1-or-later
import createCore from "./core.mjs";

export type VideoCodec = "h264" | "hevc" | "vp8" | "vp9";

export interface EncodedFrame {
  codec: VideoCodec;
  /** One complete, independently decodable compressed packet. */
  data: Uint8Array;
  /** Container codec configuration, such as avcC or hvcC. */
  description?: Uint8Array;
}

export interface Plane {
  /** Borrowed view into WASM memory. Only valid until the frame is closed. */
  data: Uint8Array<ArrayBuffer>;
  /** Byte distance between adjacent rows. */
  stride: number;
  width: number;
  height: number;
}

export interface DecodedFrame {
  format: "yuv420p";
  width: number;
  height: number;
  /** null means the bitstream does not specify a range. */
  fullRange: boolean | null;
  y: Plane;
  u: Plane;
  v: Plane;
  /** Allocated linear memory, excluding JS and runtime overhead. */
  wasmMemoryBytes: number;
  /** Free decoder allocations. Idempotent; do not use plane views afterwards. */
  close(): void;
}

const codecs: VideoCodec[] = ["h264", "hevc", "vp8", "vp9"];

/** Decode a keyframe into borrowed 8-bit YUV 4:2:0 planes, without copying them. */
export async function decodeFrame(
  module: WebAssembly.Module,
  input: EncodedFrame,
): Promise<DecodedFrame> {
  const codec = codecs.indexOf(input.codec);
  if (codec < 0) throw new TypeError(`Unsupported codec: ${input.codec}`);
  if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0)
    throw new TypeError("Expected a nonempty encoded packet");
  if (
    input.description !== undefined &&
    !(input.description instanceof Uint8Array)
  )
    throw new TypeError("Expected codec description bytes");

  const core = await createCore({
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(module, imports);
      receive(instance, module);
      return instance.exports;
    },
  });
  const allocations: number[] = [];
  const allocate = (bytes: Uint8Array) => {
    // AV_INPUT_BUFFER_PADDING_SIZE: decoders can read past a packet's end.
    if (bytes.byteLength > 0x7fffffff - 64)
      throw new RangeError("Encoded input is too large");
    const address = core._malloc(bytes.byteLength + 64);
    if (!address) throw new RangeError("Decoder memory limit exceeded");
    allocations.push(address);
    core.HEAPU8.set(bytes, address);
    core.HEAPU8.fill(
      0,
      address + bytes.byteLength,
      address + bytes.byteLength + 64,
    );
    return address;
  };
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      core._close_decoder();
    }
  };
  const check = (status: number, operation: string) => {
    if (status < 0) throw new Error(`${operation} failed (${status})`);
  };
  try {
    const extra = input.description ?? new Uint8Array();
    check(
      core._begin(codec, allocate(extra), extra.byteLength),
      "Decoder open",
    );
    check(
      core._push(allocate(input.data), input.data.byteLength),
      "Packet decode",
    );
    const status = core._finish();
    if (status === -1)
      throw new Error("Only 8-bit planar YUV 4:2:0 output is supported");
    check(status, "Frame decode");
    const width = core._width();
    const height = core._height();
    const plane = (index: number, width: number, height: number): Plane => {
      const address = core._plane(index);
      const stride = core._stride(index);
      const length = (height - 1) * stride + width;
      if (
        width <= 0 ||
        height <= 0 ||
        stride < width ||
        address <= 0 ||
        !Number.isSafeInteger(length) ||
        address + length > core.HEAPU8.length
      )
        throw new Error("Invalid decoded plane");
      return {
        data: core.HEAPU8.subarray(address, address + length),
        stride,
        width,
        height,
      };
    };
    const range = core._full_range();
    return {
      format: "yuv420p",
      width,
      height,
      fullRange: range < 0 ? null : range === 1,
      y: plane(0, width, height),
      u: plane(1, Math.ceil(width / 2), Math.ceil(height / 2)),
      v: plane(2, Math.ceil(width / 2), Math.ceil(height / 2)),
      wasmMemoryBytes: core.HEAPU8.byteLength,
      close,
    };
  } catch (error) {
    close();
    throw error;
  } finally {
    for (const address of allocations) core._free(address);
  }
}
