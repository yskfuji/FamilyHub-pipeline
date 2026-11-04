import { ManagementConsole } from '../features/showcase/management/ManagementConsole';
import { ShowcasePage } from '../features/showcase/ShowcasePage';

export const auditSurface = true;
export const auditPath = '/showcase';

export function AuditPage({ path }: { path: string }) {
  if (path === '/showcase/management' || path.startsWith('/showcase/management/')) return <ManagementConsole path={path}/>;
  return <ShowcasePage/>;
}
