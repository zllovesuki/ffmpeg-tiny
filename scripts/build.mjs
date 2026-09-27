// SPDX-License-Identifier: LGPL-2.1-or-later
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = "upstream/ffmpeg";
const revision = "1041abdc962f4cc4f394aa8de9dc5236c0c3b9e7";
const image =
  "emscripten/emsdk@sha256:27bc6267cb285223b8aebb7627bfebae7cb3ad2aaa0d5923b8aa5321793033e8";
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });

mkdirSync(`${root}/dist`, { recursive: true });
mkdirSync(`${root}/upstream`, { recursive: true });
if (!existsSync(`${root}/${vendor}`)) {
  if (existsSync(`${root}/dist/ffmpeg-source.tar.gz`)) {
    // The npm archive contains the exact source, so recipients can rebuild it.
    run("tar", ["-xzf", "dist/ffmpeg-source.tar.gz", "-C", "upstream"]);
  } else {
    run("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      "n8.1.3",
      "https://github.com/FFmpeg/FFmpeg.git",
      vendor,
    ]);
  }
}
if (existsSync(`${root}/${vendor}/.git`)) {
  const current = run("git", ["-C", vendor, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  if (current !== revision)
    throw new Error(`Expected FFmpeg ${revision}; found ${current}`);
  const changes = run(
    "git",
    ["-C", vendor, "status", "--porcelain", "--untracked-files=no"],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  ).trim();
  if (changes)
    throw new Error("FFmpeg source has changes; source and binary must match");
  const source = run(
    "git",
    ["-C", vendor, "archive", "--format=tar", "--prefix=ffmpeg/", revision],
    {
      stdio: "pipe",
      maxBuffer: 150 * 1024 * 1024,
    },
  );
  writeFileSync(
    `${root}/dist/ffmpeg-source.tar.gz`,
    gzipSync(source, { level: 9 }),
  );
}

const docker = (directory, command, args, options = {}) =>
  run(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "--user",
      `${process.getuid()}:${process.getgid()}`,
      "-e",
      "EM_CACHE=/work/build/emscripten-cache",
      "-v",
      `${root}:/work`,
      "-w",
      `/work/${directory}`,
      image,
      command,
      ...args,
    ],
    options,
  );
mkdirSync(`${root}/build`, { recursive: true });
// The image's prebuilt sysroot stays available without root-owned output files.
if (!existsSync(`${root}/build/emscripten-cache`)) {
  docker("", "cp", [
    "-R",
    "/emsdk/upstream/emscripten/cache",
    "/work/build/emscripten-cache",
  ]);
}
docker(vendor, "./configure", [
  "--cc=emcc",
  "--cxx=em++",
  "--ar=emar",
  "--ranlib=emranlib",
  "--nm=emnm",
  "--enable-cross-compile",
  "--target-os=none",
  "--arch=wasm32",
  "--disable-everything",
  "--disable-autodetect",
  "--disable-programs",
  "--disable-doc",
  "--disable-debug",
  "--disable-network",
  "--disable-avdevice",
  "--disable-avfilter",
  "--disable-avformat",
  "--disable-swresample",
  "--disable-swscale",
  "--disable-pthreads",
  "--disable-w32threads",
  "--disable-os2threads",
  "--disable-runtime-cpudetect",
  "--disable-x86asm",
  "--enable-small",
  "--enable-decoder=h264,hevc,vp8,vp9",
  "--extra-cflags=-O3 -msimd128 -fno-stack-protector",
]);
docker(vendor, "make", [
  "-j4",
  "libavcodec/libavcodec.a",
  "libavutil/libavutil.a",
]);
docker("", "emcc", [
  "src/decoder.c",
  "-I",
  vendor,
  `${vendor}/libavcodec/libavcodec.a`,
  `${vendor}/libavutil/libavutil.a`,
  "-O3",
  "-msimd128",
  "--no-entry",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sENVIRONMENT=web,worker",
  "-sFILESYSTEM=0",
  "-sINITIAL_MEMORY=2097152",
  "-sSTACK_SIZE=65536",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sMAXIMUM_MEMORY=67108864",
  "-sABORTING_MALLOC=0",
  '-sEXPORTED_FUNCTIONS=["_malloc","_free","_begin","_push","_finish","_width","_height","_plane","_stride","_full_range","_close_decoder"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
  "-o",
  "dist/core.mjs",
]);
run("mv", ["dist/core.wasm", "dist/decoder.wasm"]);
mkdirSync(`${root}/dist/licenses`, { recursive: true });
for (const [name, path] of [
  ["emscripten.txt", "/emsdk/upstream/emscripten/LICENSE"],
  ["musl.txt", "/emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT"],
]) {
  writeFileSync(
    `${root}/dist/licenses/${name}`,
    docker("", "cat", [path], { stdio: "pipe" }),
  );
}
