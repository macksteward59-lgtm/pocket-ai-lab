// Candidate-only vocabulary preflight. No inference context or tensor loading.
// The caller verifies complete model bytes before and after this process.
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "llama.h"
#include "pocket_llama_pin.h"
#include <fcntl.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

enum { MAX_BYTES = 4096, MAX_TOKENS = 2048, CASES = 8 };
static void hex(const char *s, size_t n) {
    putchar('"');
    for (size_t i = 0; i < n; ++i) printf("%02x", (unsigned char)s[i]);
    putchar('"');
}
static void log_stderr(enum ggml_log_level level, const char *s, void *u) {
    (void)level; (void)u;
    if (s) fputs(s, stderr);
}
static void ids(const llama_token *t, int32_t n) {
    putchar('[');
    for (int32_t i = 0; i < n; ++i) printf("%s%" PRId32, i ? "," : "", t[i]);
    putchar(']');
}
int main(int argc, char **argv) {
    if (argc != 3) { fputs("usage: tokenizer-probe MODEL PROMPT_DIRECTORY\n", stderr); return 2; }
    int directory = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (directory < 0) return 2;
    llama_log_set(log_stderr, NULL);
    llama_backend_init();
    struct llama_model_params params = llama_model_default_params();
    params.vocab_only = true;
    params.n_gpu_layers = 0;
    struct llama_model *model = llama_model_load_from_file(argv[1], params);
    if (!model) { close(directory); llama_backend_free(); return 1; }
    int result = 1;
    const struct llama_vocab *v = llama_model_get_vocab(model);
    if (!v || llama_vocab_n_tokens(v) != 151936) goto done;
    const char *chat = llama_model_chat_template(model, NULL);
    if (!chat || strnlen(chat, 16385) > 16384) goto done;
    printf("{\"recordType\":\"vocabulary\",\"pinTag\":\"%s\",\"pinCommit\":\"%s\","
           "\"vocabularySize\":%d,\"addBOS\":%s,\"addEOS\":%s,\"bosTokenId\":%d,\"eosTokenId\":%d,"
           "\"inferencePerformed\":false,\"contextCreated\":false,\"templateUTF8Hex\":",
           POCKET_LLAMA_PIN_TAG, POCKET_LLAMA_PIN_COMMIT, llama_vocab_n_tokens(v),
           llama_vocab_get_add_bos(v) ? "true" : "false", llama_vocab_get_add_eos(v) ? "true" : "false",
           llama_vocab_bos(v), llama_vocab_eos(v));
    hex(chat, strlen(chat));
    fputs(",\"markers\":[", stdout);
    const llama_token markers[] = {151646, 151643, 151644, 151645, 151648, 151649};
    for (int i = 0; i < 6; ++i) {
        const char *text = llama_vocab_get_text(v, markers[i]);
        char piece[128];
        int32_t n = llama_token_to_piece(v, markers[i], piece, sizeof(piece), 0, false);
        llama_token parsed[64];
        if (!text || n < 0 || n > (int32_t)sizeof(piece)) goto done;
        int32_t count = llama_tokenize(v, text, (int32_t)strlen(text), parsed, 64, false, true);
        if (count < 1 || count > 64) goto done;
        printf("%s{\"id\":%d,\"attributes\":%d,\"isEOG\":%s,\"spellingUTF8Hex\":",
               i ? "," : "", markers[i], (int)llama_vocab_get_attr(v, markers[i]),
               llama_vocab_is_eog(v, markers[i]) ? "true" : "false");
        hex(text, strlen(text));
        fputs(",\"pieceSpecialFalseUTF8Hex\":", stdout); hex(piece, (size_t)n);
        fputs(",\"isolatedTokenIDs\":", stdout); ids(parsed, count); putchar('}');
    }
    fputs("]}\n", stdout); fflush(stdout);
    for (int ordinal = 1; ordinal <= CASES; ++ordinal) {
        char name[16], prompt[MAX_BYTES + 1];
        snprintf(name, sizeof(name), "%03d.txt", ordinal);
        int fd = openat(directory, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
        if (fd < 0) goto done;
        struct stat st;
        bool valid = fstat(fd, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0 && st.st_size <= MAX_BYTES;
        FILE *file = fdopen(fd, "rb");
        if (!file) { close(fd); goto done; }
        size_t length = valid ? fread(prompt, 1, sizeof(prompt), file) : 0;
        valid = valid && !ferror(file) && length == (size_t)st.st_size && length <= MAX_BYTES && !memchr(prompt, 0, length);
        fclose(file);
        if (!valid) goto done;
        // Prepared inputs are verified UTF-8. Hex output retains their exact bytes.
        llama_token tokens[MAX_TOKENS];
        int32_t count = llama_tokenize(v, prompt, (int32_t)length, tokens, MAX_TOKENS, true, true);
        if (count <= 0 || count > MAX_TOKENS) goto done;
        for (int32_t t = 0; t < count; ++t) if (tokens[t] < 0 || tokens[t] >= llama_vocab_n_tokens(v)) goto done;
        char restored[16384];
        int32_t bytes = llama_detokenize(v, tokens, count, restored, sizeof(restored), false, true);
        if (bytes < 0 || bytes > (int32_t)sizeof(restored)) goto done;
        printf("{\"recordType\":\"prompt\",\"ordinal\":%d,\"addSpecial\":true,\"parseSpecial\":true,\"promptUTF8Hex\":", ordinal);
        hex(prompt, length);
        fputs(",\"tokenIDs\":", stdout); ids(tokens, count);
        fputs(",\"detokenizedUTF8Hex\":", stdout); hex(restored, (size_t)bytes);
        fputs("}\n", stdout); fflush(stdout);
    }
    result = 0;
done:
    llama_model_free(model);
    llama_backend_free();
    close(directory);
    if (result == 0) {
        puts("{\"recordType\":\"summary\",\"status\":\"completed\",\"cases\":8,\"inferencePerformed\":false}");
        if (fflush(stdout) || ferror(stdout)) return 1;
    } else fputs("Candidate vocabulary preflight failed; partial records are not acceptance.\n", stderr);
    return result;
}
