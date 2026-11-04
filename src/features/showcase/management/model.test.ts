import { describe, expect, it } from 'vitest';
import { initialConsoleState as state, sections } from './fixtures';
import { consoleReducer, consoleSummary, filterAudit, filterHouseholds, filterRecords } from './model';

describe('management console sample', () => {
  it('dry run counts but changes nothing, and running empties the job', () => {
    const previewed = consoleReducer(state, { type: 'job.dry-run', id: 'retention' });
    expect(previewed.jobs.find((job) => job.id === 'retention')?.pending).toBe(14);
    expect(previewed.runs[0]).toMatchObject({ mode: 'dry-run', count: 14 });
    const ran = consoleReducer(previewed, { type: 'job.run', id: 'retention' });
    expect(ran.jobs.find((job) => job.id === 'retention')?.pending).toBe(0);
    expect(ran.runs[0]).toMatchObject({ mode: 'run', count: 14 });
    expect(ran.audit.slice(0, 2).map((entry) => entry.action)).toEqual(['見本の実行', '試算']);
  });

  it('never runs a read-only job', () => {
    expect(consoleReducer(state, { type: 'job.run', id: 'storage' })).toBe(state);
  });

  it('keeps a stopped household from being extended until it is resumed', () => {
    expect(consoleReducer(state, { type: 'household.extend', id: 'sample-household-d' })).toBe(state);
    const resumed = consoleReducer(state, { type: 'household.resume', id: 'sample-household-d' });
    const extended = consoleReducer(resumed, { type: 'household.extend', id: 'sample-household-d' });
    expect(extended.households.find((item) => item.id === 'sample-household-d')?.status).toBe('active');
    expect(extended.households.find((item) => item.id === 'sample-household-d')?.endsAt?.slice(0, 10)).toBe('2026-10-28');
  });

  it('extends from the current end when it is still in the future', () => {
    const extended = consoleReducer(state, { type: 'household.extend', id: 'sample-household-b' });
    expect(extended.households.find((item) => item.id === 'sample-household-b')).toMatchObject({ status: 'active', endsAt: '2026-11-04T23:59:00+09:00' });
  });

  it('verifies a backup once and records one entry', () => {
    const verified = consoleReducer(state, { type: 'backup.verify', id: 'sample-backup-3' });
    expect(consoleSummary(verified).unverifiedBackups).toBe(0);
    expect(consoleReducer(verified, { type: 'backup.verify', id: 'sample-backup-3' })).toBe(verified);
  });

  it('advances its own clock instead of reading the real one', () => {
    const next = consoleReducer(state, { type: 'service.recheck', id: 'mail' });
    expect(next.now).toBe('2026-09-28T09:01:00+09:00');
    expect(next.services.find((item) => item.id === 'mail')?.checkedAt).toBe(next.now);
  });

  it('filters the audit log, households and records', () => {
    expect(filterAudit(state.audit, 'backup', '').map((entry) => entry.id)).toEqual(['sample-audit-2']);
    expect(filterAudit(state.audit, 'all', '停止').map((entry) => entry.id)).toEqual(['sample-audit-4']);
    expect(filterHouseholds(state.households, '家族c').map((item) => item.id)).toEqual(['sample-household-c']);
    expect(filterRecords(state.records, 'events', '', false).map((item) => item.id)).toEqual(['sample-event-1']);
    expect(filterRecords(state.records, 'events', '', true)).toHaveLength(2);
  });

  it('holds nothing that looks like a real destination, and has one link per section', () => {
    const text = JSON.stringify(state);
    expect(text).not.toMatch(/https?:|\b\d{1,3}(\.\d{1,3}){3}\b|\.ts\.net|tailscale|@[a-z]/i);
    expect(new Set(sections.map((item) => item.href)).size).toBe(sections.length);
  });
});
