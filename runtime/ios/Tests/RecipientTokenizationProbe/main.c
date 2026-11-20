// Inspect the pinned vocabulary and frozen prompt tokenization without creating
// an inference context, loading model weights, or decoding/generating tokens.
// The companion runner verifies the model pin before and after this executable.
#if defined(__APPLE__) && !defined(_DARWIN_C_SOURCE)
// Darwin hides O_NOFOLLOW in strict POSIX mode unless its extensions are enabled.
// Keep the no-follow checks themselves unchanged.
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L

#include "llama.h"
#include "pocket_llama_pin.h"

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

enum {
    PROBE_MAX_PROMPTS = 72,
    PROBE_MAX_PROMPT_BYTES = 1024,
    PROBE_MAX_TOKENS = 4096,
    PROBE_MAX_DETOKENIZED_BYTES = 16384,
    PROBE_MAX_TEMPLATE_BYTES = 16384,
    PROBE_MAX_VOCABULARY = 1000000,
};

static void json_ascii(const char * bytes, size_t length) {
    putchar('"');
    for (size_t i = 0; i < length; ++i) {
        const unsigned char byte = (unsigned char) bytes[i];
        if (byte == '"' || byte == '\\') {
            putchar('\\');
            putchar((int) byte);
        } else if (byte < 0x20 || byte >= 0x7f) {
            printf("\\u%04x", (unsigned int) byte);
        } else {
            putchar((int) byte);
        }
    }
    putchar('"');
}

static void json_hex(const char * bytes, size_t length) {
    static const char digits[] = "0123456789abcdef";
    putchar('"');
    for (size_t i = 0; i < length; ++i) {
        const unsigned char byte = (unsigned char) bytes[i];
        putchar(digits[byte >> 4]);
        putchar(digits[byte & 15]);
    }
    putchar('"');
}

static void json_tokens(const llama_token * tokens, int32_t count) {
    putchar('[');
    for (int32_t i = 0; i < count; ++i) {
        if (i != 0) putchar(',');
        printf("%" PRId32, tokens[i]);
    }
    putchar(']');
}

static void emit_error(const char * stage, const char * message, int ordinal) {
    fputs("{\"recordType\":\"error\",\"stage\":", stdout);
    json_ascii(stage, strlen(stage));
    fputs(",\"message\":", stdout);
    json_ascii(message, strlen(message));
    printf(",\"ordinal\":%d,\"inferencePerformed\":false,\"contextCreated\":false}\n", ordinal);
    fflush(stdout);
    fprintf(stderr, "Recipient tokenization probe failed (%s, prompt %d): %s\n", stage, ordinal, message);
}

static void log_to_stderr(enum ggml_log_level level, const char * text, void * user_data) {
    (void) level;
    (void) user_data;
    if (text != NULL) fputs(text, stderr);
}

static bool valid_tokens(const llama_token * tokens, int32_t count, int32_t vocabulary_size) {
    if (count < 1 || count > PROBE_MAX_TOKENS) return false;
    for (int32_t i = 0; i < count; ++i) {
        if (tokens[i] < 0 || tokens[i] >= vocabulary_size) return false;
    }
    return true;
}

// Read one regular file through the already-open prompt directory. Read one
// extra byte so growth/truncation cannot silently become an accepted prefix.
static bool read_prompt(int directory, int ordinal, char * bytes, size_t * length) {
    char name[16];
    const int formatted = snprintf(name, sizeof(name), "%03d.txt", ordinal);
    if (formatted < 0 || (size_t) formatted >= sizeof(name)) return false;
    const int descriptor = openat(directory, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    if (descriptor < 0) return false;

    bool valid = false;
    struct stat metadata;
    if (fstat(descriptor, &metadata) != 0 || !S_ISREG(metadata.st_mode) ||
        metadata.st_size < 1 || metadata.st_size > PROBE_MAX_PROMPT_BYTES) goto finished;

    size_t used = 0;
    while (used < PROBE_MAX_PROMPT_BYTES + 1) {
        const ssize_t received = read(descriptor, bytes + used, PROBE_MAX_PROMPT_BYTES + 1 - used);
        if (received == 0) break;
        if (received < 0) {
            if (errno == EINTR) continue;
            goto finished;
        }
        used += (size_t) received;
    }
    if (used < 1 || used > PROBE_MAX_PROMPT_BYTES || (off_t) used != metadata.st_size) goto finished;
    for (size_t i = 0; i < used; ++i) {
        const unsigned char byte = (unsigned char) bytes[i];
        if (byte == 0 || byte > 0x7f) goto finished;
    }
    *length = used;
    valid = true;

finished:
    close(descriptor);
    return valid;
}

struct marker_observation {
    const char * spelling;
    llama_token id;
    int32_t attributes;
    bool is_eog;
    llama_token parsed[PROBE_MAX_TOKENS];
    int32_t parsed_count;
    llama_token literal[PROBE_MAX_TOKENS];
    int32_t literal_count;
};

static bool observe_marker(
    const struct llama_vocab * vocabulary,
    int32_t vocabulary_size,
    struct marker_observation * observation
) {
    observation->id = LLAMA_TOKEN_NULL;
    for (int32_t id = 0; id < vocabulary_size; ++id) {
        const char * spelling = llama_vocab_get_text(vocabulary, id);
        if (spelling != NULL && strcmp(spelling, observation->spelling) == 0) {
            if (observation->id != LLAMA_TOKEN_NULL) return false;
            observation->id = id;
        }
    }
    if (observation->id != LLAMA_TOKEN_NULL) {
        observation->attributes = (int32_t) llama_vocab_get_attr(vocabulary, observation->id);
        observation->is_eog = llama_vocab_is_eog(vocabulary, observation->id);
    }
    const size_t length = strlen(observation->spelling);
    observation->parsed_count = llama_tokenize(
        vocabulary, observation->spelling, (int32_t) length,
        observation->parsed, PROBE_MAX_TOKENS, false, true
    );
    observation->literal_count = llama_tokenize(
        vocabulary, observation->spelling, (int32_t) length,
        observation->literal, PROBE_MAX_TOKENS, false, false
    );
    return valid_tokens(observation->parsed, observation->parsed_count, vocabulary_size) &&
        valid_tokens(observation->literal, observation->literal_count, vocabulary_size);
}

static void emit_marker(const struct marker_observation * observation) {
    fputs("{\"spelling\":", stdout);
    json_ascii(observation->spelling, strlen(observation->spelling));
    if (observation->id == LLAMA_TOKEN_NULL) {
        fputs(",\"tokenID\":null,\"attributes\":null,\"isEOG\":null", stdout);
    } else {
        printf(",\"tokenID\":%" PRId32 ",\"attributes\":%" PRId32 ",\"isEOG\":%s",
            observation->id, observation->attributes, observation->is_eog ? "true" : "false");
    }
    fputs(",\"isolatedAddSpecial\":false,\"parseSpecialTrueTokenIDs\":", stdout);
    json_tokens(observation->parsed, observation->parsed_count);
    fputs(",\"parseSpecialFalseTokenIDs\":", stdout);
    json_tokens(observation->literal, observation->literal_count);
    putchar('}');
}

int main(int argc, char ** argv) {
    if (argc != 4) {
        fprintf(stderr, "usage: %s MODEL_GGUF PROMPT_DIRECTORY PROMPT_COUNT\n", argv[0]);
        return 2;
    }
    if (argv[3][0] == '\0') {
        fputs("Prompt count must be a decimal integer from 1 through 72.\n", stderr);
        return 2;
    }
    for (const char * next = argv[3]; *next != '\0'; ++next) {
        if (*next < '0' || *next > '9') {
            fputs("Prompt count must be a decimal integer from 1 through 72.\n", stderr);
            return 2;
        }
    }
    errno = 0;
    char * end = NULL;
    const long parsed_count = strtol(argv[3], &end, 10);
    if (errno != 0 || end == argv[3] || *end != '\0' || parsed_count < 1 || parsed_count > PROBE_MAX_PROMPTS) {
        fputs("Prompt count must be a decimal integer from 1 through 72.\n", stderr);
        return 2;
    }
    const int prompt_count = (int) parsed_count;
    printf("{\"recordType\":\"start\",\"schemaVersion\":1,\"mode\":\"vocab-only\","
           "\"inferencePerformed\":false,\"contextCreated\":false,\"requestedPromptCount\":%d,"
           "\"maximumPromptBytes\":%d,\"maximumTokens\":%d,\"llamaCppPinTag\":\"%s\","
           "\"llamaCppPinCommit\":\"%s\"}\n",
           prompt_count, PROBE_MAX_PROMPT_BYTES, PROBE_MAX_TOKENS,
           POCKET_LLAMA_PIN_TAG, POCKET_LLAMA_PIN_COMMIT);
    fflush(stdout);

    const int directory = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (directory < 0) {
        emit_error("prompt-directory", "The prompt directory could not be opened as a directory without a final symlink.", 0);
        return 1;
    }
    llama_log_set(log_to_stderr, NULL);
    llama_backend_init();
    struct llama_model_params parameters = llama_model_default_params();
    parameters.vocab_only = true;
    parameters.n_gpu_layers = 0;
    struct llama_model * model = llama_model_load_from_file(argv[1], parameters);
    if (model == NULL) {
        emit_error("model-load", "The model vocabulary could not be loaded.", 0);
        close(directory);
        llama_backend_free();
        return 1;
    }

    int result = 1;
    const struct llama_vocab * vocabulary = llama_model_get_vocab(model);
    if (vocabulary == NULL) {
        emit_error("vocabulary", "The loaded model did not expose a vocabulary.", 0);
        goto finished;
    }
    const int32_t vocabulary_size = llama_vocab_n_tokens(vocabulary);
    if (vocabulary_size < 1 || vocabulary_size > PROBE_MAX_VOCABULARY) {
        emit_error("vocabulary", "The vocabulary exceeds the supported token-count bounds.", 0);
        goto finished;
    }
    const char * model_template = llama_model_chat_template(model, NULL);
    if (model_template == NULL) {
        emit_error("template", "The vocabulary-only model did not expose a chat template.", 0);
        goto finished;
    }
    const size_t template_length = strnlen(model_template, PROBE_MAX_TEMPLATE_BYTES + 1);
    if (template_length < 1 || template_length > PROBE_MAX_TEMPLATE_BYTES) {
        emit_error("template", "The model chat template exceeds the supported byte bounds.", 0);
        goto finished;
    }
    struct marker_observation markers[3] = {
        { .spelling = "<|im_start|>" },
        { .spelling = "<|im_end|>" },
        { .spelling = "<|endoftext|>" },
    };
    for (size_t i = 0; i < sizeof(markers) / sizeof(markers[0]); ++i) {
        if (!observe_marker(vocabulary, vocabulary_size, &markers[i])) {
            emit_error("marker-tokenization", "A marker had ambiguous vocabulary entries or invalid/bounded tokenization.", 0);
            goto finished;
        }
    }
    printf("{\"recordType\":\"vocabulary\",\"vocabularySize\":%" PRId32 ","
           "\"effectiveAddBOS\":%s,\"effectiveAddEOS\":%s,\"bosTokenID\":%" PRId32 ","
           "\"eosTokenID\":%" PRId32 ",\"templateByteCount\":%zu,\"templateUTF8Hex\":",
           vocabulary_size, llama_vocab_get_add_bos(vocabulary) ? "true" : "false",
           llama_vocab_get_add_eos(vocabulary) ? "true" : "false",
           llama_vocab_bos(vocabulary), llama_vocab_eos(vocabulary), template_length);
    json_hex(model_template, template_length);
    fputs(",\"markers\":[", stdout);
    for (size_t i = 0; i < sizeof(markers) / sizeof(markers[0]); ++i) {
        if (i != 0) putchar(',');
        emit_marker(&markers[i]);
    }
    fputs("]}\n", stdout);
    fflush(stdout);

    for (int ordinal = 1; ordinal <= prompt_count; ++ordinal) {
        char prompt[PROBE_MAX_PROMPT_BYTES + 1];
        size_t prompt_length = 0;
        if (!read_prompt(directory, ordinal, prompt, &prompt_length)) {
            emit_error("prompt-read", "Expected a complete regular numbered prompt file with 1..1024 ASCII bytes and no NUL.", ordinal);
            goto finished;
        }
        llama_token tokens[PROBE_MAX_TOKENS];
        // These two true switches match pocket_llama_generate exactly. A
        // vocabulary-only probe is not an instrumented production invocation.
        const int32_t count = llama_tokenize(
            vocabulary, prompt, (int32_t) prompt_length, tokens, PROBE_MAX_TOKENS, true, true
        );
        if (!valid_tokens(tokens, count, vocabulary_size)) {
            emit_error("prompt-tokenization", "The prompt tokenization failed, exceeded the probe bound, or returned invalid IDs.", ordinal);
            goto finished;
        }
        char detokenized[PROBE_MAX_DETOKENIZED_BYTES];
        const int32_t detokenized_length = llama_detokenize(
            vocabulary, tokens, count, detokenized, PROBE_MAX_DETOKENIZED_BYTES, false, true
        );
        if (detokenized_length < 0 || detokenized_length > PROBE_MAX_DETOKENIZED_BYTES) {
            emit_error("prompt-detokenization", "Detokenization failed or exceeded the probe byte bound.", ordinal);
            goto finished;
        }
        printf("{\"recordType\":\"prompt\",\"ordinal\":%d,\"promptByteCount\":%zu,\"promptASCII\":",
            ordinal, prompt_length);
        json_ascii(prompt, prompt_length);
        printf(",\"addSpecial\":true,\"parseSpecial\":true,\"tokenCount\":%" PRId32 ",\"tokenIDs\":", count);
        json_tokens(tokens, count);
        printf(",\"detokenizeRemoveSpecial\":false,\"detokenizeUnparseSpecial\":true,"
               "\"detokenizedByteCount\":%" PRId32 ",\"detokenizedUTF8Hex\":", detokenized_length);
        json_hex(detokenized, (size_t) detokenized_length);
        fputs("}\n", stdout);
        fflush(stdout);
    }
    // Release the vocabulary before reporting completion. No llama_context,
    // decode, sampler, or generation API is used anywhere in this executable.
    result = 0;

finished:
    llama_model_free(model);
    llama_backend_free();
    close(directory);
    if (result == 0) {
        printf("{\"recordType\":\"summary\",\"status\":\"completed\",\"processedPromptCount\":%d,"
               "\"inferencePerformed\":false,\"contextCreated\":false}\n", prompt_count);
        if (fflush(stdout) != 0 || ferror(stdout)) return 1;
    }
    return result;
}
