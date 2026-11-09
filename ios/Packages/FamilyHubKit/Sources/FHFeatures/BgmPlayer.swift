import Foundation
import AVFoundation
import FHModel
import FHDomain

/// スライドショーの曲（Web の bgm.ts の createBgmPlayer）。音源は持たず、和音から合成する。
/// 音の並び（barNotes）は Web と同じ。鳴らし方は AVAudioEngine の音源ノードで、1音ごとに
/// 0.04秒で立ち上げ、終わりに向けて指数で小さくする。高い音は低域通過のフィルターで丸める。
@MainActor
final class BgmPlayer {
  private var engine: AVAudioEngine?
  private var volume: Float = 0.5

  /// 鳴らす。鳴らせなければ false。前の曲は止める（重ねない）。
  @discardableResult
  func play(_ preset: BgmPreset) -> Bool {
    stop()
    #if os(iOS)
    try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
    try? AVAudioSession.sharedInstance().setActive(true)
    #endif
    let engine = AVAudioEngine()
    let format = engine.outputNode.inputFormat(forBus: 0)
    let rate = format.sampleRate > 0 ? format.sampleRate : 44_100
    let source = Self.source(BgmSchedule(preset: preset, sampleRate: rate), rate: rate)
    let filter = AVAudioUnitEQ(numberOfBands: 1)
    filter.bands[0].filterType = .lowPass
    filter.bands[0].frequency = Float(BgmSound.preset(preset).cutoffHz)
    filter.bands[0].bypass = false
    engine.attach(source)
    engine.attach(filter)
    engine.connect(source, to: filter, format: nil)
    engine.connect(filter, to: engine.mainMixerNode, format: nil)
    engine.mainMixerNode.outputVolume = volume
    do { try engine.start() } catch { return false }
    self.engine = engine
    return true
  }

  /// 音を作るノード。音の処理の糸から呼ばれるので、主の糸（MainActor）に縛らない場所で作る
  /// （縛ったまま作ると、Swift 6 が呼ばれた糸を確かめて止まる）。
  nonisolated static func source(_ schedule: BgmSchedule, rate: Double) -> AVAudioSourceNode {
    final class Clock: @unchecked Sendable { var frame: Int64 = 0 }
    let clock = Clock()
    return AVAudioSourceNode(format: AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1)!) { @Sendable _, _, count, buffers in
      let list = UnsafeMutableAudioBufferListPointer(buffers)
      guard let pointer = list.first?.mData?.assumingMemoryBound(to: Float.self) else { return noErr }
      for index in 0..<Int(count) {
        pointer[index] = schedule.sample(at: clock.frame + Int64(index))
      }
      clock.frame += Int64(count)
      return noErr
    }
  }

  func stop() {
    guard let engine else { return }
    self.engine = nil
    // 急に切ると音がはねるので、少し小さくしてから止める。
    engine.mainMixerNode.outputVolume = 0
    Task { try? await Task.sleep(for: .milliseconds(200)); engine.stop() }
  }

  /// 0 から 1。
  func setVolume(_ value: Double) {
    volume = Float(min(1, max(0, value)))
    engine?.mainMixerNode.outputVolume = volume
  }
}

/// 鳴らす音の予定。音の高さ・始まり・長さは、Web の barNotes と同じ。
struct BgmSchedule: Sendable {
  struct Voice: Sendable { let frequency: Double; let start: Int64; let length: Int64; let level: Double; let triangle: Bool }
  let bars: [[Voice]]
  let barLength: Int64
  let sampleRate: Double
  let attack: Int64

  init(preset: BgmPreset, sampleRate: Double) {
    self.sampleRate = sampleRate
    let seconds = BgmSound.barSeconds(preset)
    let beat = seconds / BgmSound.beatsPerBar
    barLength = Int64(seconds * sampleRate)
    attack = Int64(0.04 * sampleRate)
    bars = (0..<4).map { bar in
      BgmSound.barNotes(preset, bar: bar).map { note in
        Voice(frequency: note.frequency, start: Int64(note.beat * beat * sampleRate), length: Int64(note.beats * beat * sampleRate), level: note.level, triangle: note.wave == .triangle)
      }
    }
  }

  /// frame の位置の音（この小節と、前の小節から鳴り続ける音を足す）。
  func sample(at frame: Int64) -> Float {
    let bar = Int(frame / barLength)
    var value = 0.0
    for offset in [0, 1] where bar - offset >= 0 {
      let start = Int64(bar - offset) * barLength
      for voice in bars[(bar - offset) % bars.count] {
        let local = frame - start - voice.start
        guard local >= 0, local < voice.length else { continue }
        value += envelope(local, voice) * wave(Double(local) / sampleRate * voice.frequency, triangle: voice.triangle)
      }
    }
    return Float(value)
  }

  private func envelope(_ local: Int64, _ voice: Voice) -> Double {
    if local < attack { return voice.level * Double(local) / Double(attack) }
    // 立ち上がりの後、終わりに 0.0001 になるように指数で小さくする。
    let progress = Double(local - attack) / Double(max(1, voice.length - attack))
    return voice.level * pow(0.0001 / voice.level, progress)
  }

  private func wave(_ phase: Double, triangle: Bool) -> Double {
    let cycle = phase - floor(phase)
    return triangle ? 1 - 4 * abs(cycle - 0.5) : sin(2 * .pi * cycle)
  }
}
