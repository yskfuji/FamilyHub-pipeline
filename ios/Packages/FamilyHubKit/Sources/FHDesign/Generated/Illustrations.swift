// 生成したファイル。手で書き換えない。npx tsx scripts/ios/export-illustrations.ts で作り直す。
// 元: src/design-system/illustrations/*.tsx
import CoreGraphics

/// 挿絵。どれも飾りで、意味は隣の文が伝える（読み上げない）。
public enum Illustration: String, CaseIterable, Sendable {
  case emptyAlbums
  case emptyBudget
  case emptyDone
  case emptyError
  case emptyEvents
  case emptyMemos
  case emptyOffline
  case emptyPlaces
  case emptySearch
  case emptyTasks
  case onboardingHousehold
  case onboardingSharing
  case onboardingWelcome
  case seasonSpring
  case seasonSummer
  case seasonAutumn
  case seasonWinter

  /// 元の SVG の viewBox の大きさ。
  public var size: CGSize {
    switch self {
    case .emptyAlbums: CGSize(width: 160, height: 120)
    case .emptyBudget: CGSize(width: 160, height: 120)
    case .emptyDone: CGSize(width: 160, height: 120)
    case .emptyError: CGSize(width: 160, height: 120)
    case .emptyEvents: CGSize(width: 160, height: 120)
    case .emptyMemos: CGSize(width: 160, height: 120)
    case .emptyOffline: CGSize(width: 160, height: 120)
    case .emptyPlaces: CGSize(width: 160, height: 120)
    case .emptySearch: CGSize(width: 160, height: 120)
    case .emptyTasks: CGSize(width: 160, height: 120)
    case .onboardingHousehold: CGSize(width: 240, height: 140)
    case .onboardingSharing: CGSize(width: 240, height: 140)
    case .onboardingWelcome: CGSize(width: 240, height: 140)
    case .seasonSpring: CGSize(width: 120, height: 64)
    case .seasonSummer: CGSize(width: 120, height: 64)
    case .seasonAutumn: CGSize(width: 120, height: 64)
    case .seasonWinter: CGSize(width: 120, height: 64)
    }
  }

  /// 描く順の要素。座標は viewBox の中の絶対座標。
  public var elements: [IllustrationElement] {
    switch self {
    // EmptyAlbums
    case .emptyAlbums: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M67.03 20.37L122.49 28.16C125.22 28.54 127.12 31.07 126.74 33.81L120.62 77.38C120.23 80.11 117.7 82.02 114.97 81.63L59.51 73.84C56.78 73.46 54.88 70.93 55.26 68.19L61.38 24.62C61.77 21.89 64.3 19.98 67.03 20.37Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M41 38L107 38C109.76 38 112 40.24 112 43L112 93C112 95.76 109.76 98 107 98L41 98C38.24 98 36 95.76 36 93L36 43C36 40.24 38.24 38 41 38Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M45 45L103 45C104.1 45 105 45.9 105 47L105 83C105 84.1 104.1 85 103 85L45 85C43.9 85 43 84.1 43 83L43 47C43 45.9 43.9 45 45 45Z", fill: .paperDeep, stroke: nil),
      .init(path: "M43 85L63 63L75 75L85 67L105 85Z", fill: .mossSoft, stroke: .moss),
      .init(path: "M96 57C96 60.31 93.31 63 90 63C86.69 63 84 60.31 84 57C84 53.69 86.69 51 90 51C93.31 51 96 53.69 96 57Z", fill: .brandSoft, stroke: .brand),
    ]
    // EmptyBudget
    case .emptyBudget: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M38 58C38 53.58 41.58 50 46 50L106 50C110.42 50 114 53.58 114 58L114 86C114 92.63 108.63 98 102 98L50 98C43.37 98 38 92.63 38 86Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M58 50C58 42.27 66.06 36 76 36C85.94 36 94 42.27 94 50", fill: nil, stroke: .inkSoft),
      .init(path: "M74 42C74 44.21 72.21 46 70 46C67.79 46 66 44.21 66 42C66 39.79 67.79 38 70 38C72.21 38 74 39.79 74 42Z", fill: .sheet, stroke: .gold),
      .init(path: "M86 42C86 44.21 84.21 46 82 46C79.79 46 78 44.21 78 42C78 39.79 79.79 38 82 38C84.21 38 86 39.79 86 42Z", fill: .sheet, stroke: .gold),
      .init(path: "M38 66C56 76 96 76 114 66", fill: nil, stroke: .moss),
      .init(path: "M131 82C131 86.97 126.97 91 122 91C117.03 91 113 86.97 113 82C113 77.03 117.03 73 122 73C126.97 73 131 77.03 131 82Z", fill: .sheet, stroke: .gold),
      .init(path: "M121 92C121 96.97 116.97 101 112 101C107.03 101 103 96.97 103 92C103 87.03 107.03 83 112 83C116.97 83 121 87.03 121 92Z", fill: .sheet, stroke: .gold),
      .init(path: "M139 96C139 100.97 134.97 105 130 105C125.03 105 121 100.97 121 96C121 91.03 125.03 87 130 87C134.97 87 139 91.03 139 96Z", fill: .sheet, stroke: .gold),
      .init(path: "M118 77L122 82L126 77M122 82L122 88M118 84L126 84", fill: nil, stroke: .gold),
    ]
    // EmptyDone
    case .emptyDone: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M40 98L104 98", fill: nil, stroke: .lineStrong),
      .init(path: "M46 60L98 60L98 74C98 85.05 89.05 94 78 94L66 94C54.95 94 46 85.05 46 74Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M98 64L101 64C105.42 64 109 67.58 109 72C109 76.42 105.42 80 101 80L96 80", fill: nil, stroke: .inkSoft),
      .init(path: "M52 70L92 70", fill: nil, stroke: .brand),
      .init(path: "M62 50C58 44 66 42 62 36M74 50C70 44 78 42 74 36M86 50C82 44 90 42 86 36", fill: nil, stroke: .lineStrong),
      .init(path: "M132 44C132 51.73 125.73 58 118 58C110.27 58 104 51.73 104 44C104 36.27 110.27 30 118 30C125.73 30 132 36.27 132 44Z", fill: .mossSoft, stroke: .moss),
      .init(path: "M111 44L116 49L125 39", fill: nil, stroke: .moss),
    ]
    // EmptyError
    case .emptyError: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M39.1 31.52L72.97 28.56L68.21 43.03L77.23 54.29L71.3 66.85L78.5 80.28L74.74 94.66L44.85 97.27C41.55 97.56 38.64 95.12 38.35 91.82L33.64 38.02C33.35 34.72 35.8 31.81 39.1 31.52Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M42.66 49.28L60.59 47.71M43.7 61.24L65.62 59.32M44.75 73.19L60.69 71.8", fill: nil, stroke: .lineStrong),
      .init(path: "M89.63 30.72L115.49 33.44C118.78 33.79 121.17 36.74 120.83 40.03L115.18 93.74C114.84 97.03 111.88 99.43 108.59 99.08L82.73 96.36L89.17 82.96L84.66 68.41L92.88 57.21L86.18 44.44Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M97.69 49.67L111.62 51.13M98.43 61.81L110.36 63.07M95.19 73.54L107.12 74.79", fill: nil, stroke: .lineStrong),
      .init(path: "M133 28C133 34.08 128.08 39 122 39C115.92 39 111 34.08 111 28C111 21.92 115.92 17 122 17C128.08 17 133 21.92 133 28Z", fill: .attentionSoft, stroke: .attention),
      .init(path: "M122 22L122 29M122 34L122 34.01", fill: nil, stroke: .attention),
    ]
    // EmptyEvents
    case .emptyEvents: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M50 28L110 28C114.42 28 118 31.58 118 36L118 86C118 90.42 114.42 94 110 94L50 94C45.58 94 42 90.42 42 86L42 36C42 31.58 45.58 28 50 28Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M42 46L42 36C42 31.58 45.58 28 50 28L110 28C114.42 28 118 31.58 118 36L118 46Z", fill: .brandSoft, stroke: .inkSoft),
      .init(path: "M60 22L60 34M100 22L100 34", fill: nil, stroke: .inkSoft),
      .init(path: "M58.2 58C58.2 59.22 57.22 60.2 56 60.2C54.78 60.2 53.8 59.22 53.8 58C53.8 56.78 54.78 55.8 56 55.8C57.22 55.8 58.2 56.78 58.2 58Z", fill: .lineStrong, stroke: nil),
      .init(path: "M58.2 70C58.2 71.22 57.22 72.2 56 72.2C54.78 72.2 53.8 71.22 53.8 70C53.8 68.78 54.78 67.8 56 67.8C57.22 67.8 58.2 68.78 58.2 70Z", fill: .lineStrong, stroke: nil),
      .init(path: "M58.2 82C58.2 83.22 57.22 84.2 56 84.2C54.78 84.2 53.8 83.22 53.8 82C53.8 80.78 54.78 79.8 56 79.8C57.22 79.8 58.2 80.78 58.2 82Z", fill: .lineStrong, stroke: nil),
      .init(path: "M74.2 58C74.2 59.22 73.22 60.2 72 60.2C70.78 60.2 69.8 59.22 69.8 58C69.8 56.78 70.78 55.8 72 55.8C73.22 55.8 74.2 56.78 74.2 58Z", fill: .lineStrong, stroke: nil),
      .init(path: "M74.2 70C74.2 71.22 73.22 72.2 72 72.2C70.78 72.2 69.8 71.22 69.8 70C69.8 68.78 70.78 67.8 72 67.8C73.22 67.8 74.2 68.78 74.2 70Z", fill: .lineStrong, stroke: nil),
      .init(path: "M74.2 82C74.2 83.22 73.22 84.2 72 84.2C70.78 84.2 69.8 83.22 69.8 82C69.8 80.78 70.78 79.8 72 79.8C73.22 79.8 74.2 80.78 74.2 82Z", fill: .lineStrong, stroke: nil),
      .init(path: "M90.2 58C90.2 59.22 89.22 60.2 88 60.2C86.78 60.2 85.8 59.22 85.8 58C85.8 56.78 86.78 55.8 88 55.8C89.22 55.8 90.2 56.78 90.2 58Z", fill: .lineStrong, stroke: nil),
      .init(path: "M90.2 70C90.2 71.22 89.22 72.2 88 72.2C86.78 72.2 85.8 71.22 85.8 70C85.8 68.78 86.78 67.8 88 67.8C89.22 67.8 90.2 68.78 90.2 70Z", fill: .lineStrong, stroke: nil),
      .init(path: "M90.2 82C90.2 83.22 89.22 84.2 88 84.2C86.78 84.2 85.8 83.22 85.8 82C85.8 80.78 86.78 79.8 88 79.8C89.22 79.8 90.2 80.78 90.2 82Z", fill: .lineStrong, stroke: nil),
      .init(path: "M106.2 58C106.2 59.22 105.22 60.2 104 60.2C102.78 60.2 101.8 59.22 101.8 58C101.8 56.78 102.78 55.8 104 55.8C105.22 55.8 106.2 56.78 106.2 58Z", fill: .lineStrong, stroke: nil),
      .init(path: "M106.2 70C106.2 71.22 105.22 72.2 104 72.2C102.78 72.2 101.8 71.22 101.8 70C101.8 68.78 102.78 67.8 104 67.8C105.22 67.8 106.2 68.78 106.2 70Z", fill: .lineStrong, stroke: nil),
      .init(path: "M106.2 82C106.2 83.22 105.22 84.2 104 84.2C102.78 84.2 101.8 83.22 101.8 82C101.8 80.78 102.78 79.8 104 79.8C105.22 79.8 106.2 80.78 106.2 82Z", fill: .lineStrong, stroke: nil),
      .init(path: "M95 70C95 73.87 91.87 77 88 77C84.13 77 81 73.87 81 70C81 66.13 84.13 63 88 63C91.87 63 95 66.13 95 70Z", fill: nil, stroke: .brand),
      .init(path: "M128.8 91.6C128.8 95.8 124.86 99.2 120 99.2C115.14 99.2 111.2 95.8 111.2 91.6C111.2 87.4 115.14 84 120 84C124.86 84 128.8 87.4 128.8 91.6Z", fill: .kakiSoft, stroke: .kaki),
      .init(path: "M113.6 85.2C116 82.8 117.6 82.8 120 84.4C122.4 82.8 124 82.8 126.4 85.2C124 86.8 122.4 86.8 120 86C117.6 86.8 116 86.8 113.6 85.2ZM120 84.4L120 81.2", fill: .mossSoft, stroke: .moss),
    ]
    // EmptyMemos
    case .emptyMemos: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M45.29 36.15L92.7 28.64C95.97 28.12 99.04 30.35 99.56 33.63L107.7 84.99C108.22 88.26 105.98 91.33 102.71 91.85L55.3 99.36C52.03 99.88 48.96 97.65 48.44 94.37L40.3 43.01C39.78 39.74 42.02 36.67 45.29 36.15Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M62 28L106 28L116 38L116 92C116 94.21 114.21 96 112 96L62 96C59.79 96 58 94.21 58 92L58 32C58 29.79 59.79 28 62 28Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M106 28L106 38L116 38", fill: nil, stroke: .inkSoft),
      .init(path: "M68 52L104 52M68 64L104 64M68 76L90 76", fill: nil, stroke: .lineStrong),
      .init(path: "M89 30C89 32.76 86.76 35 84 35C81.24 35 79 32.76 79 30C79 27.24 81.24 25 84 25C86.76 25 89 27.24 89 30Z", fill: .brandSoft, stroke: .brand),
    ]
    // EmptyOffline
    case .emptyOffline: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M54 70C46.27 70.28 39.78 64.23 39.5 56.5C39.22 48.77 45.27 42.28 53 42C54.08 33.13 60.91 26.05 69.73 24.65C78.56 23.26 87.24 27.89 91 36C100.39 31.31 111.81 35.11 116.5 44.5C121.19 53.89 117.39 65.31 108 70Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M62 90C72.06 80.35 87.94 80.35 98 90M70 98C72.63 95.31 76.24 93.8 80 93.8C83.76 93.8 87.37 95.31 90 98", fill: nil, stroke: .lineStrong),
      .init(path: "M82.5 105C82.5 106.38 81.38 107.5 80 107.5C78.62 107.5 77.5 106.38 77.5 105C77.5 103.62 78.62 102.5 80 102.5C81.38 102.5 82.5 103.62 82.5 105Z", fill: .lineStrong, stroke: nil),
      .init(path: "M62 80L98 110", fill: nil, stroke: .brand),
    ]
    // EmptyPlaces
    case .emptyPlaces: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M32 40L62 30L94 40L124 30L124 90L94 100L62 90L32 100Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M62 30L62 90M94 40L94 100", fill: nil, stroke: .lineStrong),
      .init(path: "M42 82C52 78 56 64 68 66C80 68 82 80 96 74", fill: nil, stroke: .accent, dash: [2, 6]),
      .init(path: "M106 74C106 74 93 62 93 52C93 44.82 98.82 39 106 39C113.18 39 119 44.82 119 52C119 62 106 74 106 74Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M110.5 52C110.5 54.49 108.49 56.5 106 56.5C103.51 56.5 101.5 54.49 101.5 52C101.5 49.51 103.51 47.5 106 47.5C108.49 47.5 110.5 49.51 110.5 52Z", fill: .sheet, stroke: .brand),
    ]
    // EmptySearch
    case .emptySearch: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M88.69 72.69L88.69 72.69C91.03 70.34 94.83 70.34 97.17 72.69L111.31 86.83C113.66 89.17 113.66 92.97 111.31 95.31L111.31 95.31C108.97 97.66 105.17 97.66 102.83 95.31L88.69 81.17C86.34 78.83 86.34 75.03 88.69 72.69Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M98 56C98 70.36 86.36 82 72 82C57.64 82 46 70.36 46 56C46 41.64 57.64 30 72 30C86.36 30 98 41.64 98 56Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M91 56C91 66.49 82.49 75 72 75C61.51 75 53 66.49 53 56C53 45.51 61.51 37 72 37C82.49 37 91 45.51 91 56Z", fill: nil, stroke: .lineStrong),
      .init(path: "M66.5 56C66.5 57.38 65.38 58.5 64 58.5C62.62 58.5 61.5 57.38 61.5 56C61.5 54.62 62.62 53.5 64 53.5C65.38 53.5 66.5 54.62 66.5 56Z", fill: .lineStrong, stroke: nil),
      .init(path: "M74.5 56C74.5 57.38 73.38 58.5 72 58.5C70.62 58.5 69.5 57.38 69.5 56C69.5 54.62 70.62 53.5 72 53.5C73.38 53.5 74.5 54.62 74.5 56Z", fill: .lineStrong, stroke: nil),
      .init(path: "M82.5 56C82.5 57.38 81.38 58.5 80 58.5C78.62 58.5 77.5 57.38 77.5 56C77.5 54.62 78.62 53.5 80 53.5C81.38 53.5 82.5 54.62 82.5 56Z", fill: .lineStrong, stroke: nil),
      .init(path: "M36 30L36 38M32 34L40 34M124 34L124 40M121 37L127 37", fill: nil, stroke: .moss),
    ]
    // EmptyTasks
    case .emptyTasks: [
      .init(path: "M20 98C10 76 18 46 44 32C66 20 96 18 120 26C144 35 154 58 146 80C142 92 132 99 118 100L36 100C28 100 23 99 20 98Z", fill: .artGround, stroke: nil),
      .init(path: "M54 24L102 24C106.42 24 110 27.58 110 32L110 92C110 96.42 106.42 100 102 100L54 100C49.58 100 46 96.42 46 92L46 32C46 27.58 49.58 24 54 24Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M68 18L88 18C90.21 18 92 19.79 92 22L92 26C92 28.21 90.21 30 88 30L68 30C65.79 30 64 28.21 64 26L64 22C64 19.79 65.79 18 68 18Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M59 41L63 41C64.66 41 66 42.34 66 44L66 48C66 49.66 64.66 51 63 51L59 51C57.34 51 56 49.66 56 48L56 44C56 42.34 57.34 41 59 41Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M74 46L100 46", fill: nil, stroke: .lineStrong),
      .init(path: "M59 57L63 57C64.66 57 66 58.34 66 60L66 64C66 65.66 64.66 67 63 67L59 67C57.34 67 56 65.66 56 64L56 60C56 58.34 57.34 57 59 57Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M74 62L100 62", fill: nil, stroke: .lineStrong),
      .init(path: "M59 73L63 73C64.66 73 66 74.34 66 76L66 80C66 81.66 64.66 83 63 83L59 83C57.34 83 56 81.66 56 80L56 76C56 74.34 57.34 73 59 73Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M74 78L90 78", fill: nil, stroke: .lineStrong),
      .init(path: "M58 46L61 49L66 43", fill: nil, stroke: .moss),
      .init(path: "M133.54 39.3L142.02 44.6L120.82 78.52L112.34 82.66L112.34 73.22Z", fill: .brandSoft, stroke: .inkSoft),
      .init(path: "M129.3 46.09L137.78 51.38M112.13 75.45L118.91 79.69", fill: nil, stroke: .brand),
    ]
    // OnboardingHousehold
    case .onboardingHousehold: [
      .init(path: "M24 128C10 102 20 58 60 38C96 20 152 18 188 34C224 50 236 86 220 114C214 124 204 130 190 130L40 130C32 130 27 129 24 128Z", fill: .artGround, stroke: nil),
      .init(path: "M48 64L112 64C114.21 64 116 65.79 116 68L116 116C116 118.21 114.21 120 112 120L48 120C45.79 120 44 118.21 44 116L44 68C44 65.79 45.79 64 48 64Z", fill: .sheet, stroke: .inkSoft),
      .init(path: "M36 68L80 32L124 68Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M75 88L85 88C86.66 88 88 89.34 88 91L88 117C88 118.66 86.66 120 85 120L75 120C73.34 120 72 118.66 72 117L72 91C72 89.34 73.34 88 75 88Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M56 76L64 76C65.1 76 66 76.9 66 78L66 86C66 87.1 65.1 88 64 88L56 88C54.9 88 54 87.1 54 86L54 78C54 76.9 54.9 76 56 76Z", fill: .paperDeep, stroke: .inkSoft),
      .init(path: "M96 76L104 76C105.1 76 106 76.9 106 78L106 86C106 87.1 105.1 88 104 88L96 88C94.9 88 94 87.1 94 86L94 78C94 76.9 94.9 76 96 76Z", fill: .paperDeep, stroke: .inkSoft),
      .init(path: "M28 120L212 120", fill: nil, stroke: .lineStrong),
      .init(path: "M154.05 91C154.05 95.45 150.45 99.05 146 99.05C141.55 99.05 137.95 95.45 137.95 91C137.95 86.55 141.55 82.95 146 82.95C150.45 82.95 154.05 86.55 154.05 91Z", fill: .brandSoft, stroke: .inkSoft),
      .init(path: "M132.2 120.9C132.2 113.28 138.38 107.1 146 107.1C153.62 107.1 159.8 113.28 159.8 120.9Z", fill: .brandSoft, stroke: .inkSoft),
      .init(path: "M175.6 100C175.6 103.09 173.09 105.6 170 105.6C166.91 105.6 164.4 103.09 164.4 100C164.4 96.91 166.91 94.4 170 94.4C173.09 94.4 175.6 96.91 175.6 100Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M160.4 120.8C160.4 115.5 164.7 111.2 170 111.2C175.3 111.2 179.6 115.5 179.6 120.8Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M201.7 92C201.7 96.25 198.25 99.7 194 99.7C189.75 99.7 186.3 96.25 186.3 92C186.3 87.75 189.75 84.3 194 84.3C198.25 84.3 201.7 87.75 201.7 92Z", fill: .infoSoft, stroke: .inkSoft),
      .init(path: "M180.8 120.6C180.8 113.31 186.71 107.4 194 107.4C201.29 107.4 207.2 113.31 207.2 120.6Z", fill: .infoSoft, stroke: .inkSoft),
    ]
    // OnboardingSharing
    case .onboardingSharing: [
      .init(path: "M24 128C10 102 20 58 60 38C96 20 152 18 188 34C224 50 236 86 220 114C214 124 204 130 190 130L40 130C32 130 27 129 24 128Z", fill: .artGround, stroke: nil),
      .init(path: "M60 70C60 44.59 86.86 24 120 24C153.14 24 180 44.59 180 70C172 64 164 64 156 70C148 64 140 64 132 70C124 64 116 64 108 70C100 64 92 64 84 70C76 64 68 64 60 70Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M120 24L120 18M120 70L120 114C120 117.31 117.31 120 114 120C110.69 120 108 117.31 108 114", fill: nil, stroke: .inkSoft),
      .init(path: "M105.7 98C105.7 102.25 102.25 105.7 98 105.7C93.75 105.7 90.3 102.25 90.3 98C90.3 93.75 93.75 90.3 98 90.3C102.25 90.3 105.7 93.75 105.7 98Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M84.8 126.6C84.8 119.31 90.71 113.4 98 113.4C105.29 113.4 111.2 119.31 111.2 126.6Z", fill: .mossSoft, stroke: .inkSoft),
      .init(path: "M149.7 98C149.7 102.25 146.25 105.7 142 105.7C137.75 105.7 134.3 102.25 134.3 98C134.3 93.75 137.75 90.3 142 90.3C146.25 90.3 149.7 93.75 149.7 98Z", fill: .infoSoft, stroke: .inkSoft),
      .init(path: "M128.8 126.6C128.8 119.31 134.71 113.4 142 113.4C149.29 113.4 155.2 119.31 155.2 126.6Z", fill: .infoSoft, stroke: .inkSoft),
      .init(path: "M28 120L212 120", fill: nil, stroke: .lineStrong),
      .init(path: "M34 46L31 53M46 70L43 77M30 92L27 99M206 50L203 57M214 78L211 85M198 100L195 107", fill: nil, stroke: .accent),
    ]
    // OnboardingWelcome
    case .onboardingWelcome: [
      .init(path: "M24 128C10 102 20 58 60 38C96 20 152 18 188 34C224 50 236 86 220 114C214 124 204 130 190 130L40 130C32 130 27 129 24 128Z", fill: .artGround, stroke: nil),
      .init(path: "M214 36C214 43.73 207.73 50 200 50C192.27 50 186 43.73 186 36C186 28.27 192.27 22 200 22C207.73 22 214 28.27 214 36Z", fill: .sheet, stroke: .gold),
      .init(path: "M200 12L200 16M200 56L200 60M176 36L180 36M220 36L224 36M183 19L186 22M217 19L214 22M183 53L186 50M217 53L214 50", fill: nil, stroke: .gold),
      .init(path: "M18 34C58 36 92 44 122 58C152 72 174 88 194 90", fill: nil, stroke: .inkSoft),
      .init(path: "M60 40C64 28 76 24 86 28C82 40 70 44 60 40ZM132 64C142 56 156 58 162 66C152 74 138 72 132 64Z", fill: .mossSoft, stroke: .moss),
      .init(path: "M78 46L78 56M120 58L120 72M172 80L172 90", fill: nil, stroke: .inkSoft),
      .init(path: "M90.1 68.2C90.1 73.97 84.68 78.65 78 78.65C71.32 78.65 65.9 73.97 65.9 68.2C65.9 62.43 71.32 57.75 78 57.75C84.68 57.75 90.1 62.43 90.1 68.2Z", fill: .kakiSoft, stroke: .kaki),
      .init(path: "M69.2 59.4C72.5 56.1 74.7 56.1 78 58.3C81.3 56.1 83.5 56.1 86.8 59.4C83.5 61.6 81.3 61.6 78 60.5C74.7 61.6 72.5 61.6 69.2 59.4ZM78 58.3L78 53.9", fill: .mossSoft, stroke: .moss),
      .init(path: "M133.75 85.5C133.75 92.06 127.59 97.38 120 97.38C112.41 97.38 106.25 92.06 106.25 85.5C106.25 78.94 112.41 73.63 120 73.63C127.59 73.63 133.75 78.94 133.75 85.5Z", fill: .kakiSoft, stroke: .kaki),
      .init(path: "M110 75.5C113.75 71.75 116.25 71.75 120 74.25C123.75 71.75 126.25 71.75 130 75.5C126.25 78 123.75 78 120 76.75C116.25 78 113.75 78 110 75.5ZM120 74.25L120 69.25", fill: .mossSoft, stroke: .moss),
      .init(path: "M183 102C183 107.25 178.08 111.5 172 111.5C165.92 111.5 161 107.25 161 102C161 96.75 165.92 92.5 172 92.5C178.08 92.5 183 96.75 183 102Z", fill: .kakiSoft, stroke: .kaki),
      .init(path: "M164 94C167 91 169 91 172 93C175 91 177 91 180 94C177 96 175 96 172 95C169 96 167 96 164 94ZM172 93L172 89", fill: .mossSoft, stroke: .moss),
    ]
    // SeasonScene season="spring"
    case .seasonSpring: [
      .init(path: "M0 64C18 50 44 44 68 50C92 56 106 56 120 48L120 64Z", fill: .mossSoft, stroke: nil),
      .init(path: "M8 8C26 12 42 22 54 36M30 14C32 20 30 26 26 30", fill: nil, stroke: .inkSoft),
      .init(path: "M27 5.5C27 7.99 25.66 10 24 10C22.34 10 21 7.99 21 5.5C21 3.01 22.34 1 24 1C25.66 1 27 3.01 27 5.5Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M29.21 11.46C26.84 12.23 24.51 11.58 24 10C23.49 8.42 24.99 6.52 27.35 5.76C29.72 4.99 32.05 5.64 32.56 7.22C33.07 8.79 31.57 10.69 29.21 11.46Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M24.22 15.4C22.76 13.39 22.66 10.97 24 10C25.34 9.03 27.61 9.87 29.07 11.88C30.53 13.89 30.63 16.31 29.29 17.28C27.95 18.26 25.68 17.41 24.22 15.4Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M18.93 11.88C20.39 9.87 22.66 9.03 24 10C25.34 10.97 25.24 13.39 23.78 15.4C22.32 17.41 20.05 18.26 18.71 17.28C17.37 16.31 17.47 13.89 18.93 11.88Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M20.65 5.76C23.01 6.52 24.51 8.42 24 10C23.49 11.58 21.16 12.23 18.79 11.46C16.43 10.69 14.93 8.79 15.44 7.22C15.95 5.64 18.28 4.99 20.65 5.76Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M25.6 10C25.6 10.88 24.88 11.6 24 11.6C23.12 11.6 22.4 10.88 22.4 10C22.4 9.12 23.12 8.4 24 8.4C24.88 8.4 25.6 9.12 25.6 10Z", fill: .brand, stroke: nil),
      .init(path: "M47 19.5C47 21.99 45.66 24 44 24C42.34 24 41 21.99 41 19.5C41 17.01 42.34 15 44 15C45.66 15 47 17.01 47 19.5Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M49.21 25.46C46.84 26.23 44.51 25.58 44 24C43.49 22.42 44.99 20.52 47.35 19.76C49.72 18.99 52.05 19.64 52.56 21.22C53.07 22.79 51.57 24.69 49.21 25.46Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M44.22 29.4C42.76 27.39 42.66 24.97 44 24C45.34 23.03 47.61 23.87 49.07 25.88C50.53 27.89 50.63 30.31 49.29 31.28C47.95 32.26 45.68 31.41 44.22 29.4Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M38.93 25.88C40.39 23.87 42.66 23.03 44 24C45.34 24.97 45.24 27.39 43.78 29.4C42.32 31.41 40.05 32.26 38.71 31.28C37.37 30.31 37.47 27.89 38.93 25.88Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M40.65 19.76C43.01 20.52 44.51 22.42 44 24C43.49 25.58 41.16 26.23 38.79 25.46C36.43 24.69 34.93 22.79 35.44 21.22C35.95 19.64 38.28 18.99 40.65 19.76Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M45.6 24C45.6 24.88 44.88 25.6 44 25.6C43.12 25.6 42.4 24.88 42.4 24C42.4 23.12 43.12 22.4 44 22.4C44.88 22.4 45.6 23.12 45.6 24Z", fill: .brand, stroke: nil),
      .init(path: "M29 27.5C29 29.99 27.66 32 26 32C24.34 32 23 29.99 23 27.5C23 25.01 24.34 23 26 23C27.66 23 29 25.01 29 27.5Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M31.21 33.46C28.84 34.23 26.51 33.58 26 32C25.49 30.42 26.99 28.52 29.35 27.76C31.72 26.99 34.05 27.64 34.56 29.22C35.07 30.79 33.57 32.69 31.21 33.46Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M26.22 37.4C24.76 35.39 24.66 32.97 26 32C27.34 31.03 29.61 31.87 31.07 33.88C32.53 35.89 32.63 38.31 31.29 39.28C29.95 40.26 27.68 39.41 26.22 37.4Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M20.93 33.88C22.39 31.87 24.66 31.03 26 32C27.34 32.97 27.24 35.39 25.78 37.4C24.32 39.41 22.05 40.26 20.71 39.28C19.37 38.31 19.47 35.89 20.93 33.88Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M22.65 27.76C25.01 28.52 26.51 30.42 26 32C25.49 33.58 23.16 34.23 20.79 33.46C18.43 32.69 16.93 30.79 17.44 29.22C17.95 27.64 20.28 26.99 22.65 27.76Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M27.6 32C27.6 32.88 26.88 33.6 26 33.6C25.12 33.6 24.4 32.88 24.4 32C24.4 31.12 25.12 30.4 26 30.4C26.88 30.4 27.6 31.12 27.6 32Z", fill: .brand, stroke: nil),
      .init(path: "M63 35.5C63 37.99 61.66 40 60 40C58.34 40 57 37.99 57 35.5C57 33.01 58.34 31 60 31C61.66 31 63 33.01 63 35.5Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M65.21 41.46C62.84 42.23 60.51 41.58 60 40C59.49 38.42 60.99 36.52 63.35 35.76C65.72 34.99 68.05 35.64 68.56 37.22C69.07 38.79 67.57 40.69 65.21 41.46Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M60.22 45.4C58.76 43.39 58.66 40.97 60 40C61.34 39.03 63.61 39.87 65.07 41.88C66.53 43.89 66.63 46.31 65.29 47.28C63.95 48.26 61.68 47.41 60.22 45.4Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M54.93 41.88C56.39 39.87 58.66 39.03 60 40C61.34 40.97 61.24 43.39 59.78 45.4C58.32 47.41 56.05 48.26 54.71 47.28C53.37 46.31 53.47 43.89 54.93 41.88Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M56.65 35.76C59.01 36.52 60.51 38.42 60 40C59.49 41.58 57.16 42.23 54.79 41.46C52.43 40.69 50.93 38.79 51.44 37.22C51.95 35.64 54.28 34.99 56.65 35.76Z", fill: .brandSoft, stroke: .brand),
      .init(path: "M61.6 40C61.6 40.88 60.88 41.6 60 41.6C59.12 41.6 58.4 40.88 58.4 40C58.4 39.12 59.12 38.4 60 38.4C60.88 38.4 61.6 39.12 61.6 40Z", fill: .brand, stroke: nil),
    ]
    // SeasonScene season="summer"
    case .seasonSummer: [
      .init(path: "M97 20C97 24.97 92.97 29 88 29C83.03 29 79 24.97 79 20C79 15.03 83.03 11 88 11C92.97 11 97 15.03 97 20Z", fill: .sheet, stroke: .gold),
      .init(path: "M88 4L88 7M72 20L75 20M101 20L104 20M76.7 8.7L78.8 10.8M99.3 8.7L97.2 10.8", fill: nil, stroke: .gold),
      .init(path: "M0 64L0 48C8 42 16 42 24 48C32 54 40 54 48 48C56 42 64 42 72 48C80 54 88 54 96 48C104 42 112 42 120 48L120 64Z", fill: .infoSoft, stroke: .accent),
      .init(path: "M14 40C20 36 26 36 32 40", fill: nil, stroke: .accent),
    ]
    // SeasonScene season="autumn"
    case .seasonAutumn: [
      .init(path: "M0 64C18 50 44 44 68 50C92 56 106 56 120 48L120 64Z", fill: .artGround, stroke: nil),
      .init(path: "M4 10C30 10 56 18 80 30C104 42 108 44 116 44", fill: nil, stroke: .inkSoft),
      .init(path: "M48 14C52 6 60 4 66 7C62 15 54 17 48 14Z", fill: .mossSoft, stroke: .moss),
      .init(path: "M36 14L36 20M76 28L76 34", fill: nil, stroke: .inkSoft),
      .init(path: "M43.7 31.4C43.7 35.07 40.25 38.05 36 38.05C31.75 38.05 28.3 35.07 28.3 31.4C28.3 27.73 31.75 24.75 36 24.75C40.25 24.75 43.7 27.73 43.7 31.4Z", fill: .kakiSoft, stroke: .kaki),
      .init(path: "M30.4 25.8C32.5 23.7 33.9 23.7 36 25.1C38.1 23.7 39.5 23.7 41.6 25.8C39.5 27.2 38.1 27.2 36 26.5C33.9 27.2 32.5 27.2 30.4 25.8ZM36 25.1L36 22.3", fill: .mossSoft, stroke: .moss),
      .init(path: "M84.8 45.6C84.8 49.8 80.86 53.2 76 53.2C71.14 53.2 67.2 49.8 67.2 45.6C67.2 41.4 71.14 38 76 38C80.86 38 84.8 41.4 84.8 45.6Z", fill: .kakiSoft, stroke: .kaki),
      .init(path: "M69.6 39.2C72 36.8 73.6 36.8 76 38.4C78.4 36.8 80 36.8 82.4 39.2C80 40.8 78.4 40.8 76 40C73.6 40.8 72 40.8 69.6 39.2ZM76 38.4L76 35.2", fill: .mossSoft, stroke: .moss),
    ]
    // SeasonScene season="winter"
    case .seasonWinter: [
      .init(path: "M0 64C18 50 44 44 68 50C92 56 106 56 120 48L120 64Z", fill: .sheet, stroke: nil),
      .init(path: "M0 64C18 50 44 44 68 50C92 56 106 56 120 48", fill: nil, stroke: .lineStrong),
      .init(path: "M92 50L100 24L108 50Z", fill: .mossSoft, stroke: .moss),
      .init(path: "M100 50L100 56", fill: nil, stroke: .moss),
      .init(path: "M24 12L24 24", fill: nil, stroke: .accent),
      .init(path: "M29.2 15L18.8 21", fill: nil, stroke: .accent),
      .init(path: "M29.2 21L18.8 15", fill: nil, stroke: .accent),
      .init(path: "M56 4L56 16", fill: nil, stroke: .accent),
      .init(path: "M61.2 7L50.8 13", fill: nil, stroke: .accent),
      .init(path: "M61.2 13L50.8 7", fill: nil, stroke: .accent),
      .init(path: "M44 28L44 40", fill: nil, stroke: .accent),
      .init(path: "M49.2 31L38.8 37", fill: nil, stroke: .accent),
      .init(path: "M49.2 37L38.8 31", fill: nil, stroke: .accent),
    ]
    }
  }
}

/// 挿絵の色の役割（テーマの変数）。
public enum ArtColor: String, CaseIterable, Sendable {
  case accent
  case artGround
  case attention
  case attentionSoft
  case brand
  case brandSoft
  case gold
  case infoSoft
  case inkSoft
  case kaki
  case kakiSoft
  case lineStrong
  case moss
  case mossSoft
  case paperDeep
  case sheet

  public func rgba(in colors: ThemeColors) -> RGBA {
    switch self {
    case .accent: colors.accent
    case .artGround: colors.artGround
    case .attention: colors.attention
    case .attentionSoft: colors.attentionSoft
    case .brand: colors.brand
    case .brandSoft: colors.brandSoft
    case .gold: colors.gold
    case .infoSoft: colors.infoSoft
    case .inkSoft: colors.inkSoft
    case .kaki: colors.kaki
    case .kakiSoft: colors.kakiSoft
    case .lineStrong: colors.lineStrong
    case .moss: colors.moss
    case .mossSoft: colors.mossSoft
    case .paperDeep: colors.paperDeep
    case .sheet: colors.sheet
    }
  }
}
