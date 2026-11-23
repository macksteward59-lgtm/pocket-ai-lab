// Browser implementation of the v1 sentence selector in tools/public-source-distillation/student.py.
const FEATURES = ["query_overlap", "sentence_overlap", "jaccard", "character_overlap", "bigram_overlap",
  "quantity_question", "numeric_evidence", "quantity_match", "overlap_margin", "unmatched_share"];
const STOP = new Set("a an the of in on to for and or by is are be was were has have does do can with from its it this that as at what which how may".split(" "));
const WIDTH = 8;
export const recipe = "verified-reader-distillation-v1";

export function readWeights(raw) {
  const scalar = x => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e6;
  const vector = (row, n) => Array.isArray(row) && row.length === n && row.every(scalar);
  if (raw?.version !== 1 || JSON.stringify(raw.features) !== JSON.stringify(FEATURES) ||
      !Array.isArray(raw.weights) || raw.weights.length !== WIDTH ||
      !raw.weights.every(row => vector(row, FEATURES.length)) || !vector(raw.biases, WIDTH) ||
      !vector(raw.output, WIDTH) || !scalar(raw.intercept)) {
    throw Error("Choose a v1 document-reader JSON with compatible, finite weights.");
  }
  return { version: 1, features: [...FEATURES], weights: raw.weights.map(row => [...row]),
    biases: [...raw.biases], output: [...raw.output], intercept: raw.intercept };
}

function words(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => !STOP.has(w));
}
function common(a, b) {
  let count = 0;
  for (const x of a) if (b.has(x)) count++;
  return count;
}
function grams(terms) {
  const result = new Set();
  for (const word of terms) {
    for (let i = 0; i < word.length - 2; i++) result.add(word.slice(i, i + 3));
  }
  return result;
}
function bigrams(tokens) {
  return new Set(tokens.slice(1).map((w, i) => tokens[i] + " " + w));
}
export function features(question, sentences) {
  const q = words(question), terms = new Set(q), chars = grams(terms), pairs = bigrams(q);
  const quantity = Number(/\b(how (many|much|long)|maximum|minimum|percentage|price|fee|rate|when|time)\b/i.test(question));
  const spans = sentences.map(words);
  const sets = spans.map(span => new Set(span));
  const overlaps = sets.map(set => common(terms, set) / Math.max(1, terms.size));
  return sets.map((set, i) => {
    const shared = common(terms, set);
    const number = Number(/\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(sentences[i]));
    const rival = Math.max(0, ...overlaps.filter((_, j) => j !== i));
    return [overlaps[i], shared / Math.max(1, set.size), shared / Math.max(1, set.size + terms.size - shared),
      common(chars, grams(set)) / Math.max(1, chars.size), common(pairs, bigrams(spans[i])) / Math.max(1, pairs.size),
      quantity, number, quantity * number, overlaps[i] - rival, q.filter(w => !set.has(w)).length / Math.max(1, q.length)];
  });
}

function dot(a, b) {
  return a.reduce((sum, value, i) => sum + value * b[i], 0);
}
export function forward(model, row) {
  const hidden = model.weights.map((w, i) => Math.tanh(dot(w, row) + model.biases[i]));
  const logit = dot(model.output, hidden) + model.intercept;
  return { hidden, score: 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, logit)))) };
}
export function pick(model, rows) {
  let index = -1, high = 0.5;
  rows.forEach((row, i) => {
    const { score } = forward(model, row);
    if (score > high) { high = score; index = i; }
  });
  return index;
}
export function evaluate(model, documents) {
  let correct = 0, total = 0;
  for (const { sentences, questions } of documents) {
    for (const [question, gold] of questions) {
      total++;
      if (pick(model, features(question, sentences)) === gold) correct++;
    }
  }
  return { correct, total };
}

export function train(base, teacher, training) {
  const candidate = readWeights(base);
  const pairs = [];
  let positives = 0;
  for (const { sentences, questions } of training) {
    for (const [question, gold] of questions) {
      for (const [i, row] of features(question, sentences).entries()) {
        const target = forward(teacher, row).score;
        if ((target > 0.5) === (i === gold)) {
          pairs.push({ row, target });
          if (i === gold) positives++;
        }
      }
    }
  }
  if (!positives || positives === pairs.length) throw Error("The teacher needs verified examples of both supported and missing evidence.");
  // Fixed seed and schedule so retrying the same build reproduces its result.
  let seed = 923;
  for (let epoch = 0; epoch < 24; epoch++) {
    for (let i = pairs.length - 1; i > 0; i--) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const j = Math.floor((seed / 4294967296) * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    const rate = 0.02 / (1 + epoch / 12);
    for (const { row, target } of pairs) {
      const { hidden, score } = forward(candidate, row);
      const error = score - target;
      for (let j = 0; j < WIDTH; j++) {
        const dh = error * candidate.output[j] * (1 - hidden[j] ** 2);
        const unit = candidate.weights[j];
        for (let k = 0; k < unit.length; k++) unit[k] -= rate * (dh * row[k] + 0.001 * unit[k]);
        candidate.biases[j] -= rate * dh;
        candidate.output[j] -= rate * (error * hidden[j] + 0.001 * candidate.output[j]);
      }
      candidate.intercept -= rate * error;
    }
  }
  return { weights: readWeights(candidate), verifiedPairs: pairs.length };
}
