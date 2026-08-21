export interface TranscriptCopyItem {
  readonly role: string;
  readonly text: string;
}

export interface ClipboardTextWriter {
  writeText(text: string): Promise<void>;
}

export function transcriptClipboardText(
  items: readonly TranscriptCopyItem[],
): string {
  return items
    .map((item) => `${item.role.toLocaleUpperCase("en-US")}: ${item.text}`)
    .join("\n\n");
}

export async function copyTranscriptToClipboard(
  items: readonly TranscriptCopyItem[],
  clipboard: ClipboardTextWriter,
): Promise<boolean> {
  const text = transcriptClipboardText(items);
  if (text.length === 0) return false;
  await clipboard.writeText(text);
  return true;
}
