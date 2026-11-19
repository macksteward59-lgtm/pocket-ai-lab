#include "pocket_llama.h"
#include "pocket_llama_pin.h"

#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <sys/stat.h>

#if POCKET_LLAMA_LINKED
#include "llama.h"
#include "gguf.h"
#endif

/*
 * Thin llama.cpp binding for the iOS engine.
 * Model text is untrusted. This file does not authorize anything.
 * A failed call leaves no successful output string.
 */

#if !POCKET_LLAMA_LINKED

int pocket_llama_linked(void) { return 0; }
const char * pocket_llama_pin_tag(void) { return POCKET_LLAMA_PIN_TAG; }
const char * pocket_llama_pin_commit(void) { return POCKET_LLAMA_PIN_COMMIT; }

int pocket_llama_probe(
    int * metal_backend_registered,
    int * metal_device_usable,
    int * gpu_device_count,
    char * version,
    size_t version_len,
    char * system_info,
    size_t system_info_len,
    char * metal_device_description,
    size_t metal_device_description_len) {
    if (metal_backend_registered) *metal_backend_registered = 0;
    if (metal_device_usable) *metal_device_usable = 0;
    if (gpu_device_count) *gpu_device_count = 0;
    if (version && version_len) version[0] = '\0';
    if (system_info && system_info_len) system_info[0] = '\0';
    if (metal_device_description && metal_device_description_len) metal_device_description[0] = '\0';
    return POCKET_LLAMA_ERR_NOT_LINKED;
}

int pocket_llama_load(
    const char * path,
    int32_t n_ctx,
    int32_t n_gpu_layers,
    pocket_llama ** out_engine,
    char * err,
    size_t err_len) {
    (void) path;
    (void) n_ctx;
    (void) n_gpu_layers;
    if (out_engine) *out_engine = NULL;
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}

int pocket_llama_inspect_gguf(
    const char * path,
    pocket_llama_metadata * out_metadata,
    char * err,
    size_t err_len) {
    (void) path;
    if (out_metadata) memset(out_metadata, 0, sizeof(*out_metadata));
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}

void pocket_llama_request_cancel(pocket_llama * engine) { (void) engine; }
void pocket_llama_offload(const pocket_llama * engine, int * requested, int * layers, int * total) {
    (void) engine;
    if (requested) *requested = 0;
    if (layers) *layers = -1;
    if (total) *total = -1;
}
int pocket_llama_generate(
    pocket_llama * engine,
    const char * prompt,
    int32_t max_tokens,
    float temperature,
    char * out,
    size_t out_len,
    char * err,
    size_t err_len) {
    (void) engine;
    (void) prompt;
    (void) max_tokens;
    (void) temperature;
    if (out && out_len) out[0] = '\0';
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}
int pocket_llama_copy_last_embedding(
    pocket_llama * engine,
    float * out,
    size_t out_capacity,
    size_t * out_count,
    char * err,
    size_t err_len) {
    (void) engine;
    (void) out;
    (void) out_capacity;
    if (out_count) *out_count = 0;
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}
int pocket_llama_set_embeddings(pocket_llama * engine, int enabled, char * err, size_t err_len) {
    (void) engine;
    (void) enabled;
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}
int pocket_llama_set_sequence_capture(pocket_llama * engine, size_t max_tokens, size_t max_bytes, char * err, size_t err_len) {
    (void) engine; (void) max_tokens; (void) max_bytes;
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}
int pocket_llama_copy_embedding_sequence(pocket_llama * engine, float * out, size_t out_capacity,
    size_t * token_count, size_t * embedding_dimension, char * err, size_t err_len) {
    (void) engine; (void) out; (void) out_capacity;
    if (token_count) *token_count = 0;
    if (embedding_dimension) *embedding_dimension = 0;
    if (err && err_len) snprintf(err, err_len, "llama.cpp is not linked in this build.");
    return POCKET_LLAMA_ERR_NOT_LINKED;
}

void pocket_llama_free(pocket_llama * engine) { (void) engine; }

#else

struct pocket_llama {
    struct llama_model * model;
    struct llama_context * ctx;
    int32_t n_ctx;
    int32_t requested_gpu_layers;
    int offloaded_layers;
    int offload_total;
    int capture_embeddings;
    int sequence_capture_enabled;
    size_t sequence_max_tokens;
    size_t sequence_max_bytes;
    size_t sequence_token_count;
    size_t sequence_embedding_dimension;
    float * sequence_embeddings;
    atomic_int cancel;
    pthread_mutex_t mu;
    int mu_ready;
};

static pthread_once_t g_once = PTHREAD_ONCE_INIT;
static pthread_mutex_t g_log_mu = PTHREAD_MUTEX_INITIALIZER;
static int * g_off_layers = NULL;
static int * g_off_total = NULL;
static char g_log_tail[640];
static int g_probe_ready = 0;
static int g_metal_registered = 0;
static int g_metal_usable = 0;
static int g_gpu_devices = 0;
static char g_version[192];
static char g_system_info[768];
static char g_metal_desc[256];

static int fail(char * err, size_t err_len, int code, const char * message) {
    if (err && err_len > 0) snprintf(err, err_len, "%s", message ? message : "llama.cpp failed.");
    return code;
}

static void copy_text(char * dst, size_t dst_len, const char * src) {
    if (!dst || dst_len == 0) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    snprintf(dst, dst_len, "%s", src);
}

static void note_offload_text(const char * text) {
    size_t incoming = strlen(text);
    size_t keep = sizeof(g_log_tail) - 1;
    size_t current = strlen(g_log_tail);
    if (incoming >= keep) {
        memcpy(g_log_tail, text + (incoming - keep), keep);
        g_log_tail[keep] = '\0';
    } else if (current + incoming > keep) {
        size_t drop = current + incoming - keep;
        memmove(g_log_tail, g_log_tail + drop, current - drop);
        memcpy(g_log_tail + (current - drop), text, incoming + 1);
    } else {
        memcpy(g_log_tail + current, text, incoming + 1);
    }
    const char * mark = strstr(g_log_tail, "offloaded ");
    if (!mark) return;
    int layers = 0;
    int total = 0;
    if (sscanf(mark, "offloaded %d/%d layers to GPU", &layers, &total) == 2) {
        if (g_off_layers) *g_off_layers = layers;
        if (g_off_total) *g_off_total = total;
    }
}

static void pocket_log(enum ggml_log_level level, const char * text, void * user_data) {
    (void) level;
    (void) user_data;
    if (!text) return;
    fputs(text, stderr);
    pthread_mutex_lock(&g_log_mu);
    note_offload_text(text);
    pthread_mutex_unlock(&g_log_mu);
}

static void pocket_init_backend(void) {
    llama_log_set(pocket_log, NULL);
    llama_backend_init();
    const char * version = llama_version();
    snprintf(
        g_version,
        sizeof(g_version),
        "%s commit %s",
        version ? version : "unknown",
        POCKET_LLAMA_PIN_COMMIT);
    const char * info = llama_print_system_info();
    copy_text(g_system_info, sizeof(g_system_info), info ? info : "");
}

static void ensure_backend(void) {
    pthread_once(&g_once, pocket_init_backend);
}

static int device_is_gpu(enum ggml_backend_dev_type type) {
    return type == GGML_BACKEND_DEVICE_TYPE_GPU || type == GGML_BACKEND_DEVICE_TYPE_IGPU;
}

static void refresh_probe(void) {
    ensure_backend();
    if (g_probe_ready) return;

    int registered = 0;
    int usable = 0;
    int gpus = 0;
    char description[256];
    description[0] = '\0';

    size_t count = ggml_backend_dev_count();
    for (size_t i = 0; i < count; i++) {
        ggml_backend_dev_t dev = ggml_backend_dev_get(i);
        if (!dev) continue;
        enum ggml_backend_dev_type type = ggml_backend_dev_type(dev);
        if (device_is_gpu(type)) gpus += 1;
        ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
        const char * reg_name = reg ? ggml_backend_reg_name(reg) : NULL;
        if (!reg_name || strcmp(reg_name, "MTL") != 0) continue;
        registered = 1;
        const char * desc = ggml_backend_dev_description(dev);
        if (!desc || desc[0] == '\0') continue;
        /* A named device still has to build a command queue and Metal library. */
        ggml_backend_t backend = ggml_backend_dev_init(dev, NULL);
        if (!backend) continue;
        ggml_backend_free(backend);
        usable = 1;
        copy_text(description, sizeof(description), desc);
        break;
    }

    g_metal_registered = registered;
    g_metal_usable = usable;
    g_gpu_devices = gpus;
    copy_text(g_metal_desc, sizeof(g_metal_desc), description);
    g_probe_ready = 1;
}

int pocket_llama_linked(void) { return 1; }
const char * pocket_llama_pin_tag(void) { return POCKET_LLAMA_PIN_TAG; }
const char * pocket_llama_pin_commit(void) { return POCKET_LLAMA_PIN_COMMIT; }

int pocket_llama_probe(
    int * metal_backend_registered,
    int * metal_device_usable,
    int * gpu_device_count,
    char * version,
    size_t version_len,
    char * system_info,
    size_t system_info_len,
    char * metal_device_description,
    size_t metal_device_description_len) {
    refresh_probe();
    if (metal_backend_registered) *metal_backend_registered = g_metal_registered;
    if (metal_device_usable) *metal_device_usable = g_metal_usable;
    if (gpu_device_count) *gpu_device_count = g_gpu_devices;
    copy_text(version, version_len, g_version);
    copy_text(system_info, system_info_len, g_system_info);
    copy_text(metal_device_description, metal_device_description_len, g_metal_desc);
    return POCKET_LLAMA_OK;
}

static bool should_abort(void * data) {
    pocket_llama * engine = data;
    if (!engine) return false;
    return atomic_load(&engine->cancel) != 0;
}

int pocket_llama_load(
    const char * path,
    int32_t n_ctx,
    int32_t n_gpu_layers,
    pocket_llama ** out_engine,
    char * err,
    size_t err_len) {
    if (out_engine) *out_engine = NULL;
    if (!path || path[0] == '\0' || n_ctx < 1 || n_ctx > 8192) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "The model path or context length was rejected.");
    }
    refresh_probe();

    pocket_llama * engine = calloc(1, sizeof(*engine));
    if (!engine) return fail(err, err_len, POCKET_LLAMA_ERR_CONTEXT, "The llama.cpp session could not be allocated.");
    engine->offloaded_layers = -1;
    engine->offload_total = -1;
    engine->requested_gpu_layers = n_gpu_layers;
    engine->n_ctx = n_ctx;
    atomic_store(&engine->cancel, 0);
    if (pthread_mutex_init(&engine->mu, NULL) != 0) {
        free(engine);
        return fail(err, err_len, POCKET_LLAMA_ERR_CONTEXT, "The llama.cpp session lock could not be created.");
    }
    engine->mu_ready = 1;

    struct llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = n_gpu_layers;

    pthread_mutex_lock(&g_log_mu);
    g_off_layers = &engine->offloaded_layers;
    g_off_total = &engine->offload_total;
    pthread_mutex_unlock(&g_log_mu);

    struct llama_model * model = llama_model_load_from_file(path, model_params);

    pthread_mutex_lock(&g_log_mu);
    g_off_layers = NULL;
    g_off_total = NULL;
    pthread_mutex_unlock(&g_log_mu);

    if (!model) {
        pocket_llama_free(engine);
        return fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "llama.cpp did not load the model. No session was created.");
    }

    struct llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx = (uint32_t) n_ctx;
    uint32_t batch = n_ctx < 512 ? (uint32_t) n_ctx : 512;
    ctx_params.n_batch = batch;
    ctx_params.n_ubatch = batch;
    // Prompt prefill is batched with embeddings disabled. Embedding capture is
    // enabled only for one-token decode steps, so one output row is sufficient.
    ctx_params.n_outputs_max = 1;
    ctx_params.n_outputs_max_per_seq = 1;
    ctx_params.abort_callback = should_abort;
    ctx_params.abort_callback_data = engine;

    struct llama_context * ctx = llama_init_from_model(model, ctx_params);
    if (!ctx) {
        llama_model_free(model);
        engine->model = NULL;
        pocket_llama_free(engine);
        return fail(err, err_len, POCKET_LLAMA_ERR_CONTEXT, "llama.cpp did not create a context. No session was created.");
    }

    engine->model = model;
    engine->ctx = ctx;
    if (out_engine) *out_engine = engine;
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

static int copy_metadata_string(
    const struct gguf_context * ctx,
    const char * key,
    char * output,
    size_t output_size) {
    int64_t id = gguf_find_key(ctx, key);
    if (id < 0) return 0;
    if (gguf_get_kv_type(ctx, id) != GGUF_TYPE_STRING) return -1;
    const char * value = gguf_get_val_str(ctx, id);
    if (!value) return -1;
    size_t length = strlen(value);
    if (length >= output_size) return -1;
    memcpy(output, value, length + 1);
    return 1;
}

static int read_metadata_integer(const struct gguf_context * ctx, const char * key, int64_t * value) {
    int64_t id = gguf_find_key(ctx, key);
    if (id < 0) return 0;
    switch (gguf_get_kv_type(ctx, id)) {
        case GGUF_TYPE_UINT8: *value = gguf_get_val_u8(ctx, id); return 1;
        case GGUF_TYPE_INT8: *value = gguf_get_val_i8(ctx, id); return 1;
        case GGUF_TYPE_UINT16: *value = gguf_get_val_u16(ctx, id); return 1;
        case GGUF_TYPE_INT16: *value = gguf_get_val_i16(ctx, id); return 1;
        case GGUF_TYPE_UINT32: *value = gguf_get_val_u32(ctx, id); return 1;
        case GGUF_TYPE_INT32: *value = gguf_get_val_i32(ctx, id); return 1;
        case GGUF_TYPE_UINT64: {
            uint64_t number = gguf_get_val_u64(ctx, id);
            if (number > INT64_MAX) return -1;
            *value = (int64_t) number;
            return 1;
        }
        case GGUF_TYPE_INT64: *value = gguf_get_val_i64(ctx, id); return 1;
        default: return -1;
    }
}

int pocket_llama_inspect_gguf(
    const char * path,
    pocket_llama_metadata * out_metadata,
    char * err,
    size_t err_len) {
    if (!out_metadata) return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "Metadata output is required.");
    memset(out_metadata, 0, sizeof(*out_metadata));
    if (!path || path[0] == '\0') return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "A model path is required.");

    struct stat info;
    if (stat(path, &info) != 0 || !S_ISREG(info.st_mode) || info.st_size <= 0) {
        return fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF path is not a readable regular file.");
    }
    /* Avoid feeding unbounded artifacts into metadata inspection. Large models remain supported up to this explicit ceiling. */
    const uint64_t max_file_bytes = UINT64_C(128) * 1024 * 1024 * 1024;
    if ((uint64_t) info.st_size > max_file_bytes) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "The GGUF file exceeds the metadata inspection size limit.");
    }

    struct gguf_init_params params = { .no_alloc = true, .ctx = NULL };
    struct gguf_context * ctx = gguf_init_from_file(path, params);
    if (!ctx) return fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The pinned GGUF parser rejected the model metadata.");

    int result = POCKET_LLAMA_OK;
    int64_t key_count = gguf_get_n_kv(ctx);
    if (key_count < 0 || key_count > 65536) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF metadata key count exceeds the supported bound.");
        goto cleanup;
    }
    uint32_t version = gguf_get_version(ctx);
    if (version < 2 || version > 3) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF version is outside the supported range.");
        goto cleanup;
    }
    out_metadata->metadata_key_count = (int32_t) key_count;
    out_metadata->gguf_version = (int32_t) version;
    out_metadata->file_size_bytes = (uint64_t) info.st_size;

    if (copy_metadata_string(ctx, "general.architecture", out_metadata->architecture,
                             sizeof(out_metadata->architecture)) != 1) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF architecture metadata is missing or invalid.");
        goto cleanup;
    }
    (void) copy_metadata_string(ctx, "general.name", out_metadata->model_name,
                                sizeof(out_metadata->model_name));
    (void) copy_metadata_string(ctx, "tokenizer.ggml.model", out_metadata->tokenizer_model,
                                sizeof(out_metadata->tokenizer_model));

    char context_key[POCKET_LLAMA_METADATA_ARCH_MAX + 32];
    int key_length = snprintf(context_key, sizeof(context_key), "%s.context_length", out_metadata->architecture);
    if (key_length <= 0 || (size_t) key_length >= sizeof(context_key)) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF architecture metadata is invalid.");
        goto cleanup;
    }
    int64_t number = 0;
    int found = read_metadata_integer(ctx, context_key, &number);
    if (found < 0 || (found == 1 && (number < 1 || number > 1048576))) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF training context metadata is invalid.");
        goto cleanup;
    }
    if (found == 1) {
        out_metadata->training_context_length = number;
        out_metadata->has_training_context = 1;
    }

    found = read_metadata_integer(ctx, "general.file_type", &number);
    if (found < 0) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF file type metadata is invalid.");
        goto cleanup;
    }
    if (found == 1) {
        if (number < 0 || number > INT32_MAX) {
            result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF file type value is out of range.");
            goto cleanup;
        }
        out_metadata->file_type = (int32_t) number;
        out_metadata->has_file_type = 1;
    }

    found = read_metadata_integer(ctx, "general.parameter_count", &number);
    if (found < 0 || (found == 1 && (number < 1 || number > INT64_C(1000000000000000)))) {
        result = fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "The GGUF parameter count metadata is invalid.");
        goto cleanup;
    }
    if (found == 1) {
        out_metadata->parameter_count = number;
        out_metadata->has_parameter_count = 1;
    }

cleanup:
    gguf_free(ctx);
    if (result == POCKET_LLAMA_OK && err && err_len) err[0] = '\0';
    return result;
}

void pocket_llama_request_cancel(pocket_llama * engine) {
    if (!engine) return;
    atomic_store(&engine->cancel, 1);
}

void pocket_llama_offload(const pocket_llama * engine, int * requested, int * layers, int * total) {
    if (!engine) {
        if (requested) *requested = 0;
        if (layers) *layers = -1;
        if (total) *total = -1;
        return;
    }
    if (requested) *requested = engine->requested_gpu_layers;
    if (layers) *layers = engine->offloaded_layers;
    if (total) *total = engine->offload_total;
}

static int decode_tokens(
    pocket_llama * engine,
    const llama_token * tokens,
    int32_t n_tokens,
    int32_t * position,
    char * err,
    size_t err_len) {
    if (n_tokens < 1) return POCKET_LLAMA_OK;
    if (atomic_load(&engine->cancel)) {
        return fail(err, err_len, POCKET_LLAMA_ERR_CANCELLED, "Generation was cancelled.");
    }
    struct llama_batch batch = llama_batch_init(n_tokens, 0, 1);
    if (!batch.token || !batch.pos || !batch.n_seq_id || !batch.seq_id || !batch.logits) {
        llama_batch_free(batch);
        return fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp could not allocate a batch.");
    }
    batch.n_tokens = n_tokens;
    for (int32_t i = 0; i < n_tokens; i++) {
        batch.token[i] = tokens[i];
        batch.pos[i] = *position + i;
        batch.n_seq_id[i] = 1;
        batch.seq_id[i][0] = 0;
        batch.logits[i] = (i == n_tokens - 1) ? 1 : 0;
    }
    int32_t rc = llama_decode(engine->ctx, batch);
    llama_batch_free(batch);
    if (rc == 2 || atomic_load(&engine->cancel)) {
        return fail(err, err_len, POCKET_LLAMA_ERR_CANCELLED, "Generation was cancelled.");
    }
    if (rc != 0) {
        return fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp decode failed. No text was returned.");
    }
    *position += n_tokens;
    return POCKET_LLAMA_OK;
}

static int append_piece(char * out, size_t out_len, size_t * used, const char * piece, int piece_len) {
    if (piece_len < 0) return POCKET_LLAMA_ERR_DECODE;
    if (*used + (size_t) piece_len + 1 > out_len) return POCKET_LLAMA_ERR_BUFFER;
    memcpy(out + *used, piece, (size_t) piece_len);
    *used += (size_t) piece_len;
    out[*used] = '\0';
    return POCKET_LLAMA_OK;
}

static int text_is_blank(const char * text) {
    if (!text) return 1;
    for (const unsigned char * cursor = (const unsigned char *) text; *cursor; cursor++) {
        if (*cursor != ' ' && *cursor != '\t' && *cursor != '\n' && *cursor != '\r') return 0;
    }
    return 1;
}

int pocket_llama_generate(
    pocket_llama * engine,
    const char * prompt,
    int32_t max_tokens,
    float temperature,
    char * out,
    size_t out_len,
    char * err,
    size_t err_len) {
    if (out && out_len) out[0] = '\0';
    if (!engine || !engine->ctx || !engine->model || !prompt || !out || out_len < 2) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "The generation arguments were rejected.");
    }
    if (max_tokens < 1 || max_tokens > 32768 || temperature < 0.0f || temperature > 2.0f) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "maxTokens or temperature was rejected.");
    }

    pthread_mutex_lock(&engine->mu);
    atomic_store(&engine->cancel, 0);
    engine->sequence_token_count = 0;
    if (engine->sequence_capture_enabled && (size_t) max_tokens > engine->sequence_max_tokens) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "Generation maxTokens exceeds the negotiated latent sequence bound.");
    }
    // A batched prompt prefill can contain hundreds of tokens. Capturing every
    // embedding would exceed the deliberately bounded one-row output buffer.
    // Capture is enabled only after prefill, for the one-token generation steps.
    llama_set_embeddings(engine->ctx, false);

    const struct llama_vocab * vocab = llama_model_get_vocab(engine->model);
    if (!vocab) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_MODEL, "llama.cpp did not expose a vocabulary.");
    }

    llama_memory_t memory = llama_get_memory(engine->ctx);
    if (memory) llama_memory_clear(memory, true);

    int32_t n_ctx = (int32_t) llama_n_ctx(engine->ctx);
    if (n_ctx < 2) n_ctx = engine->n_ctx;
    llama_token * tokens = calloc((size_t) n_ctx, sizeof(llama_token));
    if (!tokens) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_PROMPT, "The prompt could not be tokenized.");
    }

    int32_t prompt_len = (int32_t) strlen(prompt);
    int32_t n_prompt = llama_tokenize(vocab, prompt, prompt_len, tokens, n_ctx, true, true);
    if (n_prompt < 0) {
        free(tokens);
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_PROMPT, "The prompt does not fit in the context. No text was returned.");
    }
    if (n_prompt < 1 || n_prompt >= n_ctx) {
        free(tokens);
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_PROMPT, "The prompt does not fit in the context. No text was returned.");
    }

    int32_t position = 0;
    int32_t batch_limit = (int32_t) llama_n_batch(engine->ctx);
    if (batch_limit < 1) batch_limit = 512;
    int rc = POCKET_LLAMA_OK;
    for (int32_t offset = 0; offset < n_prompt; ) {
        int32_t chunk = n_prompt - offset;
        if (chunk > batch_limit) chunk = batch_limit;
        rc = decode_tokens(engine, tokens + offset, chunk, &position, err, err_len);
        if (rc != POCKET_LLAMA_OK) {
            free(tokens);
            pthread_mutex_unlock(&engine->mu);
            out[0] = '\0';
            return rc;
        }
        offset += chunk;
    }

    if (engine->capture_embeddings || engine->sequence_capture_enabled) {
        llama_set_embeddings(engine->ctx, true);
    }

    struct llama_sampler * sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (!sampler) {
        free(tokens);
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp did not create a sampler. No text was returned.");
    }
    if (temperature <= 0.0f) {
        llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(sampler, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(sampler, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }

    size_t used = 0;
    out[0] = '\0';
    int32_t room = n_ctx - n_prompt;
    if (max_tokens < room) room = max_tokens;
    for (int32_t step = 0; step < room; step++) {
        if (atomic_load(&engine->cancel)) {
            rc = fail(err, err_len, POCKET_LLAMA_ERR_CANCELLED, "Generation was cancelled.");
            break;
        }
        llama_token id = llama_sampler_sample(sampler, engine->ctx, -1);
        if (id == LLAMA_TOKEN_NULL || llama_vocab_is_eog(vocab, id)) break;

        char piece[256];
        int32_t piece_len = llama_token_to_piece(vocab, id, piece, (int32_t) sizeof(piece), 0, false);
        char * heap_piece = NULL;
        if (piece_len < 0) {
            int32_t need = -piece_len;
            if (need < 1 || need > 4096) {
                rc = fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp returned a token that could not be decoded.");
                break;
            }
            heap_piece = calloc((size_t) need, 1);
            if (!heap_piece) {
                rc = fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp returned a token that could not be decoded.");
                break;
            }
            piece_len = llama_token_to_piece(vocab, id, heap_piece, need, 0, false);
            if (piece_len < 0) {
                free(heap_piece);
                rc = fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp returned a token that could not be decoded.");
                break;
            }
            rc = append_piece(out, out_len, &used, heap_piece, piece_len);
            free(heap_piece);
        } else {
            rc = append_piece(out, out_len, &used, piece, piece_len);
        }
        if (rc != POCKET_LLAMA_OK) {
            fail(err, err_len, rc, "The generation did not fit in the output buffer. No text was returned.");
            break;
        }

        rc = decode_tokens(engine, &id, 1, &position, err, err_len);
        if (rc != POCKET_LLAMA_OK) break;
        if (engine->sequence_capture_enabled) {
            if (engine->sequence_token_count >= engine->sequence_max_tokens) {
                rc = fail(err, err_len, POCKET_LLAMA_ERR_BUFFER, "Latent sequence capture exceeded its negotiated token bound.");
                break;
            }
            float * row = llama_get_embeddings_ith(engine->ctx, -1);
            if (!row || engine->sequence_embedding_dimension == 0) {
                rc = fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp did not retain a generated-token embedding row.");
                break;
            }
            memcpy(
                engine->sequence_embeddings + engine->sequence_token_count * engine->sequence_embedding_dimension,
                row,
                engine->sequence_embedding_dimension * sizeof(float));
            engine->sequence_token_count += 1;
        }
    }

    llama_sampler_free(sampler);
    free(tokens);
    pthread_mutex_unlock(&engine->mu);

    if (rc != POCKET_LLAMA_OK) {
        out[0] = '\0';
        engine->sequence_token_count = 0;
        return rc;
    }
    if (text_is_blank(out)) {
        out[0] = '\0';
        engine->sequence_token_count = 0;
        return fail(err, err_len, POCKET_LLAMA_ERR_EMPTY, "llama.cpp returned empty text. No token was invented.");
    }
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

int pocket_llama_copy_last_embedding(
    pocket_llama * engine,
    float * out,
    size_t out_capacity,
    size_t * out_count,
    char * err,
    size_t err_len) {
    if (out_count) *out_count = 0;
    if (!engine || !engine->ctx || !engine->model || !out_count) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "The embedding export arguments were rejected.");
    }

    pthread_mutex_lock(&engine->mu);
    const size_t required = (size_t) llama_model_n_embd_out(engine->model);
    *out_count = required;
    if (required == 0) {
        *out_count = 0;
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "The model did not report an output embedding dimension.");
    }
    if (!out && out_capacity == 0) {
        pthread_mutex_unlock(&engine->mu);
        if (err && err_len) err[0] = '\0';
        return POCKET_LLAMA_OK;
    }
    if (!out || out_capacity < required) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_BUFFER, "The embedding output buffer is too small.");
    }

    float * embedding = llama_get_embeddings_ith(engine->ctx, -1);
    if (!embedding) {
        *out_count = 0;
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "llama.cpp did not retain a final-token output embedding.");
    }
    memcpy(out, embedding, required * sizeof(float));
    pthread_mutex_unlock(&engine->mu);
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

int pocket_llama_set_embeddings(pocket_llama * engine, int enabled, char * err, size_t err_len) {
    if (!engine || !engine->ctx || (enabled != 0 && enabled != 1)) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "The embedding capture toggle was rejected.");
    }
    pthread_mutex_lock(&engine->mu);
    // Defer the llama.cpp toggle until pocket_llama_generate has completed
    // batched prompt prefill. Enabling it before prefill can request one output
    // embedding per prompt token while n_outputs_max is intentionally one.
    engine->capture_embeddings = (enabled == 1);
    pthread_mutex_unlock(&engine->mu);
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

int pocket_llama_set_sequence_capture(
    pocket_llama * engine,
    size_t max_tokens,
    size_t max_bytes,
    char * err,
    size_t err_len) {
    if (!engine || !engine->ctx || !engine->model) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "A loaded engine is required for sequence capture.");
    }
    pthread_mutex_lock(&engine->mu);
    if (max_tokens == 0 && max_bytes == 0) {
        engine->sequence_capture_enabled = 0;
        engine->capture_embeddings = 0;
        engine->sequence_token_count = 0;
        engine->sequence_embedding_dimension = 0;
        engine->sequence_max_tokens = 0;
        engine->sequence_max_bytes = 0;
        free(engine->sequence_embeddings);
        engine->sequence_embeddings = NULL;
        pthread_mutex_unlock(&engine->mu);
        if (err && err_len) err[0] = '\0';
        return POCKET_LLAMA_OK;
    }
    if (max_tokens == 0 || max_tokens > 256 || max_bytes == 0 || max_bytes > 16U * 1024U * 1024U) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "Latent sequence bounds are outside the supported limits.");
    }
    const size_t dimension = (size_t) llama_model_n_embd_out(engine->model);
    if (dimension == 0 || dimension > 65536 || max_tokens > SIZE_MAX / dimension ||
        max_tokens * dimension > SIZE_MAX / sizeof(float)) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "Latent sequence dimensions overflow the supported allocation range.");
    }
    const size_t floats = max_tokens * dimension;
    const size_t bytes = floats * sizeof(float);
    if (bytes > max_bytes) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_BUFFER, "Latent sequence allocation exceeds the negotiated byte ceiling.");
    }
    float * buffer = calloc(floats, sizeof(float));
    if (!buffer) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_CONTEXT, "Latent sequence buffer allocation failed.");
    }
    free(engine->sequence_embeddings);
    engine->sequence_embeddings = buffer;
    engine->sequence_max_tokens = max_tokens;
    engine->sequence_max_bytes = max_bytes;
    engine->sequence_embedding_dimension = dimension;
    engine->sequence_token_count = 0;
    engine->sequence_capture_enabled = 1;
    engine->capture_embeddings = 1;
    pthread_mutex_unlock(&engine->mu);
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

int pocket_llama_copy_embedding_sequence(
    pocket_llama * engine,
    float * out,
    size_t out_capacity,
    size_t * token_count,
    size_t * embedding_dimension,
    char * err,
    size_t err_len) {
    if (token_count) *token_count = 0;
    if (embedding_dimension) *embedding_dimension = 0;
    if (!engine || !engine->ctx || !token_count || !embedding_dimension) {
        return fail(err, err_len, POCKET_LLAMA_ERR_ARGS, "Latent sequence output arguments were rejected.");
    }
    pthread_mutex_lock(&engine->mu);
    const size_t count = engine->sequence_token_count;
    const size_t dimension = engine->sequence_embedding_dimension;
    if (!engine->sequence_capture_enabled || !engine->sequence_embeddings || count == 0 || dimension == 0 ||
        count > SIZE_MAX / dimension || count * dimension > SIZE_MAX / sizeof(float)) {
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_DECODE, "No complete latent sequence is available.");
    }
    const size_t required = count * dimension;
    *token_count = count;
    *embedding_dimension = dimension;
    if (!out && out_capacity == 0) {
        pthread_mutex_unlock(&engine->mu);
        if (err && err_len) err[0] = '\0';
        return POCKET_LLAMA_OK;
    }
    if (!out || out_capacity < required) {
        *token_count = 0;
        *embedding_dimension = 0;
        pthread_mutex_unlock(&engine->mu);
        return fail(err, err_len, POCKET_LLAMA_ERR_BUFFER, "The latent sequence output buffer is too small.");
    }
    memcpy(out, engine->sequence_embeddings, required * sizeof(float));
    pthread_mutex_unlock(&engine->mu);
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

void pocket_llama_free(pocket_llama * engine) {
    if (!engine) return;
    atomic_store(&engine->cancel, 1);
    if (engine->mu_ready) pthread_mutex_lock(&engine->mu);
    free(engine->sequence_embeddings);
    engine->sequence_embeddings = NULL;
    if (engine->ctx) {
        llama_free(engine->ctx);
        engine->ctx = NULL;
    }
    if (engine->model) {
        llama_model_free(engine->model);
        engine->model = NULL;
    }
    if (engine->mu_ready) {
        pthread_mutex_unlock(&engine->mu);
        pthread_mutex_destroy(&engine->mu);
    }
    free(engine);
}

#endif
