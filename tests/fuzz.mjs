import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { decodeFrame } from "../dist/index.js";
import { cases, fixture, serialize } from "./fixtures.mjs";

const iterations = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(iterations) || iterations < 1)
  throw new TypeError("Expected a positive iteration count per codec");
const module = await WebAssembly.compile(
  await readFile(new URL("../dist/decoder.wasm", import.meta.url)),
);
let state = 0x74696e79;
const random = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
};

for (const sample of cases) {
  const { input: seed } = await fixture(sample);
  let decoded = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const input = {
      codec: seed.codec,
      data: seed.data.slice(),
      description: seed.description.slice(),
    };
    const field = iteration % 2 ? "data" : "description";
    const bytes = input[field];
    switch (iteration % 6) {
      case 0:
      case 1:
        input[field] = bytes.subarray(0, random() % (bytes.length + 1));
        break;
      case 2:
      case 3:
        for (let count = 1 + (random() % 8); count > 0 && bytes.length; count--)
          bytes[random() % bytes.length] ^= 1 << (random() % 8);
        break;
      default:
        if (bytes.length) {
          const start = random() % bytes.length;
          bytes.fill(
            random() % 256,
            start,
            Math.min(bytes.length, start + 1 + (random() % 32)),
          );
        }
    }
    let frame;
    try {
      frame = await decodeFrame(module, input);
      decoded++;
      for (const plane of [frame.y, frame.u, frame.v]) {
        assert.ok(plane.width > 0 && plane.height > 0);
        assert.ok(plane.stride >= plane.width);
        assert.equal(
          plane.data.length,
          (plane.height - 1) * plane.stride + plane.width,
        );
      }
      assert.ok(frame.wasmMemoryBytes <= 64 * 1024 * 1024);
    } catch (error) {
      const expected =
        error instanceof Error &&
        !(error instanceof WebAssembly.RuntimeError) &&
        /failed \(-?\d+\)|nonempty encoded packet|Only 8-bit planar YUV|Decoder memory limit/.test(
          error.message,
        );
      if (!expected) {
        await mkdir("build/fuzz", { recursive: true });
        const path = `build/fuzz/${sample.codec}-${iteration}.packet`;
        await writeFile(path, serialize(input));
        throw new Error(
          `${sample.codec} mutation ${iteration}; input saved to ${path}`,
          { cause: error },
        );
      }
    } finally {
      frame?.close();
    }
    if (iteration % 50 === 0) await setImmediate();
  }
  console.log(
    `${sample.codec}: ${iterations} deterministic mutations, ${decoded} decoded, ${iterations - decoded} rejected`,
  );
}
