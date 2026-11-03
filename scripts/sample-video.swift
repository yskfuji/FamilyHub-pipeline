// 確認用データの動画の見本（scripts/build-sample-attachments.mjs から呼ぶ）。2秒の H.264、160x90、帯が横に流れるだけの絵。メタデータは書かない。
import AVFoundation
import CoreVideo
import Foundation

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.removeItem(at: out)
let width = 160, height = 90, frames = 24, fps: Int32 = 12
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 60_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel, AVVideoMaxKeyFrameIntervalKey: 12]]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
writer.add(input)
writer.metadata = []
writer.startWriting()
writer.startSession(atSourceTime: .zero)
for frame in 0..<frames {
  while !input.isReadyForMoreMediaData { usleep(1000) }
  var buffer: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
  let pixels = buffer!
  CVPixelBufferLockBaseAddress(pixels, [])
  let base = CVPixelBufferGetBaseAddress(pixels)!.assumingMemoryBound(to: UInt8.self)
  let stride = CVPixelBufferGetBytesPerRow(pixels)
  for y in 0..<height { for x in 0..<width {
    let p = base + y * stride + x * 4
    let band = (x + frame * 6) % width < width / 2
    p[0] = band ? 200 : 90; p[1] = UInt8(80 + y); p[2] = band ? 60 : 180; p[3] = 255
  } }
  CVPixelBufferUnlockBaseAddress(pixels, [])
  adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps))
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
print(writer.status == .completed ? "ok" : "failed \(String(describing: writer.error))")
