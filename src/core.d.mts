interface Core {
  HEAPU8: Uint8Array<ArrayBuffer>;
  _malloc(size: number): number;
  _free(address: number): void;
  _begin(codec: number, extra: number, length: number): number;
  _push(address: number, length: number): number;
  _finish(): number;
  _width(): number;
  _height(): number;
  _plane(index: number): number;
  _stride(index: number): number;
  _full_range(): number;
  _close_decoder(): void;
}

export default function createCore(options: {
  instantiateWasm(
    imports: WebAssembly.Imports,
    receive: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ): WebAssembly.Exports;
}): Promise<Core>;
