#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Status codes. A non-zero code means no text was produced for the caller to treat as success. */
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

typedef struct pocket_llama pocket_llama;

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

void pocket_llama_request_cancel(pocket_llama * engine);

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

void pocket_llama_free(pocket_llama * engine);

#ifdef __cplusplus
}
#endif
