import SwiftUI
import FHModel
import FHDomain
import FHCopy
import FHDesign

/// 主な機能（Web の Shell の primary）。capability がない人には出さない。
enum ShellTab: String, Hashable, CaseIterable, Identifiable {
  case today, calendar, tasks, notes, budget, albums, places, insights, settings
  var id: String { rawValue }

  var label: String {
    let navigation = Copy.ja.ja.navigation.self
    return switch self {
    case .today: navigation.today
    case .calendar: navigation.calendar
    case .tasks: navigation.tasks
    case .notes: navigation.notes
    case .budget: navigation.budget
    case .albums: navigation.albums
    case .places: navigation.places
    case .insights: navigation.insights
    case .settings: navigation.settings
    }
  }

  var systemImage: String {
    switch self {
    case .today: "house"
    case .calendar: "calendar"
    case .tasks: "checkmark.circle"
    case .notes: "note.text"
    case .budget: "yensign.circle"
    case .albums: "photo.on.rectangle"
    case .places: "mappin.and.ellipse"
    case .insights: "sparkles"
    case .settings: "gearshape"
    }
  }

  var capability: Capability? {
    switch self {
    case .today: nil
    case .calendar: .eventRead
    case .tasks: .taskRead
    case .notes: .memoRead
    case .budget: .expenseRead
    case .albums: .albumRead
    case .places: .placeRead
    case .insights: .insightRead
    case .settings: .settingsOwn
    }
  }

  /// この画面を作る段階（docs/ios/README.md の「段階」）。
  var plannedStage: String? {
    switch self {
    case .today: nil
    case .calendar: "S2"
    case .tasks, .notes: "S3"
    case .budget: "S4"
    case .albums: "S5"
    case .places, .insights: "S6"
    case .settings: "S7"
    }
  }

  var emptyIllustration: Illustration {
    switch self {
    case .today, .calendar: .emptyEvents
    case .tasks: .emptyTasks
    case .notes: .emptyMemos
    case .budget: .emptyBudget
    case .albums: .emptyAlbums
    case .places: .emptyPlaces
    case .insights, .settings: .emptySearch
    }
  }
}

/// 画面の枠。iPhone は下のタブ（今日・予定・タスク・メモ・その他）、iPad は横の一覧にすべての機能を並べる。
struct ShellView: View {
  /// 下のタブの選択。「その他」の中の画面は、その他のタブの中で開く。
  enum Selection: Hashable { case tab(ShellTab), more }

  @Environment(AppModel.self) private var model
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var selection: Selection = .tab(.today)
  @State private var morePath: [ShellTab] = []

  private var available: [ShellTab] { ShellTab.allCases.filter { $0.capability.map(model.can) ?? true } }
  /// 下のタブに置く4つ（Web の mobilePrimary と同じ選び方）。
  private var primary: [ShellTab] { Array(available.filter { [.today, .calendar, .tasks, .notes, .budget].contains($0) }.prefix(4)) }
  private var overflow: [ShellTab] { available.filter { !primary.contains($0) } }
  private var openTasks: Int {
    guard model.can(.taskRead), let snapshot = model.snapshot else { return 0 }
    // Web の filterTasks(todos, 'open') と同じ: 未完了（open・doing・review・waiting）の数。担当は問わない。
    let unfinished: Set<TodoStatus> = [.open, .doing, .review, .waiting]
    return snapshot.todos.filter { unfinished.contains($0.status) }.count
  }

  var body: some View {
    if sizeClass == .compact {
      TabView(selection: $selection) {
        ForEach(primary) { tab in
          Tab(tab.label, systemImage: tab.systemImage, value: Selection.tab(tab)) { ShellScreen(tab: tab, open: open) }
            .badge(tab == .tasks ? openTasks : 0)
        }
        Tab(Copy.ja.ja.navigation.more, systemImage: "ellipsis.circle", value: Selection.more) {
          MoreView(items: overflow, path: $morePath, open: open)
        }
      }
      .onChange(of: model.snapshot?.viewer.capabilities) { _, _ in
        if case .tab(let tab) = selection, !primary.contains(tab) { selection = .tab(.today) }
        morePath.removeAll { !overflow.contains($0) }
      }
    } else {
      TabView(selection: $selection) {
        ForEach(available) { tab in
          Tab(tab.label, systemImage: tab.systemImage, value: Selection.tab(tab)) { ShellScreen(tab: tab, open: open) }
            .badge(tab == .tasks ? openTasks : 0)
        }
      }
      .tabViewStyle(.sidebarAdaptable)
      .onChange(of: model.snapshot?.viewer.capabilities) { _, _ in
        if case .tab(let tab) = selection, !available.contains(tab) { selection = .tab(.today) }
      }
    }
  }

  /// 今日の画面の「開く」などから、ほかの機能の画面へ移る。iPhone で「その他」の中にある画面は、その他のタブの中で開く。
  private func open(_ tab: ShellTab) {
    guard available.contains(tab) else { return }
    if sizeClass == .compact, overflow.contains(tab) {
      morePath = [tab]
      selection = .more
    } else {
      selection = .tab(tab)
    }
  }
}

/// 「その他」の一覧（Web の Drawer の more-list）。
struct MoreView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  let items: [ShellTab]
  @Binding var path: [ShellTab]
  let open: (ShellTab) -> Void

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section {
          ForEach(items) { item in
            NavigationLink(value: item) { Label(item.label, systemImage: item.systemImage) }
          }
        }
        if let snapshot = model.snapshot {
          Section {
            VStack(alignment: .leading, spacing: 2) {
              Text(snapshot.household.name).font(.headline)
              Text("\(snapshot.user.displayName) · \(roleLabel(snapshot.viewer.role))").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
            }
            .accessibilityElement(children: .combine)
          }
        }
      }
      .navigationTitle(Copy.ja.ja.navigation.more)
      .navigationDestination(for: ShellTab.self) { item in ShellContent(tab: item, open: open).shellChrome(title: item.label) }
      .shellToolbar()
    }
  }
}

func roleLabel(_ role: MembershipRole) -> String {
  let roles = Copy.ja.ja.roles.self
  return switch role {
  case .owner: roles.owner
  case .adult: roles.adult
  case .child: roles.child
  case .guest: roles.guest
  default: role.rawValue
  }
}

/// タブごとの画面。NavigationStack と上部をつける。
struct ShellScreen: View {
  let tab: ShellTab
  let open: (ShellTab) -> Void
  var body: some View {
    NavigationStack { ShellContent(tab: tab, open: open).shellChrome(title: tab.label) }
  }
}

struct ShellContent: View {
  let tab: ShellTab
  let open: (ShellTab) -> Void
  var body: some View {
    switch tab {
    case .today: TodayView(open: open)
    case .settings: InterimSettingsView()
    default: PlannedScreen(tab: tab)
    }
  }
}

extension View {
  func shellChrome(title: String) -> some View {
    self.navigationTitle(title).inlineNavigationTitle().shellToolbar()
  }

  func shellToolbar() -> some View { modifier(ShellToolbar()) }
}

/// 上部（Web の topbar）。日付と天気、通知、昼と夜の切り替え。
struct ShellToolbar: ViewModifier {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme
  @State private var showNotifications = false

  func body(content: Content) -> some View {
    content
      // 日付と天気は画面の副題に出す（Web の topbar-date）。上部のボタンの中に置くと、文字を大きくしたときに大きくならない。
      .navigationSubtitle(subtitle)
      .toolbar {
        ToolbarItemGroup(placement: .primaryAction) {
          if model.can(.notificationManage) {
            Button { Task { await model.loadNotifications(); showNotifications = true } } label: {
              Image(systemName: model.unreadNotifications > 0 ? "bell.badge" : "bell")
            }
            .accessibilityLabel("通知を確認、未読\(model.unreadNotifications)件")
          }
          Button { preferences.colorMode = theme.isNight ? .day : .night } label: {
            Image(systemName: theme.isNight ? "sun.max" : "moon")
          }
          .accessibilityLabel(theme.isNight ? "明るいテーマに切り替え" : "暗いテーマに切り替え")
        }
      }
      .sheet(isPresented: $showNotifications) { NotificationsView() }
      .task { if !model.notificationsLoaded { await model.loadNotifications() } }
  }

  private var subtitle: String {
    guard let snapshot = model.snapshot else { return "" }
    let weather = snapshot.context.weather
    let date = Self.topbarDate(snapshot.context.asOf)
    return weather.location.isEmpty ? date : "\(date)・\(weather.location) \(Self.number(weather.temperatureC))℃"
  }

  /// 9月30日水曜日（Web の topbarDate と同じ）。
  static func topbarDate(_ asOf: String) -> String {
    guard let date = Tokyo.parse(asOf) else { return "" }
    let day = Tokyo.components(of: date).date
    return "\(day.month)月\(day.day)日\(Tokyo.weekdayLabels[day.weekday])曜日"
  }

  /// JS の String(number)（22 は「22」、22.5 は「22.5」）。
  static func number(_ value: Double) -> String {
    value.rounded() == value && abs(value) < 1e15 ? String(Int(value)) : String(value)
  }
}

/// 通知の一覧（Web の通知のドロワー。止める・30分後は段階 S6 で足す）。
struct NotificationsView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var revealed: Set<Id> = []

  var body: some View {
    let hide = model.privacy?.hideNotificationContent ?? true
    NavigationStack {
      List {
        if let error = model.notificationsError {
          Section {
            Text(error).foregroundStyle(theme.colors.danger.color)
            Button("もう一度読み込む") { Task { await model.loadNotifications() } }
          }
        }
        if model.notifications.isEmpty && model.notificationsError == nil {
          Text("新しい通知はありません。").foregroundStyle(theme.colors.inkSoft.color)
        }
        ForEach(model.notifications) { item in
          VStack(alignment: .leading, spacing: TokenSpace.space2) {
            HStack {
              StatusBadge(item.status == .active ? Format.time(item.remindAt) : statusLabel(item.status), tone: item.status == .stopped ? .neutral : item.status == .snoozed ? .attention : .success)
              if !item.read { StatusBadge(Copy.ja.ja.states.unread, tone: .attention) }
            }
            if hide && !revealed.contains(item.id) {
              Text(item.kind == "todoDue" ? "タスクのお知らせ" : "予定のお知らせ").font(.headline)
              Text("内容は表示しない設定です。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color)
              Button { revealed.insert(item.id) } label: { Label("内容を表示", systemImage: "eye") }.fhButton(.secondary)
            } else {
              Text(item.title).font(.headline)
              Text(item.body).font(.callout).foregroundStyle(theme.colors.inkSoft.color)
            }
            Text("通知予定：\(Format.time(item.remindAt))").font(.caption).foregroundStyle(theme.colors.inkSoft.color)
            if !item.read { Button("既読にする") { Task { await model.markNotificationRead(item.id) } }.fhButton(.secondary) }
          }
          .padding(.vertical, TokenSpace.space2)
        }
      }
      .navigationTitle("通知")
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
    }
  }

  private func statusLabel(_ status: NotificationStatus) -> String {
    let labels = Copy.ja.ja.notificationStatus.self
    return switch status {
    case .snoozed: labels.snoozed
    case .stopped: labels.stopped
    default: labels.active
    }
  }
}

/// まだ作っていない画面。どの段階で作るかを示す。
struct PlannedScreen: View {
  @Environment(\.theme) private var theme
  let tab: ShellTab
  var body: some View {
    ScrollView {
      EmptyStateView(title: "\(tab.label)の画面は、これから作ります", message: "段階 \(tab.plannedStage ?? "") で、Web と同じ中身にします。今は今日の画面とサインインを使えます。", illustration: tab.emptyIllustration)
        .padding(TokenSpace.space5)
    }
    .background(theme.colors.paper.color.ignoresSafeArea())
  }
}

/// 設定の仮の画面（12のタブは段階 S7）。表示・接続先・サインアウト。
struct InterimSettingsView: View {
  @Environment(AppModel.self) private var model
  @Environment(Preferences.self) private var preferences
  @Environment(\.theme) private var theme

  var body: some View {
    @Bindable var preferences = preferences
    Form {
      if let snapshot = model.snapshot {
        Section("アカウント") {
          LabeledContent("名前", value: snapshot.user.displayName)
          LabeledContent("メールアドレス", value: snapshot.user.email)
          LabeledContent("家族グループ", value: snapshot.household.name)
          LabeledContent("役割", value: roleLabel(snapshot.viewer.role))
        }
      }
      Section("表示") {
        Picker("配色", selection: $preferences.palette) {
          ForEach(ThemePalette.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        Picker("昼と夜", selection: $preferences.colorMode) {
          ForEach(ColorMode.allCases, id: \.self) { Text($0.label).tag($0) }
        }
      }
      Section {
        switch model.gateway.mode {
        case .sample: LabeledContent("接続先", value: "見本（森さんち）")
        case .server(let url): LabeledContent("接続先", value: url.host() ?? url.absoluteString)
        }
        Button("接続先を選び直す") { model.onLeave() }
      } footer: {
        Text(model.isSample ? "見本の変更は、この端末の記憶の中だけに残ります。接続先を選び直すと、見本ははじめの状態に戻ります。" : "")
      }
      if !model.isSample {
        Section { Button("サインアウト", role: .destructive) { Task { await model.signOut() } } }
      }
      Section { Text("設定の12のタブ（家族・メンバー・招待・権限・セキュリティなど）は、段階 S7 で作ります。").font(.footnote).foregroundStyle(theme.colors.inkSoft.color) }
    }
  }
}
