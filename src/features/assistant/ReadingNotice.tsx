import { ja } from '../../content/ja';
import { EyeIcon } from '../../design-system/icons';

/** 読み取った内容をフォームに入れるときの一言。 */
export const reviewNote = (sample: boolean) => (sample ? ja.reading.reviewSample : ja.reading.review);

/** 何をどこで読み、いつ消えるかを、読み取る前に示す。読み取りは家庭内で行い、外部へは送らない。 */
export function ReadingNotice({ sample }: { sample: boolean }) {
  return <div className="callout info"><EyeIcon/><div>
    <strong>{sample ? ja.reading.sampleTitle : ja.reading.title}</strong>
    <p className="small muted mb-0">{sample ? ja.reading.sampleBody : ja.reading.body}{ja.reading.keep}</p>
  </div></div>;
}
