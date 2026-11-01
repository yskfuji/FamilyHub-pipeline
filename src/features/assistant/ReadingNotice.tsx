import { EyeIcon } from '../../design-system/icons';

/** 読み取った内容をフォームに入れるときの一言。 */
export const reviewNote = (sample: boolean) => (sample ? '見本のデータです。実際の画像やページは読んでいません。' : '読み取った内容です。誤りがないか確かめてから保存してください。');

/** 何がどこへ送られ、いつ消えるかを、送る前に示す。 */
export function ReadingNotice({ sample }: { sample: boolean }) {
  return <div className="callout info"><EyeIcon/><div>
    <strong>{sample ? 'これは見本の動作です' : '読み取りの処理先へ送ります'}</strong>
    <p className="small muted mb-0">{sample ? '実際の画像やページは読まず、見本の内容を表示します。' : '選んだ画像やページの本文を読み取りの処理先へ送り、終わったら画像を消します。家族の記録は送りません。'}内容を確かめて保存するまで、記録には何も追加しません。</p>
  </div></div>;
}
