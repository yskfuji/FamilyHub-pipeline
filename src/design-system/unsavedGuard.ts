import { useEffect, useState } from 'react';

/** 保存していない入力があるフォームに付ける印。閉じようとしている画面の中にこの印があれば確認する。 */
const UNSAVED_ATTRIBUTE = 'data-unsaved';

interface PendingLeave { proceed: () => void }

let pending: PendingLeave | null = null;
/** 保存していない入力。値は、その入力が残る画面かどうか（なければ、どこへ移っても失われる）。 */
const dirtyForms = new Map<symbol, ((pathname: string) => boolean) | undefined>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

export const subscribeUnsaved = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const pendingLeave = () => pending;
/** to を渡すと、その画面へ移っても残る入力（アルバムの送る前のファイルなど）は数えない。 */
export const hasUnsavedForms = (to?: string) => [...dirtyForms.values()].some((keptOn) => !(keptOn && to !== undefined && keptOn(new URL(to, window.location.origin).pathname)));

/** 確認を開く。破棄を選ぶと proceed を実行する。 */
export function askToLeave(proceed: () => void) {
  pending = { proceed };
  emit();
}
export function stayHere() {
  pending = null;
  emit();
}
export function finishLeaving() {
  const leaving = pending;
  pending = null;
  emit();
  leaving?.proceed();
}

/** 画面の移動。どこかに保存していない入力があれば確かめる。 */
export const guardLeaving = (proceed: () => void, to?: string) => (hasUnsavedForms(to) ? askToLeave(proceed) : proceed());

/** 重ね表示を閉じる。その中のフォームに保存していない入力があるときだけ確かめる。 */
export const closeGuarded = (root: Element | null, proceed: () => void) => (root?.querySelector(`[${UNSAVED_ATTRIBUTE}]`) ? askToLeave(proceed) : proceed());

/**
 * 入力の値を最初の値と比べ、変わっていれば閉じる前や移動の前に確認する。
 * 重ね表示の閉じるボタン、Escape、背景の押下は formProps の印を見て確認する。
 * 取り消しのボタンは leave を通す。保存中は確認しない。
 */
export function useUnsavedGuard(value: unknown, busy = false, keptOn?: (pathname: string) => boolean) {
  const [baseline] = useState(() => JSON.stringify(value));
  const [kept] = useState(() => keptOn);
  const dirty = !busy && JSON.stringify(value) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol('unsaved-form');
    dirtyForms.set(token, kept);
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => {
      dirtyForms.delete(token);
      if (!dirtyForms.size) window.removeEventListener('beforeunload', warnBeforeUnload);
    };
  }, [dirty, kept]);
  return {
    dirty,
    formProps: { [UNSAVED_ATTRIBUTE]: dirty ? 'true' : undefined },
    leave: (proceed: () => void) => (dirty ? askToLeave(proceed) : proceed()),
  };
}

const changed = (element: Element) => {
  if (element instanceof HTMLInputElement) return element.type === 'checkbox' || element.type === 'radio' ? element.checked !== element.defaultChecked : element.value !== element.defaultValue;
  if (element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue;
  if (element instanceof HTMLSelectElement) return [...element.options].some((option) => option.selected !== option.defaultSelected);
  return false;
};

/**
 * 値を状態に持たないフォーム（defaultValue で初めの値を入れるもの）の、保存していない入力の確認。
 * 入力のたびに初めの値と比べる。送ったら確認しない（失敗したときは、入力はそのまま残る）。
 */
export function useUncontrolledUnsaved() {
  const [dirty, setDirty] = useState(false);
  const unsaved = useUnsavedGuard(dirty);
  const check = (event: { currentTarget: HTMLFormElement }) => setDirty([...event.currentTarget.elements].some(changed));
  return {
    ...unsaved,
    formProps: { ...unsaved.formProps, onInput: check, onChange: check, onSubmitCapture: () => setDirty(false) },
  };
}
