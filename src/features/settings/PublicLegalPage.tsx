import { lazy, Suspense } from 'react';
import { Brand } from '../../design-system/components';

const LegalSection = lazy(() => import('./LegalSection'));

/** サインインの前に読む規約。アカウントを作る前でも開ける。 */
export function PublicLegalPage() {
  return <main className="stage-legal page"><Brand/><h1>規約（草案）</h1><Suspense fallback={<div className="skeleton"/>}><LegalSection/></Suspense></main>;
}
