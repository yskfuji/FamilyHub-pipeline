import { startFakeLlm } from './fakeLlm';

/** 実スタックの確認で起動する。応え方は POST /__mode で変える。 */
const llm = await startFakeLlm(Number(process.env.PORT ?? 8798));
setInterval(() => undefined, 60_000);
console.log(`fake LLM ${llm.url}`);
