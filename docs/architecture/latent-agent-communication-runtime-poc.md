# Latent Agent Communication Runtime POC

## Scope and explicit limitations

This is an executable, in-process proof of concept for a same-model latent side
channel. It does not expose llama.cpp hidden states, modify the iOS inference
backend, train a learned codec, or establish cross-model latent alignment.

The first codec is a lossy affine int8 scalar quantizer. It only accepts an
exact model ID and revision at both ends. Different model identities must fall
back to text until a trained alignment codec is implemented and evaluated.

## Runtime path

1. Sender and recipient advertise capabilities.
2. The channel negotiates an exact codec ID/version, dtype, model identity, and
   minimum payload ceiling.
3. Sender validates tensor shape and expiry, encodes the vector, and asks the
   host authorization port to approve the exact task, conversation, endpoints,
   codec, and byte count.
4. Binary bytes are stored outside MessageBus. Only a bounded envelope and blob
   reference are returned to the control plane.
5. Recipient validates task/route/expiry, rechecks host authorization, claims a
   replay key, retrieves the blob, verifies length and SHA-256, and only then
   invokes the decoder.
6. Decoded vector length and finite numeric values are checked before return.

## POC measurements

For N float32 values, the baseline payload is 4N bytes. The affine int8 codec
stores N bytes plus an 8-byte min/max header. For a 1,024-value vector this is
1,032 bytes versus 4,096 bytes, about 3.97x smaller before envelope overhead.
The tests also calculate reconstruction RMSE and enforce a 0.02 upper bound
for the deterministic fixture.

These are codec microbenchmark facts for the test fixture, not proof of lower
end-to-end agent latency, KV-cache use, model-weight storage, or inference
compute. Those require runtime-level measurements on actual iOS model pairs.

## Host adapters still required

- Durable, access-controlled binary object storage instead of the in-memory
  demonstration store.
- Persistent atomic replay protection across processes/devices.
- APEX/Director authorization adapter with signed, auditable decisions.
- Native iOS hidden-state export and CryptoKit digest adapter.
- A model-specific codec integrated with a pinned llama.cpp runtime.
- Benchmarks comparing task success, semantic distortion, transfer bytes,
  encode/decode latency, peak memory, compute, and actual KV-cache behavior.

The in-memory store and replay guard are test/demo utilities only.
