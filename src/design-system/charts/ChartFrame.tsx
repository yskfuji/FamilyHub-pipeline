import { useId, useState, type ReactNode } from 'react';
import { ChevronRightIcon } from '../icons';

export interface ChartTable {
  /** 表の題。図表の見出しと同じ内容にする。 */
  caption: string;
  /** 列の見出し。最初の列は行の見出し（th scope="row"）の列。 */
  columns: readonly string[];
  rows: ReadonlyArray<{ key: string; header: string; cells: readonly string[] }>;
}

interface Props {
  /** 操作の ID（chart.table.〜）と、表の要素の ID に使う。同じ画面で重ならないこと。 */
  name: string;
  /**
   * 図表の短い要約。読み上げでは、図表はこの1文として読み、数値は表で読む（同じ内容を二度読ませない）。
   * 行がリンクの図表（費目の内訳）は undefined にする。行ごとのリンクの名前に数値が入っているため。
   */
  summary?: string;
  table: ChartTable;
  /** 行の名前の列を広くする（日付や人の名前）。 */
  names?: 'wide';
  children: ReactNode;
}

/**
 * 図表の枠。SVG の図表に、同じ数値の表を「表で見る」で開いて添える（aria-expanded と aria-controls）。
 * 表は閉じている間は hidden にして、読み上げにも出さない。どの図表もこの枠を使い、表の出し方をそろえる。
 */
export function ChartFrame({ name, summary, table, names, children }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tableId = `${id}-table`;
  const captionId = `${id}-caption`;
  return <div className="chart" data-chart={name} data-names={names}>
    {summary === undefined ? children : <div className="chart-figure" role="img" aria-label={summary}>{children}</div>}
    <div className="chart-actions">
      <button data-control-id={`chart.table.${name}`} className="button chart-table-toggle" type="button" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((value) => !value)}>
        表で見る<ChevronRightIcon width="16" height="16" className="chart-table-chevron"/>
      </button>
    </div>
    <div id={tableId} className="ledger-scroll chart-table" role="group" aria-labelledby={captionId} tabIndex={0} hidden={!open}>
      <table className="ledger-table">
        <caption id={captionId}>{table.caption}</caption>
        <thead><tr>{table.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
        <tbody>{table.rows.map((row) => <tr key={row.key}><th scope="row">{row.header}</th>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}
