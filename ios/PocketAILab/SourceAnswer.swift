import Foundation

struct ProjectPassage: Codable, Equatable, Identifiable {
    let id: String
    let url: String
    let finding: String
}

struct ProjectPassages: Decodable {
    // The public register also used by apps/web/project-sources.mjs.
    static let revision = "a13f2314652f5243296acf8d8c4d74e0349eda1b"
    let sources: [ProjectPassage]

    static func bundled() throws -> Self {
        guard let url = Bundle.main.url(forResource: "project-sources", withExtension: "json") else {
            throw SourceAnswerError.catalog
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

enum SourceAnswerError: LocalizedError {
    case catalog, invalidFile, invalidQuote, conflict, stale, limit, modelRequired, noAnswer
    var errorDescription: String? {
        switch self {
        case .catalog: return "The reviewed source register could not be read."
        case .invalidFile: return "Choose a single cited answer exported by the project source-answer tool."
        case .invalidQuote: return "Enter an exact excerpt from the cited passage."
        case .conflict: return "A different draft already uses this request ID."
        case .stale: return "The saved answer changed. Reopen it before making a correction."
        case .limit: return "This answer has reached its revision limit."
        case .modelRequired: return "Load a model in Local AI to ask a new question."
        case .noAnswer: return "The model returned no usable excerpt from the selected passage."
        }
    }
}

struct SourceAnswerDraft: Codable, Equatable {
    enum Origin: String, Codable { case imported, localRuntime }
    let question: String
    let requestID: String
    let registerRevision: String
    let model: String
    let modelSHA256: String
    let passage: ProjectPassage
    let excerpt: String
    let origin: Origin

    var valid: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && question.utf8.count <= 1200 &&
        !question.contains(where: { $0.isNewline }) && !requestID.isEmpty && requestID.utf8.count <= 128 &&
        requestID.utf8.allSatisfy { (33...126).contains($0) } &&
        registerRevision.utf8.count == 40 && !model.isEmpty && model.utf8.count <= 512 &&
        modelSHA256.utf8.count == 64 && modelSHA256.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } &&
        !excerpt.isEmpty && passage.finding.contains(excerpt) && !passage.id.isEmpty &&
        passage.url.hasPrefix("https://") && passage.url.utf8.count <= 512
    }

    private struct Packet: Decodable {
        let question, requestID, registerRevision, model, modelSHA256: String
        let status, answer, source, sourceURL, rawOutput: String
        let retrieved: [ProjectPassage]
        let semanticSupportVerified: Bool
    }

    static func imported(_ data: Data, from catalog: ProjectPassages) throws -> Self {
        guard data.count <= 64 * 1024, let p = try? JSONDecoder().decode(Packet.self, from: data),
              p.status == "quote_proposed", !p.semanticSupportVerified, p.registerRevision == ProjectPassages.revision,
              (1...2).contains(p.retrieved.count), Set(p.retrieved.map(\.id)).count == p.retrieved.count,
              p.retrieved.allSatisfy({ catalog.sources.contains($0) }),
              let i = p.retrieved.firstIndex(where: { $0.id == p.source }),
              p.sourceURL == p.retrieved[i].url, p.rawOutput == p.answer + (i == 0 ? " [A]" : " [B]") else {
            throw SourceAnswerError.invalidFile
        }
        let draft = Self(question: p.question, requestID: p.requestID, registerRevision: p.registerRevision,
                         model: p.model, modelSHA256: p.modelSHA256, passage: p.retrieved[i], excerpt: p.answer, origin: .imported)
        guard draft.valid else { throw SourceAnswerError.invalidFile }
        return draft
    }
}

struct SavedSourceAnswer: Codable, Equatable {
    struct Correction: Codable, Equatable {
        let excerpt: String
        let date: Date
    }
    let draft: SourceAnswerDraft
    var corrections: [Correction] = []
    var current: String { corrections.last?.excerpt ?? draft.excerpt }
}
