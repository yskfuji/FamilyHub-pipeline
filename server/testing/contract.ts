import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

interface Operation { operationId: string; responses: Record<string, { $ref?: string; content?: Record<string, { schema?: object }> }> }
interface Contract { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, object>; responses: Record<string, { content: Record<string, { schema: object }> }> } }

export const contract = parse(readFileSync('contracts/family-hub.openapi.yaml', 'utf8')) as Contract;

export const contractOperations = () => Object.entries(contract.paths).flatMap(([path, methods]) => Object.entries(methods)
  .filter(([method]) => ['get', 'head', 'post', 'put', 'patch', 'delete'].includes(method))
  .map(([method, operation]) => ({ method: method.toUpperCase(), path, operationId: operation.operationId, operation })));

const matcher = (path: string) => new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
const operations = contractOperations().map((item) => ({ ...item, pattern: matcher(item.path) }));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'https://contract.test/openapi', components: contract.components });

const resolve = <T extends object>(schema: T) => JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"https://contract.test/openapi#/components/')) as object;

/** 応答が契約の形に合わなければ理由を返す。合えば null。 */
export function responseViolation(method: string, url: string, status: number, body: unknown): string | null {
  const path = url.split('?')[0];
  const found = operations.find((item) => item.method === method && item.pattern.test(path));
  if (!found) return `${method} ${path} is not in the contract`;
  const declared = found.operation.responses[String(status)] ?? found.operation.responses.default;
  if (!declared) return `${found.operationId} does not declare status ${status}`;
  const schema = declared.$ref ? contract.components.responses.Error.content['application/problem+json'].schema : declared.content?.['application/json']?.schema;
  if (!schema) return null;
  const validate = ajv.compile(resolve(schema));
  return validate(body) ? null : `${found.operationId} ${status}: ${ajv.errorsText(validate.errors)}`;
}
