import type { NotificationPort } from '../../data/gateway';
import { addDateKeyDays, dateKeyFromRfc3339, toJstRfc3339 } from '../calendarDate';
import type { HouseholdNotification, NotificationPreferences } from '../types';
import { invalid, missing, ok } from './context';
import type { CommandContext, SyncPort } from './context';

export function createNotificationCommands(c: CommandContext): SyncPort<NotificationPort> {
  const { a, now, requireCapability } = c;
  return {
    list() {
      const guard = requireCapability<HouseholdNotification[]>('notification.manage'); if (guard) return guard;
      // 通知設定に従って出し分ける。夜間に当たる通知は翌朝7時に回す。
      const visibleNotifications = a.notifications
        .filter((item) => (item.kind === 'todoDue' ? a.notificationPreferences.todoDue : a.notificationPreferences.eventDeparture))
        .map((item) => {
          const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }).format(new Date(item.remindAt)));
          if (!a.notificationPreferences.quietHours || (hour >= 7 && hour < 21)) return structuredClone(item);
          const day = dateKeyFromRfc3339(item.remindAt);
          return { ...structuredClone(item), remindAt: `${hour >= 21 ? addDateKeyDays(day, 1) : day}T07:00:00+09:00` };
        });
      return ok(visibleNotifications);
    },
    markRead(id) {
      const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = a.notifications.find((item) => item.id === id);
      if (!target) return missing('通知');
      target.read = true; return ok(structuredClone(target));
    },
    snooze(id, minutes) {
      const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = a.notifications.find((item) => item.id === id);
      if (!target) return missing('通知');
      if (minutes !== 30) return invalid([{ message: '通知を延期できません。' }]);
      target.status = 'snoozed'; target.remindAt = toJstRfc3339(new Date(Math.max(Date.parse(now()), Date.parse(target.remindAt)) + 30 * 60_000)); return ok(structuredClone(target));
    },
    stop(id) {
      const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = a.notifications.find((item) => item.id === id);
      if (!target) return missing('通知');
      target.status = 'stopped'; return ok(structuredClone(target));
    },
    resume(id) {
      const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = a.notifications.find((item) => item.id === id);
      if (!target) return missing('通知'); target.status = 'active'; return ok(structuredClone(target));
    },
    getPreferences() { const guard = requireCapability<NotificationPreferences>('notification.manage'); return guard ?? ok(structuredClone(a.notificationPreferences)); },
    updatePreferences(input) {
      const guard = requireCapability<NotificationPreferences>('notification.manage'); if (guard) return guard;
      const allowed = ['todoDue', 'eventDeparture', 'quietHours'] as const;
      if (Object.entries(input).some(([key, value]) => !allowed.includes(key as typeof allowed[number]) || typeof value !== 'boolean')) return invalid([{ message: '通知の設定を確認してください。' }]);
      a.notificationPreferences = { ...a.notificationPreferences, ...input }; return ok(structuredClone(a.notificationPreferences));
    },
  };
}
