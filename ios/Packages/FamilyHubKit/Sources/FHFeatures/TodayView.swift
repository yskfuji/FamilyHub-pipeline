import SwiftUI
import FHModel
import FHDomain
import FHDesign

/// 今日の画面（Web の src/features/today/TodayPage.tsx）。中身の計算は FHDomain の TodayDigest（Web の todayDigest と同じ答え）。
struct TodayView: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  let open: (ShellTab) -> Void
  @State private var width: CGFloat = 0

  enum Block: String { case next, timeline, due, weather, budget }
  enum Layout { case narrow, medium, wide }

  /// 本文の幅で決める3つの段階（Web の sizeClass.ts と同じ境目: 600 と 1100）。
  private var layout: Layout { width < 600 ? .narrow : width < 1100 ? .medium : .wide }

  var body: some View {
    let colors = theme.colors
    ScrollView {
      if let snapshot = model.snapshot {
        content(snapshot)
          .padding(TokenSpace.space4)
          .frame(maxWidth: 1280)
          .frame(maxWidth: .infinity)
      } else if model.loading {
        VStack(spacing: TokenSpace.space3) {
          ProgressView()
          Text("今日の予定とタスクを読み込んでいます。").foregroundStyle(colors.inkSoft.color)
        }
        .padding(TokenSpace.space6)
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    .background(colors.paper.color.ignoresSafeArea())
    .refreshable { await model.refresh() }
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot) -> some View {
    let scoped = MemberScope.scoped(snapshot, scope: preferences.memberScope)
    let digest = TodayDigest(snapshot: snapshot, scoped: scoped)
    let title = "\(digest.greeting)、\(snapshot.user.displayName)さん"
    VStack(alignment: .leading, spacing: TokenSpace.space5) {
      if let error = model.error { ErrorBanner(error: error) }
      header(snapshot, digest: digest, title: title)
      if digest.empty {
        EmptyStateView(title: "今日の予定やタスクはありません", message: "共有された予定やタスクが追加されると、時刻順に表示されます。", illustration: .emptyEvents)
      } else {
        blocks(snapshot, digest: digest)
      }
    }
  }

  private func header(_ snapshot: HouseholdSnapshot, digest: TodayDigest, title: String) -> some View {
    let colors = theme.colors
    return VStack(alignment: .leading, spacing: TokenSpace.space3) {
      HStack(alignment: .top, spacing: TokenSpace.space3) {
        VStack(alignment: .leading, spacing: TokenSpace.space1) {
          Eyebrow("今日 · \(Self.monthDay(snapshot.context.asOf))")
          Text(title).font(.title.weight(.bold)).fontDesign(.serif).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
            .fixedSize(horizontal: false, vertical: true)
          Text("確認が必要な予定やタスクから順に表示しています。").font(.callout).foregroundStyle(colors.inkSoft.color)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        IllustrationView(Self.scene(Season(dateOrMonthKey: digest.today)), lineWidth: 1.75).frame(width: 96)
      }
      // 狭い幅では縦に積む（Web の .page-head-actions も折り返す）。
      if layout == .narrow {
        VStack(alignment: .leading, spacing: TokenSpace.space2) {
          MemberScopePicker(snapshot: snapshot)
          SyncStatusView(snapshot: snapshot, stacked: true)
        }
      } else {
        HStack(spacing: TokenSpace.space3) {
          MemberScopePicker(snapshot: snapshot)
          Spacer(minLength: 0)
          SyncStatusView(snapshot: snapshot)
        }
      }
    }
  }

  static func scene(_ season: Season) -> Illustration {
    switch season {
    case .spring: .seasonSpring
    case .summer: .seasonSummer
    case .autumn: .seasonAutumn
    case .winter: .seasonWinter
    }
  }

  /// 9月30日（Web の monthDay）。
  static func monthDay(_ asOf: String) -> String {
    guard let date = Tokyo.parse(asOf) else { return "" }
    let day = Tokyo.components(of: date).date
    return "\(day.month)月\(day.day)日"
  }

  /// 段階ごとの並び（Web の layouts）。読む順と見た目の順は同じ。
  @ViewBuilder
  private func blocks(_ snapshot: HouseholdSnapshot, digest: TodayDigest) -> some View {
    let shown: (Block) -> Bool = { $0 != .budget || model.can(.expenseRead) }
    let columns: [[Block]] = switch layout {
    case .narrow: [[.next, .timeline, .due, .weather, .budget]]
    case .medium: [[.next, .timeline], [.due], [.weather, .budget]]
    case .wide: [[.next, .weather], [.timeline], [.due, .budget]]
    }
    let visible = columns.map { $0.filter(shown) }.filter { !$0.isEmpty }
    let order = visible.flatMap { $0 }
    let number: (Block) -> String = { String(format: "%02d", (order.firstIndex(of: $0) ?? 0) + 1) }
    switch layout {
    case .narrow:
      VStack(spacing: TokenSpace.space4) { ForEach(order, id: \.self) { block($0, snapshot, digest, number) } }
    case .medium:
      VStack(spacing: TokenSpace.space4) {
        ForEach(visible.first ?? [], id: \.self) { block($0, snapshot, digest, number) }
        HStack(alignment: .top, spacing: TokenSpace.space4) {
          ForEach(Array(visible.dropFirst().enumerated()), id: \.offset) { _, column in
            VStack(spacing: TokenSpace.space4) { ForEach(column, id: \.self) { block($0, snapshot, digest, number) } }
          }
        }
      }
    case .wide:
      HStack(alignment: .top, spacing: TokenSpace.space4) {
        ForEach(Array(visible.enumerated()), id: \.offset) { _, column in
          VStack(spacing: TokenSpace.space4) { ForEach(column, id: \.self) { block($0, snapshot, digest, number) } }
        }
      }
    }
  }

  @ViewBuilder
  private func block(_ block: Block, _ snapshot: HouseholdSnapshot, _ digest: TodayDigest, _ number: (Block) -> String) -> some View {
    switch block {
    case .next: NextCard(snapshot: snapshot, digest: digest, number: number(.next), open: open)
    case .timeline: TimelineCard(snapshot: snapshot, digest: digest, number: number(.timeline), open: open)
    case .due: DueCard(snapshot: snapshot, digest: digest, number: number(.due), open: open)
    case .weather: WeatherCard(weather: snapshot.context.weather, number: number(.weather))
    case .budget: BudgetCard(digest: digest, number: number(.budget), open: open)
    }
  }
}

/// 使っている途中の失敗（Web の .callout role=alert）。最後に取れた内容は残す。
struct ErrorBanner: View {
  @Environment(AppModel.self) private var model
  let error: GatewayError
  var body: some View {
    Callout(systemImage: "exclamationmark.triangle", title: error.message, detail: error.code == .unauthenticated ? "本人確認が終わるまで、家族の情報は表示しません。" : "最後に取得できた情報を表示しています。") {
      if error.retryable { Button("もう一度試す") { Task { await model.refresh() } }.fhButton(.secondary) }
    }
  }
}

/// 表示する人（Web の MemberScopeSelect）。選んだ人は端末に覚える。
struct MemberScopePicker: View {
  @Environment(Preferences.self) private var preferences
  let snapshot: HouseholdSnapshot
  var body: some View {
    @Bindable var preferences = preferences
    let viewer = snapshot.viewer.membershipId
    let choices = MemberScope.choices(viewerId: viewer, memberships: snapshot.memberships)
    let shown = Binding(
      get: { MemberScope.shown(preferences.memberScope, viewerId: viewer, memberships: snapshot.memberships) },
      set: { preferences.memberScope = $0 }
    )
    let current = choices.first { $0.value == shown.wrappedValue }?.label ?? "すべて"
    Menu {
      Picker("表示する人", selection: shown) {
        ForEach(choices) { Text($0.label).tag($0.value) }
      }
    } label: {
      HStack(spacing: TokenSpace.space2) {
        Image(systemName: "person.2").accessibilityHidden(true)
        Text("表示する人：\(current)").fixedSize(horizontal: false, vertical: true)
        Image(systemName: "chevron.up.chevron.down").imageScale(.small).accessibilityHidden(true)
      }
      .font(.callout.weight(.semibold))
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
  }
}

/// 最後に更新した時刻と、今すぐ読み直す操作（Web の SyncStatus）。
struct SyncStatusView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let snapshot: HouseholdSnapshot
  /// 狭い幅では、印とボタンを縦に積む（文字を大きくしても切れないように）。
  var stacked = false
  @State private var failed = false

  var body: some View {
    let sync = snapshot.context.sync
    let running = model.refreshing || sync.state == "syncing"
    VStack(alignment: .leading, spacing: TokenSpace.space1) {
      if stacked {
        VStack(alignment: .leading, spacing: TokenSpace.space2) { badge(running: running, sync: sync); refreshButton(running: running) }
      } else {
        HStack(spacing: TokenSpace.space2) { badge(running: running, sync: sync); refreshButton(running: running) }
      }
      if failed { Text("更新できませんでした。接続を確認して、もう一度お試しください。").font(.caption.weight(.bold)).foregroundStyle(theme.colors.danger.color) }
    }
  }

  @ViewBuilder private func badge(running: Bool, sync: FHModel.SyncStatus) -> some View {
    if running { StatusBadge("更新しています", tone: .attention) }
    else if sync.state == "offline" { StatusBadge("オフライン（最終更新 \(Format.time(sync.lastSyncedAt))）", tone: .attention) }
    else { StatusBadge("最終更新 \(Format.due(sync.lastSyncedAt, asOf: snapshot.context.asOf))", tone: .success) }
  }

  private func refreshButton(running: Bool) -> some View {
    Button(failed ? "もう一度更新" : "今すぐ更新") {
      Task {
        let done = await model.refresh()
        failed = !done
        if done { model.announce("最新の内容に更新しました。") }
      }
    }
    .fhButton(.secondary)
    .disabled(running)
  }
}

/// 一覧の1行（Web の .list-row）。
struct TodayRow<Leading: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  let meta: String
  var past = false
  var openLabel: String
  let action: () -> Void
  @ViewBuilder var leading: Leading

  var body: some View {
    let colors = theme.colors
    HStack(alignment: .center, spacing: TokenSpace.space3) {
      leading
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.body.weight(.bold)).foregroundStyle(colors.ink.color)
        Text(meta).font(.caption.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
      }
      Spacer(minLength: TokenSpace.space2)
      Button("開く", action: action).fhButton(.secondary).accessibilityLabel(openLabel)
    }
    .opacity(past ? 0.62 : 1)
    .padding(.vertical, TokenSpace.space1)
  }
}

struct NextCard: View {
  @Environment(\.theme) private var theme
  let snapshot: HouseholdSnapshot
  let digest: TodayDigest
  let number: String
  let open: (ShellTab) -> Void
  /// そのタスクを開く（タスクの画面が受け取る）。
  @Environment(AppModel.self) private var focusModel
  private func openTask(_ id: Id) { focusModel.focus = .task(id); open(.tasks) }

  var body: some View {
    let me = snapshot.viewer.membershipId
    let name = { (id: Id?) in memberName(snapshot.memberships, id) }
    Card(accent: digest.attention > 0) {
      SectionHeader(eyebrow: "\(number) · \(digest.attention > 0 ? "要確認" : "次の予定")", title: "次にすること") {
        if digest.attention > 0 { StatusBadge("\(digest.attention)件", tone: .attention) }
      }
      if digest.attention + (digest.upcoming != nil || digest.nextTask != nil ? 1 : 0) == 0 {
        EmptyStateView(title: "今日することは全部済みました", message: "新しい予定やタスクが追加されると、ここに表示します。", illustration: .emptyDone, compact: true)
      } else {
        VStack(spacing: TokenSpace.space3) {
          if let review = digest.reviewTodo {
            Callout(systemImage: "exclamationmark.triangle", title: review.reviewerMembershipId == me ? "確認を頼まれたタスクがあります" : "確認待ちのタスクがあります", detail: "\(review.title) · 担当：\(name(review.assigneeMembershipId)) · 確認する人：\(name(review.reviewerMembershipId))") {
              Button { openTask(review.id) } label: { Label("タスクを確認", systemImage: "arrow.right") }.fhButton(.secondary)
            }
          }
          if digest.showWeather, let first = digest.affected.first {
            Callout(systemImage: "cloud.rain", title: snapshot.context.weather.alert ?? "", detail: "今日の「\(first.event.title)」\(digest.affected.count > 1 ? "など\(digest.affected.count)件" : "")に影響する可能性があります", tone: .info) {
              Button { open(.calendar) } label: { Label("予定を開く", systemImage: "arrow.right") }.fhButton(.secondary)
            }
          }
          if let upcoming = digest.upcoming {
            Callout(systemImage: "clock", title: "\(Format.time(upcoming.at)) \(upcoming.title)", detail: "次の\(upcoming.kind.rawValue) · \(upcoming.meta)", tone: .plain) {
              Button { upcoming.kind == .event ? open(.calendar) : openTask(upcoming.targetId) } label: { Label("開く", systemImage: "arrow.right") }
                .fhButton(.secondary)
                .accessibilityLabel("次の\(upcoming.kind.rawValue)「\(upcoming.title)」を開く")
            }
          }
          if let next = digest.nextTask {
            Callout(systemImage: "checkmark.circle", title: next.title, detail: "次のタスク · 期限 \(Format.due(next.dueAt, asOf: snapshot.context.asOf))", tone: .plain) {
              Button { openTask(next.id) } label: { Label("開く", systemImage: "arrow.right") }
                .fhButton(.secondary)
                .accessibilityLabel("次のタスク「\(next.title)」を開く")
            }
          }
        }
      }
    }
  }
}

struct TimelineCard: View {
  @Environment(\.theme) private var theme
  let snapshot: HouseholdSnapshot
  let digest: TodayDigest
  let number: String
  let open: (ShellTab) -> Void
  /// そのタスクを開く（タスクの画面が受け取る）。
  @Environment(AppModel.self) private var focusModel
  private func openTask(_ id: Id) { focusModel.focus = .task(id); open(.tasks) }

  var body: some View {
    let asOf = TodayDigest.milliseconds(snapshot.context.asOf)
    Card {
      SectionHeader(eyebrow: "\(number) · 今日の予定とタスク", title: "時刻順に確認") {
        Button("カレンダーへ") { open(.calendar) }.fhLink()
      }
      if digest.timeline.isEmpty {
        Text("今日の予定と期限のタスクはありません。").foregroundStyle(theme.colors.inkSoft.color)
      } else {
        TimeStripView(digest: digest)
        VStack(spacing: 0) {
          ForEach(digest.timeline) { item in
            TodayRow(title: item.title, meta: "\(item.kind.rawValue) · \(item.meta)", past: TodayDigest.milliseconds(item.at) + item.minutes * 60_000 < asOf, openLabel: "\(item.title)を開く", action: { item.kind == .event ? open(.calendar) : openTask(item.targetId) }) {
              Text(Format.time(item.at)).font(.callout.weight(.bold)).monospacedDigit().foregroundStyle(theme.colors.inkSoft.color).frame(minWidth: 48, alignment: .leading)
            }
            if item.id != digest.timeline.last?.id { Divider().overlay(theme.colors.line.color) }
          }
        }
      }
    }
  }
}

/// 時刻の帯（Web の TimeStrip）。同じ内容は下の一覧が文で伝えるので、読み上げない。
struct TimeStripView: View {
  @Environment(\.theme) private var theme
  let digest: TodayDigest

  var body: some View {
    let colors = theme.colors
    let layout = digest.strip
    let laneHeight: CGFloat = 16
    VStack(spacing: TokenSpace.space1) {
      GeometryReader { proxy in
        let width = proxy.size.width
        ZStack(alignment: .topLeading) {
          RoundedRectangle(cornerRadius: TokenRadius.radiusSm).fill(colors.paperDeep.color)
          ForEach(Array(digest.timeline.enumerated()), id: \.element.id) { index, item in
            let start = Double(TodayDigest.minutesOfDay(item.at))
            let lane = CGFloat(layout.lanes[safe: index] ?? 0)
            let past = start + item.minutes < Double(digest.now)
            let x = width * layout.position(start)
            if item.kind == .task {
              Circle().fill((past ? colors.lineStrong : colors.brand).color)
                .overlay(Circle().stroke(colors.sheet.color, lineWidth: 2))
                .frame(width: 12, height: 12)
                .offset(x: x - 6, y: 4 + lane * laneHeight)
            } else {
              let span = min(item.minutes, Double(layout.to) - start) / Double(layout.to - layout.from)
              Capsule().fill((past ? colors.lineStrong : colors.accentStrong).color)
                .frame(width: max(12, width * span), height: 12)
                .offset(x: x, y: 4 + lane * laneHeight)
            }
          }
          let now = Double(digest.now)
          if now >= Double(layout.from), now <= Double(layout.to) {
            Capsule().fill(colors.danger.color).frame(width: 2).padding(.vertical, -4).offset(x: width * layout.position(now) - 1)
          }
        }
      }
      .frame(height: CGFloat(layout.laneCount) * laneHeight + 4)
      // 目盛り。最初の目盛りは左の端にそろえ、ほかは中心を合わせる（Web の .time-strip-ticks）。
      Canvas { context, size in
        for (index, minute) in layout.ticks.enumerated() {
          let label = context.resolve(Text("\(minute / 60)時").font(.caption2).monospacedDigit().foregroundStyle(colors.inkSoft.color))
          context.draw(label, at: CGPoint(x: size.width * layout.position(Double(minute)), y: 0), anchor: index == 0 ? .topLeading : .top)
        }
      }
      .frame(height: 18)
    }
    .accessibilityHidden(true)
  }
}

extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

struct DueCard: View {
  @Environment(\.theme) private var theme
  let snapshot: HouseholdSnapshot
  let digest: TodayDigest
  let number: String
  let open: (ShellTab) -> Void
  /// そのタスクを開く（タスクの画面が受け取る）。
  @Environment(AppModel.self) private var focusModel
  private func openTask(_ id: Id) { focusModel.focus = .task(id); open(.tasks) }

  var body: some View {
    let asOf = snapshot.context.asOf
    Card {
      SectionHeader(eyebrow: "\(number) · 期限 · 自分の担当", title: "\(snapshot.user.displayName)さんのタスク") { Metric("\(digest.mine.count)") }
      if digest.mine.isEmpty {
        Text("担当している未完了のタスクはありません。").foregroundStyle(theme.colors.inkSoft.color)
      } else {
        VStack(spacing: 0) {
          ForEach(digest.mine) { todo in
            let overdue = todo.dueAt.map { TodayDigest.milliseconds($0) < TodayDigest.milliseconds(asOf) } ?? false
            let reviewer = todo.reviewerMembershipId.map { " · 確認する人 \(memberName(snapshot.memberships, $0))" } ?? ""
            TodayRow(title: todo.title, meta: "\(overdue ? "期限切れ · " : "")\(Format.due(todo.dueAt, asOf: asOf))\(reviewer)", openLabel: "\(todo.title)を開く", action: { openTask(todo.id) }) {
              Image(systemName: overdue ? "exclamationmark.circle" : "checkmark.circle").foregroundStyle((overdue ? theme.colors.danger : theme.colors.inkSoft).color).accessibilityHidden(true)
            }
            if todo.id != digest.mine.last?.id { Divider().overlay(theme.colors.line.color) }
          }
        }
      }
    }
  }
}

struct WeatherCard: View {
  @Environment(\.theme) private var theme
  let weather: Weather
  let number: String

  var body: some View {
    let colors = theme.colors
    let title = switch weather.condition { case "rain": "雨と予定"; case "storm": "荒天と予定"; default: "天気と予定" }
    Card {
      SectionHeader(eyebrow: "\(number) · 天気", title: title) {
        Image(systemName: weather.condition == .sunny ? "sun.max" : "cloud.rain").font(.title).foregroundStyle(colors.inkSoft.color).accessibilityHidden(true)
      }
      HStack(alignment: .top, spacing: TokenSpace.space5) {
        VStack(alignment: .leading) { Metric("\(ShellToolbar.number(weather.precipitationPercent))%"); Text("降水確率").font(.caption.weight(.semibold)).foregroundStyle(colors.inkSoft.color) }
        VStack(alignment: .leading) { Metric("\(ShellToolbar.number(weather.temperatureC))℃"); Text("予想気温（\(weather.location)）").font(.caption.weight(.semibold)).foregroundStyle(colors.inkSoft.color) }
      }
      VStack(alignment: .leading, spacing: 2) {
        Text("予定は自動で変更しません").font(.callout.weight(.bold)).foregroundStyle(colors.ink.color)
        Text("天気予報と、影響する可能性がある予定を表示します。").font(.footnote).foregroundStyle(colors.inkSoft.color)
      }
    }
  }
}

struct BudgetCard: View {
  @Environment(\.theme) private var theme
  let digest: TodayDigest
  let number: String
  let open: (ShellTab) -> Void

  var body: some View {
    let colors = theme.colors
    Card {
      SectionHeader(eyebrow: "\(number) · 家計の一目", title: "未精算の合計") {
        StatusBadge("\(digest.unsettled.count)件", tone: digest.unsettled.count > 0 ? .attention : .success)
      }
      Metric(Format.yen(digest.unsettled.totalJpy))
      Text("今月の支出 \(Format.yen(digest.spentThisMonth.totalJpy))（\(digest.spentThisMonth.count)件）").font(.caption.weight(.semibold)).foregroundStyle(colors.inkSoft.color)
      Text("記録済みの支出から計算しています。支払う相手と金額を確認できます。").font(.callout).foregroundStyle(colors.inkSoft.color)
      Button("内訳と精算を確認") { open(.budget) }.fhButton(.secondary, fullWidth: true)
    }
  }
}
