export type ControlContractFinding = {
  duplicateIds: string[];
  missingElements: string[];
};

const controlSelector = 'button, a[href], input, select, textarea';

function describe(element: HTMLElement): string {
  const name = element.getAttribute('aria-label')
    || (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : '')
    || element.textContent
    || element.getAttribute('name')
    || element.tagName.toLowerCase();
  return `${element.tagName.toLowerCase()}「${name.trim().slice(0, 80)}」`;
}

/**
 * Verification-only scanner. It never mutates the application DOM and never
 * manufactures an identifier from a label, DOM order, or translated copy.
 */
export function scanControlContracts(root: ParentNode = document): ControlContractFinding {
  const elements = [...root.querySelectorAll<HTMLElement>(controlSelector)];
  const missingElements = elements.filter((element) => !element.dataset.controlId).map(describe);
  const counts = new Map<string, number>();
  for (const element of elements) {
    const id = element.dataset.controlId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicateIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort();
  return { duplicateIds, missingElements };
}
