/**
 * CSV for exporting tables. Values are written as the API sent them (numbers are
 * not rounded or formatted), so a spreadsheet gets the exact figures.
 */
export type CsvValue = string | number | boolean | null | undefined;

/** One field: quoted when it holds a comma, quote or line break; missing values are empty. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Header row plus data rows, CRLF line endings (what spreadsheets expect). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Saves `text` as a .csv file through the browser's download. */
export function downloadCsv(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
