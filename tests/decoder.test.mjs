import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { decodeFrame } from "../dist/index.js";
import { cases, fixture, flatten, meanError } from "./fixtures.mjs";

const module = await WebAssembly.compile(
  await readFile(new URL("../dist/decoder.wasm", import.meta.url)),
);

for (const sample of [
  ...cases,
  { ...cases[0], name: "h264-4k", size: "3840x2160" },
  { ...cases[0], name: "h264-odd-chroma", size: "642x362" },
  {
    ...cases[0],
    name: "h264-display-crop",
    size: "128x96",
    expectedWidth: 122,
    expectedHeight: 90,
    args: [
      ...cases[0].args,
      "-bsf:v",
      "h264_metadata=crop_left=2:crop_top=2:crop_right=4:crop_bottom=4",
    ],
  },
]) {
  test(`decodes ${sample.name} to the native FFmpeg pixels`, async () => {
    const expected = await fixture(sample);
    const frame = await decodeFrame(module, expected.input);
    try {
      assert.equal(frame.width, expected.width);
      assert.equal(frame.height, expected.height);
      assert.equal(frame.format, "yuv420p");
      assert.ok(frame.wasmMemoryBytes <= 64 * 1024 * 1024);
      assert.ok(meanError(flatten(frame), expected.raw) < 1);
    } finally {
      frame.close();
      frame.close();
    }
  });
}

test("refuses unsupported pixel layouts instead of treating them as 8-bit 4:2:0", async () => {
  for (const pixelFormat of ["yuv420p10le", "yuv444p"]) {
    const expected = await fixture({ ...cases[0], pixelFormat });
    await assert.rejects(
      decodeFrame(module, expected.input),
      /8-bit planar YUV 4:2:0/,
    );
  }
});

test("malformed packets cannot flood application logs", async () => {
  let messages = 0;
  const original = console.error;
  console.error = () => {
    messages++;
  };
  try {
    const packet = new Uint8Array(80_000);
    for (let index = 0; index < packet.length; index += 8)
      packet.set([0, 0, 0, 1, 0x67, 0xff, 0xff, 0xff], index);
    await assert.rejects(decodeFrame(module, { codec: "h264", data: packet }));
    for (let index = 0; index < packet.length; index += 8)
      packet[index + 4] = 0x42;
    await assert.rejects(decodeFrame(module, { codec: "hevc", data: packet }));
    assert.equal(messages, 0);
  } finally {
    console.error = original;
  }
});

test("rejects invalid packets and keeps later decoder instances independent", async () => {
  await assert.rejects(
    decodeFrame(module, { codec: "av1", data: new Uint8Array([1]) }),
    /Unsupported codec/,
  );
  await assert.rejects(
    decodeFrame(module, { codec: "h264", data: new Uint8Array() }),
    /nonempty/,
  );
  await assert.rejects(
    decodeFrame(module, { codec: "h264", data: new Uint8Array([1, 2, 3]) }),
    /failed/,
  );
  const expected = await fixture(cases[0]);
  const [first, second] = await Promise.all([
    decodeFrame(module, expected.input),
    decodeFrame(module, expected.input),
  ]);
  try {
    assert.notEqual(first.y.data.buffer, second.y.data.buffer);
    first.close();
    assert.ok(meanError(flatten(second), expected.raw) < 1);
  } finally {
    first.close();
    second.close();
  }
});
