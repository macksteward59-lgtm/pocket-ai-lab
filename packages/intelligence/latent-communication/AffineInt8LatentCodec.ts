import type { LatentCodec, LatentDType } from "./LatentChannel";

/**
 * Lossy affine scalar quantizer for a controlled same-model POC.
 *
 * It intentionally supports one exact model revision at both ends. It is not
 * a learned cross-model alignment codec and must not be used to claim that
 * heterogeneous models share a latent space.
 */
export class AffineInt8LatentCodec implements LatentCodec {
  readonly codecId = "pocket-affine-int8";
  readonly codecVersion = "1";

  constructor(private readonly supportedModel: {
    modelId: string;
    modelRevision: string;
  }) {}

  canEncode(model: { modelId: string; modelRevision: string }): boolean {
    return sameIdentity(this.supportedModel, model);
  }

  canDecode(model: { modelId: string; modelRevision: string }): boolean {
    return sameIdentity(this.supportedModel, model);
  }

  async encode(input: {
    hiddenState: Float32Array;
    shape: readonly number[];
    dtype: LatentDType;
  }): Promise<Uint8Array> {
    if (input.dtype !== "int8") throw new Error("AffineInt8LatentCodec only supports int8");
    if (input.hiddenState.length === 0 || input.shape.reduce((a, b) => a * b, 1) !== input.hiddenState.length) {
      throw new Error("Latent shape does not match input vector");
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of input.hiddenState) {
      if (!Number.isFinite(value)) throw new Error("Latent input contains a non-finite value");
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    // Eight-byte little-endian min/max header followed by one signed byte/value.
    const output = new Uint8Array(8 + input.hiddenState.length);
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    view.setFloat32(0, min, true);
    view.setFloat32(4, max, true);
    for (let index = 0; index < input.hiddenState.length; index += 1) {
      const value = input.hiddenState[index];
      const quantized = max === min
        ? 0
        : Math.round(((value - min) / (max - min)) * 254 - 127);
      view.setInt8(8 + index, quantized);
    }
    return output;
  }

  async decode(input: {
    bytes: Uint8Array;
    shape: readonly number[];
    dtype: LatentDType;
  }): Promise<Float32Array> {
    if (input.dtype !== "int8") throw new Error("AffineInt8LatentCodec only supports int8");
    const elements = input.shape.reduce((a, b) => a * b, 1);
    if (!Number.isSafeInteger(elements) || elements <= 0 || input.bytes.byteLength !== 8 + elements) {
      throw new Error("Affine int8 payload length does not match tensor shape");
    }
    const view = new DataView(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    const min = view.getFloat32(0, true);
    const max = view.getFloat32(4, true);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new Error("Affine int8 payload header is invalid");
    }
    const output = new Float32Array(elements);
    for (let index = 0; index < elements; index += 1) {
      const quantized = view.getInt8(8 + index);
      output[index] = max === min ? min : min + ((quantized + 127) / 254) * (max - min);
    }
    return output;
  }
}

function sameIdentity(
  left: { modelId: string; modelRevision: string },
  right: { modelId: string; modelRevision: string }
): boolean {
  return left.modelId === right.modelId && left.modelRevision === right.modelRevision;
}
