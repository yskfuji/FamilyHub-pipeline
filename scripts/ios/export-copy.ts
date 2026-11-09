/**
 * 画面の文言（src/content/*.ts）を iOS に書き出す。文言は手で写さない。
 * - 文字列・文字列の配列・文字列の対応表は Copy.swift の定数にする（型のある鍵で引ける）。
 * - ヘルプ・規約のような構造のある文書は JSON にして、Swift の Codable で読む。
 * - 関数（文言を組み立てるもの）は書き出せないので、Swift の側で同じ規則を書く。一覧を Copy.swift の先頭に残す。
 *
 *   npx tsx scripts/ios/export-copy.ts [--check]
 */
import * as auditIntro from '../../src/content/auditIntro';
import * as auditLabels from '../../src/content/auditLabels';
import * as help from '../../src/content/help';
import * as jaModule from '../../src/content/ja';
import * as legal from '../../src/content/legal';
import * as passwordMessages from '../../src/content/passwordMessages';
import * as serverMessages from '../../src/content/serverMessages';
import * as settingsRoutes from '../../src/content/settingsRoutes';
import { settingsTabs } from '../../src/features/settings/settingsTabs';
import { writeGenerated } from './generated.mjs';

const keywords = new Set(['associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while', 'as', 'catch', 'false', 'is', 'nil', 'super', 'self', 'Self', 'throw', 'throws', 'true', 'try', 'Type', 'Any', 'some', 'any']);
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const name = (key: string) => (keywords.has(key) ? `\`${key}\`` : key);
const literal = (value: string) => JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => `\\u{${hex}}`);
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const skipped: string[] = [];
/** 鍵（サーバーが返す値）で文言を引く表。enum の定数に加えて table（辞書）も書き出す。 */
const lookupTables = new Set(['auditLabels.auditFieldLabels', 'auditLabels.auditGroupLabels', 'auditLabels.auditTargetLabels', 'ja.ja.resourceKinds', 'ja.roleLabels', 'ja.membershipStatusLabels']);
const documents: Record<string, unknown> = {};

/** 対応表（鍵が識別子でない、または値が入れ子）を Swift の辞書の型と式にする。 */
function dictionary(value: unknown, path: string): { type: string; expression: string } | null {
  if (typeof value === 'string') return { type: 'String', expression: literal(value) };
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return { type: '[String]', expression: `[${value.map(literal).join(', ')}]` };
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value).filter(([, item]) => typeof item !== 'function');
  const parts = entries.map(([key, item]) => [key, dictionary(item, `${path}.${key}`)] as const);
  if (parts.some(([, part]) => !part)) return null;
  const types = new Set(parts.map(([, part]) => part!.type));
  if (types.size !== 1) return null;
  const [type] = types;
  return { type: `[String: ${type}]`, expression: `[${parts.map(([key, part]) => `${literal(key)}: ${part!.expression}`).join(', ')}]` };
}

function emit(key: string, value: unknown, path: string, indent: string): string[] {
  if (typeof value === 'function') { skipped.push(path); return []; }
  if (typeof value === 'string') return [`${indent}public static let ${name(key)} = ${literal(value)}`];
  if (typeof value === 'number') return [`${indent}public static let ${name(key)}: ${Number.isInteger(value) ? 'Int' : 'Double'} = ${value}`];
  if (typeof value === 'boolean') return [`${indent}public static let ${name(key)} = ${value}`];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return [`${indent}public static let ${name(key)}: [String] = [${value.map(literal).join(', ')}]`];
    documents[path] = value;
    return [`${indent}// ${path} は構造のある一覧なので FHCopy/Copy/${path}.json に書き出した。`];
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.every(([child]) => identifier.test(child))) {
      // 鍵で引く表（記録の項目名など）は、辞書も添える。
      const table = lookupTables.has(path) ? dictionary(value, path) : null;
      return [`${indent}public enum ${name(key)} {`, ...entries.flatMap(([child, item]) => emit(child, item, `${path}.${child}`, `${indent}  `)), ...(table ? [`${indent}  public static let table: ${table.type} = ${table.expression}`] : []), `${indent}}`];
    }
    const table = dictionary(value, path);
    if (table) return [`${indent}public static let ${name(key)}: ${table.type} = ${table.expression}`];
    documents[path] = value;
    return [`${indent}// ${path} は FHCopy/Copy/${path}.json に書き出した。`];
  }
  throw new Error(`unsupported value at ${path}`);
}

const modules: Array<[string, Record<string, unknown>]> = [
  ['ja', jaModule], ['serverMessages', serverMessages], ['passwordMessages', passwordMessages], ['auditLabels', auditLabels], ['auditIntro', auditIntro],
  // 規約の文書は JSON に書き出す。数と短い文字の決まりだけをここに置く。
  ['legal', Object.fromEntries(Object.entries(legal).filter(([, value]) => typeof value === 'number' || typeof value === 'string'))],
];
const body = modules.flatMap(([moduleName, module]) => [
  `  public enum ${moduleName} {`,
  ...Object.entries(module).filter(([key]) => key !== 'default').flatMap(([key, value]) => emit(key, value, `${moduleName}.${key}`, '    ')),
  '  }',
]);

// 構造のある文書。Swift の Codable で読む。
documents['help.helpCategories'] = help.helpCategories;
documents['help.helpItems'] = help.helpItems;
documents['legal.legalDocuments'] = legal.legalDocuments;
documents['legal.legalNotice'] = legal.legalNotice;
documents['settingsRoutes.settingsRoutes'] = settingsRoutes.settingsRoutes;
// 設定のタブの名前・説明・表示に要る能力（Web の settingsTabs.ts）。
documents['settingsTabs.settingsTabs'] = settingsTabs;

const swift = `// 生成したファイル。手で書き換えない。npx tsx scripts/ios/export-copy.ts で作り直す。
// 元: src/content/*.ts
//
// 次の関数は文言を組み立てるので書き出していない。Swift の側で同じ規則を書く:
${skipped.map((path) => `//   ${path}`).join('\n')}

public enum Copy {
${body.join('\n')}
}
`;

const base = 'ios/Packages/FamilyHubKit/Sources/FHCopy';
writeGenerated(`${base}/Copy.swift`, swift);
for (const [path, value] of Object.entries(documents)) writeGenerated(`${base}/Copy/${path}.json`, `${JSON.stringify(value, null, 2)}\n`);
