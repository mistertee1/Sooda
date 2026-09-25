import React from 'react';

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  children,
  className = '',
  id,
  ...props
}) => (
  <div className="w-full overflow-x-auto rounded-lg border border-stone-200 bg-white">
    <table id={id} className={`w-full text-start text-xs text-stone-700 ${className}`} {...props}>
      {children}
    </table>
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <thead className={`bg-stone-50 border-b border-stone-200 font-semibold text-stone-600 ${className}`} {...props}>
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <tbody className={`divide-y divide-stone-100 ${className}`} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <tr className={`hover:bg-stone-50/70 transition-colors ${className}`} {...props}>
    {children}
  </tr>
);

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <th className={`px-4 py-3 text-start whitespace-nowrap font-medium text-stone-700 ${className}`} {...props}>
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <td className={`px-4 py-3 text-start align-middle ${className}`} {...props}>
    {children}
  </td>
);

export const TableEmpty: React.FC<{ message: string; colSpan?: number }> = ({
  message,
  colSpan = 5,
}) => (
  <tr>
    <td colSpan={colSpan} className="text-center py-8 text-stone-400 text-xs">
      {message}
    </td>
  </tr>
);
