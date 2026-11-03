import { externalLinkLabel, ja } from '../../content/ja';
import { LinkIcon } from '../../design-system/icons';
import { OPENPOI_ATTRIBUTION_URL } from './openPoiLinks';

/** 場所の出典の表示。一覧の画面でも出すので、場所の入力（PlaceField.tsx）とは分けて読む。 */
export function PlaceAttributionLink({ where }: { where: 'picker' | 'memo' | 'budget' | 'expense' | 'places' }) {
  return <p className="place-attribution small muted">{ja.place.attributionPrefix}: <a data-control-id={`place.attribution.${where}`} href={OPENPOI_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={externalLinkLabel(`${ja.place.attributionPrefix} ${ja.place.attributionLabel}`)}>{ja.place.attributionLabel}<LinkIcon width="13"/></a></p>;
}
