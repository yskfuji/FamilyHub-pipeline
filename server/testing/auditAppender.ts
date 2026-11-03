import { AuditStore } from '../audit/store';

/**
 * 試験の部品。別の処理として audit.db に1行ずつ追記する（API と運営者の命令が同時に書く状況を作る）。
 * 使い方: tsx server/testing/auditAppender.ts <audit.db> <名前> <行数>
 * 準備ができたら "ready" を出し、標準入力に何か届いたら書き始める。
 */
const [path, name, count] = process.argv.slice(2);
const store = new AuditStore(path);
process.stdout.write('ready\n');
process.stdin.once('data', () => {
  for (let index = 0; index < Number(count); index += 1) {
    store.append([{ id: `${name}-${index}`, at: '2026-10-01T09:00:00+09:00', household_id: 'house-mori', actor_user_id: name, action: 'createTodo', target: `todo-${name}-${index}`, detail: null }]);
  }
  store.close();
  process.stdout.write('done\n');
  process.exit(0);
});
