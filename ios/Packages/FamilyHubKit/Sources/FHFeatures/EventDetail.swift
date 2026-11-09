import SwiftUI
import FHModel
import FHDomain
import FHDesign
import FHCopy

/// 予定の内容（Web の EventDrawer.tsx）。繰り返しの予定は、変える範囲（この予定だけ・これ以降・すべて）を選んで編集・削除する。
struct EventDetailSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let occurrence: Occurrence
  let onDeleted: (DeletedEvent) -> Void
  @State private var scope: RecurrenceScope = .this
  @State private var editing = false
  @State private var deleting = false
  @State private var busy = false

  var body: some View {
    NavigationStack {
      Group {
        if let snapshot = model.snapshot, let series = snapshot.events.first(where: { $0.id == occurrence.event.id }) {
          // 変更の後は、取り直した記録からその回を作り直す。
          let current = CalendarLayout.occurrence(startingOn: occurrence.occurrenceDate, of: series) ?? occurrence
          content(snapshot, series: series, active: current)
            .sheet(isPresented: $editing) { EventEditSheet(occurrence: current, series: series, scope: $scope) }
        } else {
          EmptyStateView(title: "予定が見つかりません", message: "削除されたか、公開範囲が変わったため表示できません。", illustration: .emptyEvents)
            .padding(TokenSpace.space4)
        }
      }
      .navigationTitle(occurrence.title)
      .inlineNavigationTitle()
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button(Copy.ja.ja.actions.close) { dismiss() } } }
    }
  }

  @ViewBuilder
  private func content(_ snapshot: HouseholdSnapshot, series: CalendarEvent, active: Occurrence) -> some View {
    let colors = theme.colors
    let viewer = snapshot.viewer
    let canEdit = Policy.canMutateOwned(viewer, .eventUpdate, ownerMembershipId: active.ownerMembershipId)
    let canDelete = Policy.canDelete(viewer, .eventDelete, stakeholders: [active.ownerMembershipId] + active.participantMembershipIds)
    let todayKey = CalendarDate.dateKey(fromRfc3339: snapshot.context.asOf) ?? ""
    let seriesStart = CalendarLayout.dateKey(series.startsAt)
    let recurring = active.recurrence != nil
    let label = active.colorLabelId.flatMap { id in snapshot.colorLabels.first { $0.id == id }?.name }
    let audience = active.visibility.audience == .selected
      ? active.visibility.selectedMembershipIds.map { memberName(snapshot.memberships, $0) }.joined(separator: "、")
      : Visibility.label(.event, active.visibility.audience)
    let resources = viewer.capabilities.contains(.resourceRead) ? snapshot.resources.filter { active.resourceIds?.contains($0.id) == true } : []
    ScrollView {
      VStack(alignment: .leading, spacing: TokenSpace.space4) {
        Eyebrow("予定の内容")
        Callout(systemImage: "calendar", title: CalendarText.when(active), detail: CalendarText.timezone(active.timezone), tone: .info)
        if active.weatherSensitive == true {
          if active.occurrenceDate == todayKey {
            let weather = snapshot.context.weather
            Callout(systemImage: "cloud.rain", title: "今日の天気の影響", detail: "\(weather.location)の降水確率\(jsNumber(weather.precipitationPercent))%\(weather.alert.map { "。\($0)" } ?? "")。予定は自動で変更されません。", tone: .plain)
          } else {
            Callout(systemImage: "cloud.rain", title: "天気の影響を受ける予定です", detail: "当日の予報を確認してください。予定は自動で変更されません。", tone: .info)
          }
        }
        Card {
          VStack(alignment: .leading, spacing: TokenSpace.space3) {
            DetailItem(title: "参加者", value: active.participantMembershipIds.map { memberName(snapshot.memberships, $0) }.joined(separator: "、"))
            DetailItem(title: "場所", value: active.location ?? "未設定")
            if let note = active.note { DetailItem(title: "メモ", value: note) }
            DetailItem(title: "公開範囲", value: audience)
            if let label { DetailItem(title: "リスト", value: label) }
            if let minutes = active.reminderMinutesBefore { DetailItem(title: "通知", value: CalendarText.reminder(minutes)) }
            if let recurrence = active.recurrence {
              VStack(alignment: .leading, spacing: TokenSpace.space1) {
                Text("繰り返し").font(.subheadline.weight(.bold)).foregroundStyle(colors.inkSoft.color)
                HStack {
                  StatusBadge(Recurrence.describe(start: seriesStart, recurrence: recurrence))
                  Text("この回：\(CalendarText.day(active.occurrenceDate))").font(.footnote).foregroundStyle(colors.inkSoft.color)
                }
                Picker("対象とする予定", selection: $scope) {
                  ForEach([RecurrenceScope.this, .future, .series], id: \.self) { Text(scopeLabel($0)).tag($0) }
                }
                .accessibilityIdentifier("calendar.event.scope")
              }
            }
          }
        }
        if !resources.isEmpty {
          VStack(alignment: .leading, spacing: TokenSpace.space2) {
            Text("関連リンク").font(.headline).foregroundStyle(colors.ink.color).accessibilityAddTraits(.isHeader)
            ForEach(resources) { resource in Label(resource.label, systemImage: "link").foregroundStyle(colors.ink.color) }
          }
        }
        if canEdit || canDelete {
          HStack(spacing: TokenSpace.space3) {
            if canEdit { Button("編集する") { editing = true }.fhButton(.secondary, fullWidth: true).accessibilityIdentifier("calendar.event.edit") }
            if canDelete { Button("予定を削除") { deleting = true }.fhButton(.danger, fullWidth: true).disabled(busy) }
          }
        }
      }
      .padding(TokenSpace.space4)
    }
    .background(colors.paper.color)
    .confirmationDialog("予定を削除しますか", isPresented: $deleting, titleVisibility: .visible) {
      Button(Copy.ja.ja.actions.delete, role: .destructive) { Task { await remove(active, recurring: recurring) } }
      Button(Copy.ja.ja.actions.cancel, role: .cancel) {}
    } message: {
      Text("「\(active.title)」\(recurring ? "（\(scopeLabel(scope))）" : "")を削除します。削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。")
    }
  }

  private func remove(_ active: Occurrence, recurring: Bool) async {
    busy = true
    defer { busy = false }
    let id = active.event.id, version = active.event.version, chosen = scope
    let date = recurring && scope != .series ? active.occurrenceDate : nil
    switch await model.mutate({ await $0.deleteEvent(id: id, scope: chosen, expectedVersion: version, occurrenceDate: date) }) {
    case .success:
      // 1回だけの削除は、その回を指定して戻す。これ以降の削除は、シリーズの記録から戻す。
      onDeleted(DeletedEvent(id: id, title: active.title, occurrenceDate: recurring && chosen == .this ? active.occurrenceDate : nil))
      model.announce("「\(active.title)」\(recurring && chosen != .series ? "（\(scopeLabel(chosen))）" : "")を削除しました。7日以内は元に戻せます")
      dismiss()
    case .failure(let failure):
      model.announce(failure.message)
    }
  }
}

struct DetailItem: View {
  @Environment(\.theme) private var theme
  let title: String
  let value: String
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(.subheadline.weight(.bold)).foregroundStyle(theme.colors.inkSoft.color)
      Text(value).foregroundStyle(theme.colors.ink.color).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

/// JS の数の書き方（整数なら小数点を付けない）。
func jsNumber(_ value: Double) -> String {
  value.rounded() == value && abs(value) < 1e15 ? String(Int(value)) : String(value)
}
