import SwiftUI

/// 挿絵の要素（生成した Illustrations.swift が並べる）。path は絶対座標の M・L・C・Z。
public struct IllustrationElement: Sendable {
  public let path: String
  public let fill: ArtColor?
  public let stroke: ArtColor?
  public let dash: [Double]
  public init(path: String, fill: ArtColor?, stroke: ArtColor?, dash: [Double] = []) {
    self.path = path; self.fill = fill; self.stroke = stroke; self.dash = dash
  }
}

extension Illustration {
  /// 要素ごとの形。最初に使うときに一度だけ読む。
  static let paths: [Illustration: [Path]] = Dictionary(uniqueKeysWithValues: allCases.map { ($0, $0.elements.map { Path(svgCommands: $0.path) }) })
}

extension Path {
  /// 書き出した path（M・L・C・Z、絶対座標）を読む。
  init(svgCommands text: String) {
    self.init()
    var numbers: [CGFloat] = []
    var command: Character = " "
    var token = ""
    func flushNumber() {
      if let value = Double(token) { numbers.append(CGFloat(value)) }
      token = ""
    }
    func run() {
      switch command {
      case "M" where numbers.count >= 2: move(to: CGPoint(x: numbers[0], y: numbers[1]))
      case "L" where numbers.count >= 2: addLine(to: CGPoint(x: numbers[0], y: numbers[1]))
      case "C" where numbers.count >= 6:
        addCurve(to: CGPoint(x: numbers[4], y: numbers[5]), control1: CGPoint(x: numbers[0], y: numbers[1]), control2: CGPoint(x: numbers[2], y: numbers[3]))
      case "Z": closeSubpath()
      default: break
      }
      numbers.removeAll(keepingCapacity: true)
    }
    for character in text {
      if "MLCZ".contains(character) {
        flushNumber(); if command != " " { run() }
        command = character
      } else if character == " " {
        flushNumber()
      } else if character == "-", !token.isEmpty {
        flushNumber(); token = "-"
      } else {
        token.append(character)
      }
    }
    flushNumber()
    if command != " " { run() }
  }
}

/// 挿絵。色はテーマの役割から取る（夜のテーマでも変わる）。線の太さは大きさによらない（Web の non-scaling-stroke と同じ）。
/// 飾りなので読み上げない。意味は隣の文が伝える。
public struct IllustrationView: View {
  @Environment(\.theme) private var theme
  private let illustration: Illustration
  private let lineWidth: CGFloat

  /// lineWidth は Web の .illustration と同じ: ふだん 2、小さな空の状態と季節の場面は 1.75、はじめには 2.25。
  public init(_ illustration: Illustration, lineWidth: CGFloat = 2) {
    self.illustration = illustration
    self.lineWidth = lineWidth
  }

  public var body: some View {
    let colors = theme.colors
    let size = illustration.size
    let elements = illustration.elements
    let paths = Illustration.paths[illustration] ?? []
    Canvas { context, canvas in
      let scale = min(canvas.width / size.width, canvas.height / size.height)
      let transform = CGAffineTransform(translationX: (canvas.width - size.width * scale) / 2, y: (canvas.height - size.height * scale) / 2).scaledBy(x: scale, y: scale)
      for (element, path) in zip(elements, paths) {
        let shape = path.applying(transform)
        if let fill = element.fill { context.fill(shape, with: .color(fill.rgba(in: colors).color)) }
        if let stroke = element.stroke {
          context.stroke(shape, with: .color(stroke.rgba(in: colors).color), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round, dash: element.dash.map { CGFloat($0) }))
        }
      }
    }
    .aspectRatio(size.width / size.height, contentMode: .fit)
    .accessibilityHidden(true)
  }
}
