/** Archivos sinteticos para los recursos de demostracion. */

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * PDF valido de una pagina con un titulo y unas lineas de texto. Usa la codificacion WinAnsi:
 * las tildes del espanol se escriben en latin1.
 */
export function simplePdf(title: string, lines: string[]): Buffer {
  const text = [
    'BT /F1 18 Tf 72 770 Td',
    `(${escapePdf(title)}) Tj`,
    '/F1 11 Tf 0 -30 Td 16 TL',
    ...lines.map((line) => `(${escapePdf(line)}) '`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export function csv(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.join(';')).join('\n') + '\n', 'utf8');
}
