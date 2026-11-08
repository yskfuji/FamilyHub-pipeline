import SwiftUI
import FHModel
import FHDomain
import FHDesign

/// 段階 S0 の仮の今日の画面。見本の家族を読み、土台（テーマ・文言・見本の仕組み・書式）がつながっていることを示す。
/// S1 で Web の今日の画面（src/features/today/TodayPage.tsx）と同じ中身に置き換える。
public struct SampleTodayView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme

  public init() {}

  public var body: some View {
    let colors = theme.colors
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: TokenSpace.space5) {
          header
          if let snapshot = model.snapshot {
            content(snapshot)
          } else if let error = model.lastError {
            Text(error.message).foregroundStyle(colors.danger.color)
          } else {
            ProgressView("読み込んでいます。")
          }
        }
        .padding(TokenSpace.space4)
      }
      .background(colors.paper.color)
      .refreshable { await model.refresh() }
      .task { if model.snapshot == nil { await model.refresh() } }
    }
  }

  private var header: some View {
    HStack(spacing: TokenSpace.space3) {
      BrandMark().frame(width: 44, height: 44)
      VStack(alignment: .leading, spacing: 2) {
        Wordmark().frame(height: 22)
        Text("家族の暮らしをひとつに").font(.caption).foregroundStyle(theme.colors.inkSoft.color)
      }
      Spacer()
    }
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot) -> some View {
    let colors = theme.colors
    let asOf = snapshot.context.asOf
    let today = CalendarDate.dateKey(fromRfc3339: asOf) ?? ""
    VStack(alignment: .leading, spacing: TokenSpace.space2) {
      Text("今日 · \(Format.date(asOf))").font(.subheadline.weight(.semibold)).foregroundStyle(colors.brand.color)
      Text("\(snapshot.household.name)の今日").font(.largeTitle.bold()).foregroundStyle(colors.ink.color)
      if !snapshot.context.weather.location.isEmpty {
        Text("\(snapshot.context.weather.location) \(Int(snapshot.context.weather.temperatureC))℃ · 降水 \(Int(snapshot.context.weather.precipitationPercent))%")
          .font(.callout).foregroundStyle(colors.inkSoft.color)
      }
    }

    card(title: "今日の予定") {
      let events = snapshot.events.filter { CalendarDate.dateKey(fromRfc3339: $0.startsAt) == today }
      if events.isEmpty { Text("今日の予定はありません").foregroundStyle(colors.inkSoft.color) }
      ForEach(events) { event in
        HStack(alignment: .firstTextBaseline) {
          Text(Format.time(event.startsAt)).monospacedDigit().foregroundStyle(colors.inkSoft.color)
          Text(event.title).foregroundStyle(colors.ink.color)
          Spacer()
          if let location = event.location { Text(location).font(.caption).foregroundStyle(colors.inkFaint.color) }
        }
      }
    }

    card(title: "\(snapshot.user.displayName)さんのタスク") {
      let mine = snapshot.todos.filter { $0.assigneeMembershipId == snapshot.viewer.membershipId }
      ForEach(mine) { todo in
        HStack {
          Button {
            Task { await model.transition(todo, to: todo.status == .done ? .open : .done) }
          } label: {
            Image(systemName: todo.status == .done ? "checkmark.circle.fill" : "circle")
              .font(.title2)
              .frame(minWidth: 44, minHeight: 44)
          }
          .accessibilityLabel(todo.status == .done ? "「\(todo.title)」を未完了に戻す" : "「\(todo.title)」を完了にする")
          VStack(alignment: .leading) {
            Text(todo.title).strikethrough(todo.status == .done).foregroundStyle(colors.ink.color)
            Text(Format.due(todo.dueAt, asOf: asOf)).font(.caption).foregroundStyle(colors.inkSoft.color)
          }
          Spacer()
        }
      }
    }

    if let error = model.lastError {
      Text(error.message).font(.callout).foregroundStyle(colors.danger.color)
    }

    Text("見本のデータ（森さんち）。変更はこの端末の中だけに残ります。")
      .font(.footnote).foregroundStyle(colors.inkFaint.color)
  }

  private func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
    let colors = theme.colors
    return VStack(alignment: .leading, spacing: TokenSpace.space3) {
      Text(title).font(.title3.bold()).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
      content()
    }
    .padding(TokenSpace.space4)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(colors.sheet.color, in: RoundedRectangle(cornerRadius: TokenRadius.radiusMd))
    .overlay(RoundedRectangle(cornerRadius: TokenRadius.radiusMd).stroke(colors.line.color))
  }
}
