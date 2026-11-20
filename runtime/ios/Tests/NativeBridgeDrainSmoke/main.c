/*
 * Deterministic completion-boundary test for the actual production C bridge.
 *
 * The llama declarations come from the verified pinned public headers. The
 * implementations below are an explicit fixture backend, not llama.cpp model
 * execution. Unused model-loading/probe functions are discarded by the linker.
 * Including the production source avoids copying either its private engine
 * layout or its generation/cleanup implementation into this test.
 */
#include "../../Sources/LlamaCppBridge/pocket_llama.c"

struct llama_model { int fixture_tag; };
struct llama_context { int fixture_tag; };
struct llama_vocab { int fixture_tag; };
struct llama_memory_i { int fixture_tag; };

static struct llama_model fixture_model;
static struct llama_context fixture_context;
static struct llama_vocab fixture_vocab;
static struct llama_memory_i fixture_memory;

static struct {
    const char * name;
    pocket_llama * engine;
    int final_decode_rc;
    int cancel_during_final_sync;
    int decode_calls;
    int outstanding_decode;
    int final_drains;
    int memory_clears;
    int clears_with_outstanding_work;
    int batches_allocated;
    int batches_freed;
    int live_samplers;
    int failures;
} fixture;

static int total_failures;
static int cases_run;

static void check(int condition, const char * expression, int line) {
    if (condition) return;
    fprintf(stderr, "FAIL case=%s line=%d check=%s\n", fixture.name, line, expression);
    fixture.failures++;
    total_failures++;
}

#define CHECK(expression) check((expression), #expression, __LINE__)

static void * fixture_calloc(size_t count, size_t size) {
    void * allocation = calloc(count, size);
    if (!allocation) {
        fputs("Fixture allocation failed.\n", stderr);
        exit(2);
    }
    return allocation;
}

/* These definitions intentionally use the exact pinned public declarations. */
const struct llama_vocab * llama_model_get_vocab(const struct llama_model * model) {
    CHECK(model == &fixture_model);
    return &fixture_vocab;
}

uint32_t llama_n_ctx(const struct llama_context * ctx) {
    CHECK(ctx == &fixture_context);
    return 8;
}

uint32_t llama_n_batch(const struct llama_context * ctx) {
    CHECK(ctx == &fixture_context);
    return 8;
}

llama_memory_t llama_get_memory(const struct llama_context * ctx) {
    CHECK(ctx == &fixture_context);
    return &fixture_memory;
}

void llama_memory_clear(llama_memory_t memory, bool data) {
    CHECK(memory == &fixture_memory);
    CHECK(data);
    fixture.memory_clears++;
    if (fixture.outstanding_decode) fixture.clears_with_outstanding_work++;
    CHECK(fixture.outstanding_decode == 0);
    /* Clearing memory does not drain the fixture's queued computation. */
}

void llama_set_embeddings(struct llama_context * ctx, bool enabled) {
    CHECK(ctx == &fixture_context);
    CHECK(!enabled);
}

int32_t llama_tokenize(const struct llama_vocab * vocab, const char * text,
                       int32_t text_len, llama_token * tokens, int32_t capacity,
                       bool add_special, bool parse_special) {
    CHECK(vocab == &fixture_vocab);
    CHECK(text && text_len == 1 && text[0] == 'P');
    CHECK(capacity >= 1);
    CHECK(add_special && parse_special);
    tokens[0] = 17;
    return 1;
}

struct llama_batch llama_batch_init(int32_t token_count, int32_t embedding_width,
                                    int32_t max_sequences) {
    CHECK(token_count == 1 && embedding_width == 0 && max_sequences == 1);
    struct llama_batch batch = {0};
    batch.n_tokens = token_count;
    batch.token = fixture_calloc((size_t) token_count, sizeof(*batch.token));
    batch.pos = fixture_calloc((size_t) token_count, sizeof(*batch.pos));
    batch.n_seq_id = fixture_calloc((size_t) token_count, sizeof(*batch.n_seq_id));
    batch.seq_id = fixture_calloc((size_t) token_count, sizeof(*batch.seq_id));
    batch.logits = fixture_calloc((size_t) token_count, sizeof(*batch.logits));
    for (int32_t i = 0; i < token_count; i++) {
        batch.seq_id[i] = fixture_calloc(1, sizeof(*batch.seq_id[i]));
    }
    fixture.batches_allocated++;
    return batch;
}

void llama_batch_free(struct llama_batch batch) {
    for (int32_t i = 0; i < batch.n_tokens; i++) free(batch.seq_id[i]);
    free(batch.token);
    free(batch.embd);
    free(batch.pos);
    free(batch.n_seq_id);
    free(batch.seq_id);
    free(batch.logits);
    fixture.batches_freed++;
}

int32_t llama_decode(struct llama_context * ctx, struct llama_batch batch) {
    CHECK(ctx == &fixture_context);
    CHECK(fixture.outstanding_decode == 0);
    fixture.decode_calls++;
    const int final_token = fixture.decode_calls % 2 == 0;
    CHECK(batch.n_tokens == 1);
    CHECK(batch.token[0] == (final_token ? 42 : 17));
    CHECK(batch.pos[0] == (final_token ? 1 : 0));
    CHECK(batch.n_seq_id[0] == 1 && batch.seq_id[0][0] == 0);
    CHECK(batch.logits[0] == 1);
    /* Errors and aborts may also leave submitted work requiring a drain. */
    fixture.outstanding_decode = fixture.decode_calls;
    return final_token ? fixture.final_decode_rc : 0;
}

void llama_synchronize(struct llama_context * ctx) {
    CHECK(ctx == &fixture_context);
    const int completed_decode = fixture.outstanding_decode;
    fixture.outstanding_decode = 0;
    if (completed_decode > 0 && completed_decode % 2 == 0) {
        fixture.final_drains++;
        if (fixture.cancel_during_final_sync) {
            /* Use the real bridge cancellation entry point during the drain. */
            pocket_llama_request_cancel(fixture.engine);
        }
    }
}

struct llama_sampler_chain_params llama_sampler_chain_default_params(void) {
    return (struct llama_sampler_chain_params) { .no_perf = true };
}

struct llama_sampler * llama_sampler_chain_init(struct llama_sampler_chain_params params) {
    (void) params;
    fixture.live_samplers++;
    return fixture_calloc(1, sizeof(struct llama_sampler));
}

struct llama_sampler * llama_sampler_init_greedy(void) {
    fixture.live_samplers++;
    return fixture_calloc(1, sizeof(struct llama_sampler));
}

void llama_sampler_chain_add(struct llama_sampler * chain, struct llama_sampler * sampler) {
    CHECK(chain && sampler && chain->ctx == NULL);
    chain->ctx = sampler;
}

llama_token llama_sampler_sample(struct llama_sampler * sampler, struct llama_context * ctx,
                                 int32_t index) {
    CHECK(sampler && sampler->ctx && index == -1);
    /* Real sampling obtains logits, which synchronizes the prompt prefill.
     * There is deliberately no sampler/getter after the final-token decode. */
    llama_synchronize(ctx);
    return 42;
}

void llama_sampler_free(struct llama_sampler * sampler) {
    CHECK(sampler && sampler->ctx);
    free(sampler->ctx);
    free(sampler);
    fixture.live_samplers -= 2;
}

bool llama_vocab_is_eog(const struct llama_vocab * vocab, llama_token token) {
    CHECK(vocab == &fixture_vocab && token == 42);
    return false;
}

int32_t llama_token_to_piece(const struct llama_vocab * vocab, llama_token token,
                            char * output, int32_t capacity, int32_t lstrip, bool special) {
    CHECK(vocab == &fixture_vocab && token == 42);
    CHECK(capacity >= 1 && lstrip == 0 && !special);
    output[0] = 'X';
    return 1;
}

/* These branches remain linkable, but are outside this greedy-text fixture. */
struct llama_sampler * llama_sampler_init_temp(float temperature) {
    (void) temperature;
    CHECK(0 && "unexpected temperature sampler");
    return NULL;
}

struct llama_sampler * llama_sampler_init_dist(uint32_t seed) {
    (void) seed;
    CHECK(0 && "unexpected distribution sampler");
    return NULL;
}

float * llama_get_embeddings_ith(struct llama_context * ctx, int32_t index) {
    (void) ctx;
    (void) index;
    CHECK(0 && "unexpected embedding getter would mask missing drain");
    return NULL;
}

static void run_case(const char * name, int decode_rc, int cancel_during_sync,
                     int expected_rc, int repetitions) {
    memset(&fixture, 0, sizeof(fixture));
    fixture.name = name;
    fixture.final_decode_rc = decode_rc;
    fixture.cancel_during_final_sync = cancel_during_sync;

    pocket_llama engine = {0};
    engine.model = &fixture_model;
    engine.ctx = &fixture_context;
    engine.n_ctx = 8;
    atomic_init(&engine.cancel, 0);
    if (pthread_mutex_init(&engine.mu, NULL) != 0) {
        fputs("Fixture mutex initialization failed.\n", stderr);
        exit(2);
    }
    engine.mu_ready = 1;
    fixture.engine = &engine;

    for (int iteration = 1; iteration <= repetitions; iteration++) {
        char output[16] = "old-output";
        char error[160] = "old-error";
        const int rc = pocket_llama_generate(
            &engine, "P", 1, 0.0f, output, sizeof(output), error, sizeof(error));
        CHECK(rc == expected_rc);
        CHECK(fixture.decode_calls == iteration * 2);
        CHECK(fixture.outstanding_decode == 0);
        CHECK(fixture.final_drains == iteration);
        CHECK(fixture.batches_allocated == fixture.batches_freed);
        CHECK(fixture.live_samplers == 0);
        CHECK(fixture.clears_with_outstanding_work == 0);
        if (expected_rc == POCKET_LLAMA_OK) {
            CHECK(strcmp(output, "X") == 0);
            CHECK(error[0] == '\0');
        } else {
            CHECK(output[0] == '\0');
            CHECK(error[0] != '\0');
        }
        if (cancel_during_sync) CHECK(atomic_load(&engine.cancel) == 1);
    }

    CHECK(fixture.memory_clears == repetitions);
    CHECK(pthread_mutex_destroy(&engine.mu) == 0);
    cases_run++;
    printf("POCKET_LLAMA_BRIDGE_DRAIN_CASE backend=fixture case=%s result=%s "
           "generations=%d decodes=%d finalDrains=%d outstanding=%d failures=%d\n",
           name, fixture.failures ? "failed" : "passed", repetitions,
           fixture.decode_calls, fixture.final_drains, fixture.outstanding_decode,
           fixture.failures);
}

int main(void) {
    /* The second success request also checks its memory reset sees no old work. */
    run_case("success-and-next-reset", 0, 0, POCKET_LLAMA_OK, 2);
    run_case("aborted-final-decode", 2, 0, POCKET_LLAMA_ERR_CANCELLED, 1);
    /* The pinned public API reserves values below -1 for fatal decode errors. */
    run_case("failed-final-decode", -2, 0, POCKET_LLAMA_ERR_DECODE, 1);
    run_case("cancellation-during-drain", 0, 1, POCKET_LLAMA_ERR_CANCELLED, 1);
    if (cases_run != 4) {
        fputs("Not all required bridge drain cases executed.\n", stderr);
        total_failures++;
    }
    printf("POCKET_LLAMA_BRIDGE_DRAIN backend=fixture cases=%d failures=%d "
           "realModelExecution=false\n", cases_run, total_failures);
    return total_failures == 0 ? 0 : 1;
}
