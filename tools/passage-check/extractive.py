"""Generate a small grammar from labeled passages, without reading the answer key."""
import json
import re

WORD_LIMIT = 64
SPAN_LIMIT = 8


def passage_grammar(prompt):
    lines = prompt.splitlines()
    passages = [line for line in lines if line.startswith(("[A] ", "[B] "))]
    if len(passages) != 2 or [line[:3] for line in passages] != ["[A]", "[B]"]:
        raise ValueError("Expected two labeled passages in source order")
    return labeled_grammar(passages)


def labeled_grammar(passages):
    outputs = {"UNKNOWN"}
    for line in passages:
        label, source = line.split(" ", 1)
        words = list(re.finditer(r"\S+", source))
        if not 1 <= len(words) <= WORD_LIMIT:
            raise ValueError("Passage size exceeds the bounded extractive test")
        for start in range(len(words)):
            for end in range(start, min(len(words), start + SPAN_LIMIT)):
                span = source[words[start].start():words[end].end()]
                # Terminal sentence punctuation is optional for a quoted short answer.
                for value in (span, span.rstrip(".,;:!?")):
                    if value:
                        outputs.add(f"{value} {label}")
    return "root ::= " + " | ".join(json.dumps(value, ensure_ascii=False) for value in sorted(outputs)) + "\n"
