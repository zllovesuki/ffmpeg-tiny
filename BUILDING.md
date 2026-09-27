# Building ffmpeg-tiny

Use Node 24, pnpm 11, Git and Docker from a POSIX environment. Tests need native
`ffmpeg` with libx264, libx265 and libvpx to generate sample videos.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run typecheck
pnpm run format:check
pnpm test
pnpm run test:fuzz 1000
pnpm run test:package
```

[The build script](scripts/build.mjs) pins FFmpeg and the Emscripten image and
defines the enabled features. It compiles libavcodec and libavutil without
GPL or nonfree components. Native encoders are used only to generate test inputs.

Sources stay in `upstream/ffmpeg`, package output in `dist/`, and caches and
test artifacts in `build/`. These directories are ignored by Git. Compilation
runs in Docker as the calling user, with networking disabled.

## Checks

The tests compare decoded pixels with native FFmpeg and cover the wrapper's
frame lifetimes and error handling. `test:fuzz` runs deterministic packet and
configuration mutations; its argument is the count per codec. Unexpected
failures save their input under `build/fuzz/`. This is a smoke test, not
coverage-guided fuzzing or a guarantee that arbitrary input is safe.

`test:package` packs the built files, installs the archive with scripts disabled,
and tests its types and Cloudflare Vite output in workerd. It leaves the tested
archive in `build/`. These local checks do not establish deployed CPU time,
total isolate memory or production concurrency limits.

## Rebuild or replace the decoder

The package includes the complete FFmpeg source in `dist/ffmpeg-source.tar.gz`,
plus the shim, wrapper and build script. Extract the package to a writable
directory. When `upstream/ffmpeg` is absent, the script unpacks the included
source instead of cloning it.

To change FFmpeg, unpack that source into `upstream/`, edit it, then run
`node scripts/build.mjs`. To change the wrapper, install the development
dependencies and run `pnpm exec tsc -p tsconfig.json`. Applications can pass
the rebuilt, interface-compatible WASM module to `decodeFrame`.

Release builds from Git require the pinned, unmodified revision so the included
source matches the binary. Distributing a modified build requires its matching
source and the applicable notices.

## Publish

Check that `package.json` names the public repository; the intended location is
`zllovesuki/ffmpeg-tiny`. For the first release, sign in to a 2FA-enabled npm
account with `npm login`, then run `npm publish <archive> --ignore-scripts`
using the archive produced by `test:package`.

For later releases, configure an [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/)
for the repository and `publish.yml`. Update the package version and push a
matching `v<version>` tag. The workflow builds and tests the archive, then
publishes it in a separate job. Only the publishing job can request an OIDC token.
