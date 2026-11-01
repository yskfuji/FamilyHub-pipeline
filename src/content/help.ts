/** 設定の「ヘルプ」に載せる、よくある質問。内容は今の画面と規則に合わせる。 */
export type HelpCategory = 'family' | 'records' | 'display' | 'safety';

export const helpCategories: ReadonlyArray<{ id: HelpCategory; label: string }> = [
  { id: 'family', label: '家族と共有' },
  { id: 'records', label: '記録の使い方' },
  { id: 'display', label: '表示と操作' },
  { id: 'safety', label: '安全と接続' },
];

export interface HelpItem {
  id: string;
  category: HelpCategory;
  question: string;
  answer: readonly string[];
  keywords: readonly string[];
  /** 関わる設定やページへの案内。 */
  related?: { href: string; label: string };
}

export const helpItems: readonly HelpItem[] = [
  {
    id: 'read-shift',
    category: 'records',
    question: '勤務表を予定にまとめて入れるには',
    answer: ['予定の画面の「シフトを読み取る」に、表計算、チャット、メールから勤務表の文字を貼り付けます。読み取りはこの端末の中だけで行います。', '読み取る人と月を選び、確認の表で保存する行を選んでから保存します。記号と時刻の対応は「時刻の規則」で変えられ、この端末に残ります。'],
    keywords: ['シフト', '勤務表', '早番', '遅番', '夜勤', '貼り付け', '時刻の規則'],
  },
  {
    id: 'read-review',
    category: 'records',
    question: '振り返りは何をしていますか',
    answer: ['ヒントの画面の「振り返り」は、見えている記録の件数、時刻、金額を数えて比べた結果です。内容を読み取ったり、気持ちや事情を推し量ったりはしません。', '重なった予定や期限切れのタスクなどを、もとにした記録とともに示します。下書きは入力の画面を開くだけで、保存するまで記録は変わりません。'],
    keywords: ['振り返り', '集計', '重なり', '期限切れ', '未精算', '下書き'],
  },
  {
    id: 'read-helpers',
    category: 'records',
    question: '領収書やチラシの読み取りで、何が送られますか',
    answer: ['運営者が読み取りを有効にしているときだけ、大人に「領収書を読み取る」と「URL・チラシから読み取る」が表示されます。', '選んだ画像とページの本文を読み取りの処理先へ送ります。画像は位置情報などを外して送り、終わったら消します。家族の記録は送りません。読み取った内容は入力の画面に入るだけで、確かめて保存するまで記録になりません。'],
    keywords: ['領収書', 'レシート', 'チラシ', 'URL', '読み取り', '外部'],
  },
  {
    id: 'invite-family',
    category: 'family',
    question: '家族を招待するには？',
    answer: ['管理者が「設定」の「家族」で役割を選び、招待コードを作ります。', '招待コードは24時間以内に1回だけ使えます。使わなくなったコードは、同じ画面で無効にできます。'],
    keywords: ['招待', 'コード', 'メンバー', '追加', '参加'],
    related: { href: '/settings/household', label: '家族の設定を開く' },
  },
  {
    id: 'member-limit',
    category: 'family',
    question: '家族グループには何人まで入れますか？',
    answer: ['利用中のメンバーは8人までです。8人に達すると、招待コードを作れなくなります。', '一時停止中のメンバーは人数に数えません。退出したメンバーも数えません。'],
    keywords: ['人数', '上限', '8人', '定員'],
    related: { href: '/settings/household', label: '家族の設定を開く' },
  },
  {
    id: 'rename-household',
    category: 'family',
    question: '家族グループの名前を変える回数に上限はありますか？',
    answer: ['名前の変更は24時間で3回までです。「設定」の「家族」に、今変えられる残りの回数を表示します。'],
    keywords: ['名前', '変更', '回数', '3回'],
    related: { href: '/settings/household', label: '家族の設定を開く' },
  },
  {
    id: 'transfer-owner',
    category: 'family',
    question: '管理者を別の人に渡すには？',
    answer: ['管理者が「設定」の「家族」でメンバーの「権限を設定」を開き、「管理者を渡す」を選びます。渡せる相手は、利用中の大人のメンバーだけです。', '渡すと、自分は大人のメンバーになります。操作の前に、もう一度本人確認を求めることがあります。'],
    keywords: ['管理者', '移譲', '渡す', 'オーナー', '交代'],
    related: { href: '/settings/household', label: '家族の設定を開く' },
  },
  {
    id: 'leave-household',
    category: 'family',
    question: '家族グループから退出するには？',
    answer: ['管理者以外の人は、「設定」の「アカウント」から家族グループを退出できます。', '管理者は、先に別の大人へ管理者を渡してください。'],
    keywords: ['退出', '抜ける', '脱退'],
    related: { href: '/settings/account', label: 'アカウントの設定を開く' },
  },
  {
    id: 'who-can-see',
    category: 'family',
    question: '作った予定やメモは誰に見えますか？',
    answer: ['作るときに選ぶ公開範囲で決まります。「大人のメンバーと関わる人」を選ぶと、大人のメンバーと、担当や参加者など本人に関係する人に表示します。', '子どもメンバーとゲストには、本人に関係するものだけを表示します。新しく作るものの初期値は「共有とプライバシー」で変えられます。'],
    keywords: ['公開範囲', '共有', '見える', '子ども', 'ゲスト'],
    related: { href: '/settings/privacy', label: '共有とプライバシーを開く' },
  },
  {
    id: 'member-scope',
    category: 'records',
    question: '特定の人に関わるものだけを見るには？',
    answer: ['今日、カレンダー、タスク、メモ、家計の見出しにある「表示する人」で選びます。', '予定は作った人、担当する人、参加者、タスクは作った人、担当する人、確認する人、メモは書いた人、支出は記録した人、支払った人、負担する人を当事者として絞ります。選んだ内容はこの端末に残ります。'],
    keywords: ['絞り込み', '表示する人', 'メンバー', '自分'],
  },
  {
    id: 'recurring-edit',
    category: 'records',
    question: '繰り返しの予定を1回分だけ変えられますか？',
    answer: ['予定を開いて「対象とする予定」で「この予定だけ」「これ以降の予定」「すべての予定」から選んでから、編集や削除をします。', '繰り返しのタスクは「このタスクだけ」と「すべてのタスク」から選びます。'],
    keywords: ['繰り返し', '毎週', '毎月', '1回だけ', '編集'],
  },
  {
    id: 'task-review',
    category: 'records',
    question: 'タスクの「確認する人」とは？',
    answer: ['担当する人が終えたあとに、内容を確かめる人です。確認する人を決めると、担当する人には確認を頼む操作を、確認する人には完了にする操作を勧めます。確認の流れは案内で、必須ではありません。', 'タスクの状態は、未着手、進行中、確認待ち、相手待ち、完了の5つです。'],
    keywords: ['確認', '担当', '状態', '完了', '確認待ち'],
  },
  {
    id: 'settlement',
    category: 'records',
    question: '割り勘の精算を一部だけ記録できますか？',
    answer: ['できます。支出の詳細で支払う人と金額を選んで記録すると、残りの額を計算します。', '精算を取り消しても、元の記録と取り消しの記録は履歴に残ります。精算の記録がある支出は、精算を取り消してから削除します。'],
    keywords: ['精算', '割り勘', '一部', '取り消し', '家計'],
  },
  {
    id: 'recently-deleted',
    category: 'records',
    question: '削除したものを元に戻せますか？',
    answer: ['削除から7日以内なら、「設定」の「最近削除」から元に戻せます。一覧には、自分が削除できる記録だけを表示します。', '削除から30日を過ぎた記録は、完全に消します。'],
    keywords: ['削除', '復元', '元に戻す', 'ゴミ箱', '7日'],
    related: { href: '/settings/recently-deleted', label: '最近削除を開く' },
  },
  {
    id: 'attachment-limits',
    category: 'records',
    question: 'メモに添付できるファイルは？',
    answer: ['PDF、JPEG、PNG は10MBまで、MP4 は120MBまでです。', '追加したファイルは、確認が終わるまで開けません。確認で問題が見つかったファイルは開けないままです。'],
    keywords: ['添付', 'ファイル', 'PDF', '容量', 'メモ'],
  },
  {
    id: 'album-formats',
    category: 'records',
    question: 'アルバムに HEIC の写真を追加できません',
    answer: ['HEIC は受け付けていません。JPEG、PNG、MP4、MOV を選んでください。写真は100MB、動画は4GBまでです。'],
    keywords: ['アルバム', '写真', '動画', 'HEIC', 'iPhone', '追加できない'],
  },
  {
    id: 'photo-location',
    category: 'safety',
    question: '写真の撮影場所は残りますか？',
    answer: ['初期の設定では、撮影場所の情報を取り除いて保存します。追加するときに「撮影場所を残す」をオンにすると、そのアルバムを見られる人が読み取れる形で残ります。', '「共有とプライバシー」で、この端末の初期値を変えられます。'],
    keywords: ['写真', '位置情報', '撮影場所', 'GPS', 'アルバム'],
    related: { href: '/settings/privacy', label: '共有とプライバシーを開く' },
  },
  {
    id: 'place-lookup',
    category: 'safety',
    question: '場所の検索で、外部へ何が送られますか？',
    answer: ['同意したときだけ、外部の検索サービス OpenPOI へ、約100m単位に丸めた位置か入力した検索語を送ります。正確な現在地、名前、メールアドレスは送りません。', '同意はいつでもやめられます。やめても、記録済みの場所は消えません。'],
    keywords: ['場所', '検索', 'OpenPOI', '外部', '同意', '位置情報'],
    related: { href: '/settings/location', label: '位置情報の設定を開く' },
  },
  {
    id: 'hide-notification',
    category: 'safety',
    question: '通知の内容をほかの人に見られたくありません',
    answer: ['「共有とプライバシー」の「通知の題名と内容を表示しない」をオンにすると、通知の一覧では中身を伏せ、開いたものだけ表示します。'],
    keywords: ['通知', '内容', '隠す', '伏せる'],
    related: { href: '/settings/privacy', label: '共有とプライバシーを開く' },
  },
  {
    id: 'privacy-blur',
    category: 'safety',
    question: 'ほかのタブへ移ったときに画面をぼかせますか？',
    answer: ['「共有とプライバシー」の「隠れている間は画面をぼかす」をオンにすると、タブが隠れている間だけ画面をぼかします。この設定は端末ごとです。', 'アプリの切り替え画面に映る内容まで隠せるとは限りません。'],
    keywords: ['ぼかす', '隠す', 'タブ', 'プライバシー'],
    related: { href: '/settings/privacy', label: '共有とプライバシーを開く' },
  },
  {
    id: 'offline-changes',
    category: 'safety',
    question: '接続が切れている間に入力した内容はどうなりますか？',
    answer: ['予定、タスク、メモの作成と変更は、未送信の変更としてこの端末に暗号化して保存します。上部の「未送信の変更」から、内容を確かめて送信してください。接続が戻っても自動では送信しません。', '未送信の変更は保存後24時間まで残ります。支出と収入は保存できません。'],
    keywords: ['オフライン', '未送信', '接続', '圏外'],
  },
  {
    id: 'sync-now',
    category: 'safety',
    question: '画面の内容が古いときは？',
    answer: ['「今日」の見出しか、「設定」の「表示・操作」にある「今すぐ更新」を押します。最後に更新した時刻も同じ場所に表示します。', '更新できなかったときは、接続を確認して「もう一度更新」を押してください。'],
    keywords: ['更新', '同期', '最新', '古い'],
    related: { href: '/settings/accessibility', label: '表示・操作を開く' },
  },
  {
    id: 'auto-sign-out',
    category: 'safety',
    question: '操作しないと自動でサインアウトしますか？',
    answer: ['します。時間は「アカウント」で1分、5分、15分、30分、60分から選べます。時間が近づくと画面の隅で知らせるので、続ける場合はそこから操作してください。'],
    keywords: ['自動', 'サインアウト', 'ログアウト', '時間'],
    related: { href: '/settings/account', label: 'アカウントの設定を開く' },
  },
  {
    id: 'themes',
    category: 'display',
    question: 'テーマや文字の詰め具合を変えるには？',
    answer: ['「表示・操作」で5つのテーマ、昼、夜、端末に合わせる、表示の密度を選べます。', 'これらは端末ごとの設定なので、別の端末には反映されません。'],
    keywords: ['テーマ', '色', 'ダーク', '暗い', '密度', 'コンパクト'],
    related: { href: '/settings/accessibility', label: '表示・操作を開く' },
  },
  {
    id: 'keyboard',
    category: 'display',
    question: 'キーボードだけで操作できますか？',
    answer: ['Mac は ⌘K、Windows は Ctrl+K で検索とコマンドの一覧を開きます。矢印キーで選び、Enter で実行します。', '月のカレンダーでは、矢印キーで日を移し、Home と End で週の端へ、PageUp と PageDown で前後の月へ移ります。'],
    keywords: ['キーボード', 'ショートカット', '検索', 'コマンド', 'カレンダー'],
  },
  {
    id: 'new-version',
    category: 'display',
    question: '「新しい版があります」と表示されました',
    answer: ['開いている画面より新しい版が配信されています。入力中の内容を保存してから「読み込み直す」を押してください。'],
    keywords: ['新しい版', '更新', 'アップデート', '読み込み直す'],
  },
];

const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');

export const parseHelpCategory = (value: string | null): HelpCategory | null => (helpCategories.some((item) => item.id === value) ? value as HelpCategory : null);

/** 語と分類で絞る。語は、質問、答え、キーワードのどれかに含まれるもの。 */
export function filterHelpItems(items: readonly HelpItem[], query: string, category: HelpCategory | null): HelpItem[] {
  const needle = normalize(query);
  return items.filter((item) => (!category || item.category === category) && (!needle || normalize([item.question, ...item.answer, ...item.keywords].join('\n')).includes(needle)));
}
