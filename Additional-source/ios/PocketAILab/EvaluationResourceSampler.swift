import Darwin
import Foundation
import os

/// App-process readings during one generation request. Optional values mean the OS supplied no reading.
struct EvaluationResourceReading {
    let footprintBytes: UInt64?
    let headroomBytes: UInt64?
    let thermalState: EvaluationThermalState?
    let lowPowerMode: Bool

    static func current() -> Self {
        let process = ProcessInfo.processInfo
        let thermal: EvaluationThermalState?
        switch process.thermalState {
        case .nominal: thermal = .nominal
        case .fair: thermal = .fair
        case .serious: thermal = .serious
        case .critical: thermal = .critical
        @unknown default: thermal = nil
        }
        #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
        // Zero can mean the app has exceeded its limit. Preserve the value returned by the OS.
        let headroom: UInt64? = UInt64(os_proc_available_memory())
        #else
        let headroom: UInt64? = nil
        #endif
        var info = task_vm_info_data_t()
        let capacity = MemoryLayout<task_vm_info_data_t>.stride / MemoryLayout<integer_t>.stride
        var count = mach_msg_type_number_t(capacity)
        let status = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: capacity) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        // Earlier Mach task_info revisions do not return the phys_footprint field.
        let offset = MemoryLayout<task_vm_info_data_t>.offset(of: \.phys_footprint)
        let returnedBytes = Int(count) * MemoryLayout<integer_t>.stride
        let footprint: UInt64? = offset.flatMap {
            status == KERN_SUCCESS && returnedBytes >= $0 + MemoryLayout<UInt64>.size ? info.phys_footprint : nil
        }
        return Self(footprintBytes: footprint, headroomBytes: headroom, thermalState: thermal,
                    lowPowerMode: process.isLowPowerModeEnabled)
    }
}

enum EvaluationThermalState: String, Codable, CaseIterable, Sendable {
    case nominal, fair, serious, critical

    var severity: Int {
        switch self {
        case .nominal: return 0
        case .fair: return 1
        case .serious: return 2
        case .critical: return 3
        }
    }
}

struct EvaluationResourceSamples: Codable, Equatable, Sendable {
    enum Environment: String, Codable, Sendable {
        case iosDevice, iosSimulator, macOS

        static var current: Self {
            #if targetEnvironment(simulator)
            return .iosSimulator
            #elseif os(iOS) && !targetEnvironment(macCatalyst)
            return .iosDevice
            #else
            return .macOS
            #endif
        }
    }

    let environment: Environment
    let osVersion: String
    let intervalMilliseconds: Int
    private(set) var sampleCount = 0
    private(set) var maxObservedFootprintBytes: UInt64?
    private(set) var minObservedHeadroomBytes: UInt64?
    private(set) var worstObservedThermalState: EvaluationThermalState?
    private(set) var lowPowerModeObserved = false

    init() {
        environment = .current
        osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        intervalMilliseconds = 250
    }

    mutating func record(_ reading: EvaluationResourceReading) {
        sampleCount += 1
        if let value = reading.footprintBytes {
            maxObservedFootprintBytes = max(value, maxObservedFootprintBytes ?? value)
        }
        if let value = reading.headroomBytes {
            minObservedHeadroomBytes = min(value, minObservedHeadroomBytes ?? value)
        }
        if let state = reading.thermalState, state.severity > (worstObservedThermalState?.severity ?? -1) {
            worstObservedThermalState = state
        }
        lowPowerModeObserved = lowPowerModeObserved || reading.lowPowerMode
    }
}

/// The timer and final reading mutate the aggregate on the same serial queue.
final class EvaluationResourceSampler {
    private let queue = DispatchQueue(label: "PocketAILab.evaluation.resources", qos: .utility)
    private let timer: DispatchSourceTimer
    private var samples = EvaluationResourceSamples()

    init() {
        timer = DispatchSource.makeTimerSource(queue: queue)
        samples.record(.current())
        let period = DispatchTimeInterval.milliseconds(samples.intervalMilliseconds)
        timer.schedule(deadline: .now() + period, repeating: period, leeway: .milliseconds(25))
        timer.setEventHandler { [weak self] in self?.samples.record(.current()) }
        timer.resume()
    }

    func finish() -> EvaluationResourceSamples {
        queue.sync {
            timer.cancel()
            samples.record(.current())
            return samples
        }
    }

    deinit { timer.cancel() }
}
