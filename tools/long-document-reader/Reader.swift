import Foundation

struct Weights: Decodable {
    let version: Int
    let features: [String]
    let weights: [[Double]]
    let biases: [Double]
    let output: [Double]
    let intercept: Double
}

struct Question: Decodable { let id: String; let document: String; let question: String }
struct Corpus: Decodable { let documents: [String: [String]]; let questions: [Question] }
struct Prediction: Encodable { let id: String; let index: Int; let scores: [Double]; let milliseconds: Double }
struct Replay: Encodable { let platform: String; let os: String; let predictions: [Prediction] }
enum ReaderError: Error { case invalidModel, missingDocument, usage }

private let names = ["query_overlap","sentence_overlap","jaccard","character_overlap","bigram_overlap",
                     "quantity_question","numeric_evidence","quantity_match","overlap_margin","unmatched_share"]
private let stop = Set("a an the of in on to for and or by is are be was were has have does do can with from its it this that as at what which how may".components(separatedBy: " "))
private let quantity = try! NSRegularExpression(pattern: #"\b(how (many|much|long)|maximum|minimum|percentage|price|fee|rate|when|time)\b"#)
private let numeric = try! NSRegularExpression(pattern: #"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b"#)

private func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
    regex.firstMatch(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)) != nil
}

struct TextFeatures {
    let words: [String]
    let terms: Set<String>
    let grams: Set<String>
    let bigrams: Set<String>
    let hasNumber: Double

    init(_ text: String) {
        let lowered = text.lowercased()
        let tokens = lowered.utf8.split { b in
            !(97...122).contains(b) && !(48...57).contains(b)
        }.map { String(decoding: $0, as: UTF8.self) }.filter { !stop.contains($0) }
        words = tokens
        terms = Set(tokens)
        var grams = Set<String>()
        for term in terms {
            let bytes = Array(term.utf8)
            if bytes.count >= 3 {
                for i in 0...(bytes.count - 3) {
                    grams.insert(String(decoding: bytes[i..<(i+3)], as: UTF8.self))
                }
            }
        }
        self.grams = grams
        bigrams = Set(zip(tokens, tokens.dropFirst()).map { $0.0 + " " + $0.1 })
        hasNumber = matches(numeric, lowered) ? 1 : 0
    }
}

private func coverage(_ a: Set<String>, _ b: Set<String>) -> Double {
    Double(a.intersection(b).count) / Double(max(1, a.count))
}

struct DocumentReader {
    let model: Weights

    init(_ model: Weights) throws {
        let parameters = model.weights.flatMap { $0 } + model.biases + model.output + [model.intercept]
        guard model.version == 1, model.features == names, model.weights.count == 8,
              model.weights.allSatisfy({ $0.count == names.count }), model.biases.count == 8,
              model.output.count == 8, parameters.allSatisfy({ $0.isFinite }) else { throw ReaderError.invalidModel }
        self.model = model
    }

    func scores(_ question: String, in sentences: [TextFeatures]) -> [Double] {
        let q = TextFeatures(question)
        let countQuestion: Double = matches(quantity, question.lowercased()) ? 1 : 0
        let overlap = sentences.map { coverage(q.terms, $0.terms) }
        let best = overlap.max() ?? 0
        let winnerCount = overlap.filter { $0 == best }.count
        let second = overlap.filter { $0 < best }.max() ?? 0
        return sentences.enumerated().map { i, s in
            let shared = q.terms.intersection(s.terms).count
            let combined = q.terms.count + s.terms.count - shared
            let missing = q.words.filter { !s.terms.contains($0) }.count
            let competing = (overlap[i] == best && winnerCount == 1) ? second : best
            let x = [overlap[i], coverage(s.terms,q.terms), Double(shared)/Double(max(1,combined)),
                     coverage(q.grams,s.grams), coverage(q.bigrams,s.bigrams), countQuestion,
                     s.hasNumber, countQuestion*s.hasNumber, overlap[i]-competing, Double(missing)/Double(max(1,q.words.count))]
            var weighted = 0.0
            for j in model.weights.indices {
                var inner = 0.0
                for k in x.indices { inner += model.weights[j][k] * x[k] }
                weighted += model.output[j] * tanh(inner + model.biases[j])
            }
            return 1 / (1 + exp(-max(-40, min(40, weighted + model.intercept))))
        }
    }
}

func run() throws {
    guard CommandLine.arguments.count == 4 else { throw ReaderError.usage }
    let paths = CommandLine.arguments.dropFirst().map { URL(fileURLWithPath: $0) }
    let decoder = JSONDecoder()
    let reader = try DocumentReader(decoder.decode(Weights.self, from: Data(contentsOf: paths[0])))
    let corpus = try decoder.decode(Corpus.self, from: Data(contentsOf: paths[1]))
    let documents = corpus.documents.mapValues { $0.map(TextFeatures.init) }
    let rows: [Prediction] = try corpus.questions.map { q in
        guard let document = documents[q.document], !document.isEmpty else { throw ReaderError.missingDocument }
        let start = ProcessInfo.processInfo.systemUptime
        let scores = reader.scores(q.question, in: document)
        let best = scores.max() ?? 0
        let index = best > 0.5 ? scores.firstIndex(of: best)! : -1
        return Prediction(id: q.id, index: index, scores: scores,
                          milliseconds: (ProcessInfo.processInfo.systemUptime - start) * 1000)
    }
    #if os(iOS) && targetEnvironment(simulator)
    let platform = "iOS Simulator"
    #elseif os(iOS)
    let platform = "iOS device"
    #else
    let platform = "host"
    #endif
    let replay = Replay(platform: platform, os: ProcessInfo.processInfo.operatingSystemVersionString, predictions: rows)
    try JSONEncoder().encode(replay).write(to: paths[2], options: .atomic)
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("Reader replay failed: \(error)\n".utf8))
    exit(1)
}
