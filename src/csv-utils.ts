/** 写 CSV 时转义单个字段：含逗号/引号/换行时用双引号包裹并把内部引号翻倍。 */
export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 把一行字段拼成 CSV 行（不含行尾换行）。 */
export function csvRow(fields: string[]): string {
  return fields.map(csvEscape).join(',');
}
