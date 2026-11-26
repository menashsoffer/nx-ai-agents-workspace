import { useId, type ReactNode } from 'react';
import styles from './panel.module.css';
export interface TableColumn {
  id: string;
  label: string;
  /** Row buttons: kept on one line, and shown without a label when the table stacks. */
  actions?: boolean;
}
export interface TableRow {
  id: string;
  cells: Record<string, ReactNode>;
}
interface Props {
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
}
function Cells({ row, columns }: Pick<Props, 'columns'> & { row: TableRow }) {
  return (
    <tr>
      {columns.map((column) =>
        column.id === columns[0]?.id ? (
          <th key={column.id} scope="row">
            {row.cells[column.id]}
          </th>
        ) : (
          <td
            key={column.id}
            // The label each cell shows when a narrow table stacks into cards.
            data-label={column.actions ? undefined : column.label}
            className={column.actions ? styles.actionsCell : undefined}
          >
            {row.cells[column.id]}
          </td>
        ),
      )}
    </tr>
  );
}
export function DataTable({ caption, columns, rows }: Props) {
  const captionId = useId();
  // A scrollable table region must be keyboard reachable (responsive-table guidance).
  return (
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
    <div className={styles.tableRegion} role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className={styles.table}>
        <caption id={captionId}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Cells key={row.id} row={row} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
