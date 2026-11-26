#include "pocket_llama.h"
#include "pocket_llama_pin.h"

#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

#if POCKET_LLAMA_LINKED
#include "llama.h"
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
void pocket_llama_free(pocket_llama * engine) { (void) engine; }

#else

struct pocket_llama {
    struct llama_model * model;
    struct llama_context * ctx;
    int32_t n_ctx;
    int32_t requested_gpu_layers;
    int offloaded_layers;
    int offload_total;
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
    }

    llama_sampler_free(sampler);
    free(tokens);
    pthread_mutex_unlock(&engine->mu);

    if (rc != POCKET_LLAMA_OK) {
        out[0] = '\0';
        return rc;
    }
    if (text_is_blank(out)) {
        out[0] = '\0';
        return fail(err, err_len, POCKET_LLAMA_ERR_EMPTY, "llama.cpp returned empty text. No token was invented.");
    }
    if (err && err_len) err[0] = '\0';
    return POCKET_LLAMA_OK;
}

void pocket_llama_free(pocket_llama * engine) {
    if (!engine) return;
    atomic_store(&engine->cancel, 1);
    if (engine->mu_ready) pthread_mutex_lock(&engine->mu);
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
