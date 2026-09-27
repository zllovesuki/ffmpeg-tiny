import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { cases, fixture, meanError, serialize } from "../tests/fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(join(root, "build"), { recursive: true });
const packed = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", "build"],
    {
      cwd: root,
      encoding: "utf8",
    },
  ),
)[0];
const consumer = mkdtempSync(join(root, "build/consumer-"));
let server;
try {
  cpSync(join(root, "tests/consumer"), consumer, { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "ffmpeg-tiny-consumer",
      private: true,
      type: "module",
      dependencies: {
        "ffmpeg-tiny": `file:${join(root, "build", packed.filename)}`,
      },
    }),
  );
  execFileSync(
    "pnpm",
    ["install", "--ignore-scripts", "--ignore-workspace", "--lockfile=false"],
    {
      cwd: consumer,
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    {
      cwd: consumer,
      stdio: "inherit",
    },
  );
  execFileSync(
    process.execPath,
    [join(root, "node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: consumer,
      stdio: "inherit",
    },
  );
  const output = join(consumer, "dist");
  const configs = readdirSync(output, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(output, entry.name, "wrangler.json"))
    .filter(existsSync);
  assert.equal(configs.length, 1, "Expected one built Worker");
  assert.ok(
    !readdirSync(output, { recursive: true }).some((file) =>
      String(file).endsWith(".tar.gz"),
    ),
    "Corresponding source must not enter the Worker deployment",
  );
  server = createTestHarness({ workers: [{ configPath: configs[0] }] });
  await server.listen();
  for (const sample of cases) {
    const expected = await fixture(sample);
    const response = await server.fetch(`http://localhost/${sample.codec}`, {
      method: "POST",
      body: serialize(expected.input),
    });
    const pixels = new Uint8Array(await response.arrayBuffer());
    assert.equal(
      response.status,
      200,
      new TextDecoder().decode(pixels.subarray(0, 300)),
    );
    assert.equal(response.headers.get("X-WebCodecs"), "false");
    assert.equal(Number(response.headers.get("X-Width")), expected.width);
    assert.equal(Number(response.headers.get("X-Height")), expected.height);
    assert.ok(
      meanError(pixels, expected.raw) < 1,
      `${sample.codec} differs from native decode`,
    );
    console.log(
      `Packed ${sample.codec}: native pixel comparison passed in workerd`,
    );
  }
  console.log(`Validated npm archive: build/${packed.filename}`);
} finally {
  await server?.close();
  rmSync(consumer, { recursive: true, force: true });
}
