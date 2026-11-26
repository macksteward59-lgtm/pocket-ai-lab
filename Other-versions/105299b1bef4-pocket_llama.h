#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Status codes. A non-zero code means no result may be treated as success. */
#define POCKET_LLAMA_OK 0
#define POCKET_LLAMA_ERR_NOT_LINKED 1
#define POCKET_LLAMA_ERR_MODEL 2
#define POCKET_LLAMA_ERR_CONTEXT 3
#define POCKET_LLAMA_ERR_PROMPT 4
#define POCKET_LLAMA_ERR_DECODE 5
#define POCKET_LLAMA_ERR_EMPTY 6
#define POCKET_LLAMA_ERR_CANCELLED 7
#define POCKET_LLAMA_ERR_ARGS 8
#define POCKET_LLAMA_ERR_BUFFER 9
#define POCKET_LLAMA_ERR_UNSUPPORTED 10

typedef struct pocket_llama pocket_llama;

/* Independent of final-layer embedding export and GIE pooled output vectors. */
#define POCKET_LLAMA_INPUT_MAX_TOKENS 256
#define POCKET_LLAMA_INPUT_MAX_DIMENSION 8192
#define POCKET_LLAMA_INPUT_MAX_BYTES (16 * 1024 * 1024)
#define POCKET_LLAMA_INPUT_MAX_LOGITS 262144

typedef struct pocket_llama_input_embedding_info {
    int32_t input_dimension;
    int32_t vocabulary_size;
    int32_t max_token_count;
    size_t max_input_bytes;
} pocket_llama_input_embedding_info;

#define POCKET_LLAMA_METADATA_ARCH_MAX 64
#define POCKET_LLAMA_METADATA_NAME_MAX 128
#define POCKET_LLAMA_METADATA_TOKENIZER_MAX 64

typedef struct pocket_llama_metadata {
    int32_t gguf_version;
    int32_t file_type;
    int64_t training_context_length;
    int64_t parameter_count;
    uint64_t file_size_bytes;
    int32_t metadata_key_count;
    int32_t has_file_type;
    int32_t has_training_context;
    int32_t has_parameter_count;
    char architecture[POCKET_LLAMA_METADATA_ARCH_MAX];
    char model_name[POCKET_LLAMA_METADATA_NAME_MAX];
    char tokenizer_model[POCKET_LLAMA_METADATA_TOKENIZER_MAX];
} pocket_llama_metadata;

/* 1 when this translation unit was compiled against llama.cpp. */
int pocket_llama_linked(void);

const char * pocket_llama_pin_tag(void);
const char * pocket_llama_pin_commit(void);

/*
 * Fills caller buffers. metal_device_usable is 1 only when a Metal backend
 * device has a name and ggml can create that backend. Strings are NUL-terminated.
 * Returns POCKET_LLAMA_OK or POCKET_LLAMA_ERR_NOT_LINKED.
 */
int pocket_llama_probe(
    int * metal_backend_registered,
    int * metal_device_usable,
    int * gpu_device_count,
    char * version,
    size_t version_len,
    char * system_info,
    size_t system_info_len,
    char * metal_device_description,
    size_t metal_device_description_len);

/*
 * n_gpu_layers: 0 keeps weights on the CPU. A negative value asks llama.cpp to
 * offload every layer. On success, *out_engine is owned by the caller.
 */
int pocket_llama_load(
    const char * path,
    int32_t n_ctx,
    int32_t n_gpu_layers,
    pocket_llama ** out_engine,
    char * err,
    size_t err_len);

/* Reads bounded GGUF metadata without allocating model tensor weights. */
int pocket_llama_inspect_gguf(
    const char * path,
    pocket_llama_metadata * out_metadata,
    char * err,
    size_t err_len);

void pocket_llama_request_cancel(pocket_llama * engine);
/* Reset cancellation before scheduling a new operation, never inside a worker. */
void pocket_llama_reset_cancel(pocket_llama * engine);

/* layers and total are -1 when llama.cpp did not log an offload line. */
void pocket_llama_offload(const pocket_llama * engine, int * requested, int * layers, int * total);

/*
 * Writes model text into out, including a trailing NUL, only on POCKET_LLAMA_OK.
 * Empty or whitespace-only output is POCKET_LLAMA_ERR_EMPTY and is not a success.
 */
int pocket_llama_generate(
    pocket_llama * engine,
    const char * prompt,
    int32_t max_tokens,
    float temperature,
    char * out,
    size_t out_len,
    char * err,
    size_t err_len);

/*
 * Mechanical limits for the loaded llama decoder-family model and context.
 * Does not run inference, imply semantic compatibility, or grant authority.
 * Unsupported architectures fail explicitly. All fields are zero on failure.
 */
int pocket_llama_get_input_embedding_info(
    pocket_llama * engine,
    pocket_llama_input_embedding_info * out_info,
    char * err,
    size_t err_len);

/*
 * Experimental stateless prefill of one bounded row-major Float32 input matrix.
 * These are first-layer MODEL INPUT embeddings, not captured final-layer outputs.
 * No tokenization, BOS insertion, text suffix, sampling, or continuation occurs.
 * Input count and output capacity are measured in floats. The exact input width
 * and full vocabulary logit width come from get_input_embedding_info.
 * Validates bounds/capacity/finiteness before changing context, requests only the
 * last position's logits, then clears model memory after every attempted decode.
 * On failure *out_count is zero; any logits copied by this call are cleared.
 */
int pocket_llama_evaluate_input_embeddings(
    pocket_llama * engine,
    const float * embeddings,
    size_t input_count,
    int32_t token_count,
    int32_t input_dimension,
    float * out_logits,
    size_t out_capacity,
    size_t * out_count,
    char * err,
    size_t err_len);

/*
 * Copies the final generated token's output embedding into caller-owned storage.
 * The caller first queries the required count with out=NULL/capacity=0, then
 * supplies a float buffer. This is a final-layer output embedding, not every
 * transformer layer's hidden state.
 */
int pocket_llama_copy_last_embedding(
    pocket_llama * engine,
    float * out,
    size_t out_capacity,
    size_t * out_count,
    char * err,
    size_t err_len);
int pocket_llama_set_embeddings(
    pocket_llama * engine,
    int enabled,
    char * err,
    size_t err_len);

/* Bounded generated-token sequence capture. out_capacity is measured in floats. */
int pocket_llama_set_sequence_capture(
    pocket_llama * engine,
    size_t max_tokens,
    size_t max_bytes,
    char * err,
    size_t err_len);
int pocket_llama_copy_embedding_sequence(
    pocket_llama * engine,
    float * out,
    size_t out_capacity,
    size_t * token_count,
    size_t * embedding_dimension,
    char * err,
    size_t err_len);

void pocket_llama_free(pocket_llama * engine);

#ifdef __cplusplus
}
#endif
