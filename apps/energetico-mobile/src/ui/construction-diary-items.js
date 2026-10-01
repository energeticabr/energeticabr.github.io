const ITEM_PREFIX = /^(?:[^\S\n]*\d+\.(?:[^\S\n]+|(?=[^\d\s])|$))+/;

export function diaryActivityContent(line) {
  return String(line ?? '').replace(ITEM_PREFIX, '');
}

export function numberDiaryActivityDraft(value, selectionStart = 0, selectionEnd = selectionStart, { terminatePreviousLine = false } = {}) {
  const raw = String(value ?? '');
  const source = raw.replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const beforeCaret = raw.slice(0, selectionStart).replace(/\r\n?/g, '\n');
  const terminatedLine = terminatePreviousLine && beforeCaret.endsWith('\n')
    ? beforeCaret.split('\n').length - 2 : -1;
  const formatted = lines.map((line, index) => {
    let content = diaryActivityContent(line).trimStart();
    if (index === terminatedLine) {
      content = content.trimEnd();
      if (content.trim() && !content.endsWith(';')) content += ';';
    }
    return `${index + 1}. ${content}`;
  });
  function caret(position) {
    const offset = raw.slice(0, position).replace(/\r\n?/g, '\n').length;
    let sourceOffset = 0, targetOffset = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (offset <= sourceOffset + line.length) {
        const content = diaryActivityContent(line);
        const prefixLength = line.length - content.length;
        const leadingSpaceLength = content.length - content.trimStart().length;
        const newPrefixLength = `${index + 1}. `.length;
        const within = offset - sourceOffset;
        return targetOffset + (within < prefixLength
          ? Math.min(within, newPrefixLength)
          : newPrefixLength + Math.max(0, within - prefixLength - leadingSpaceLength));
      }
      sourceOffset += line.length + 1;
      targetOffset += formatted[index].length + 1;
    }
    return formatted.join('\n').length;
  }
  return { value: formatted.join('\n'), selectionStart: caret(selectionStart), selectionEnd: caret(selectionEnd) };
}

export function diaryActivitiesForSubmission(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map(diaryActivityContent).map(line => line.trim()).filter(Boolean)
    .map((line, index) => `${index + 1}. ${line}`).join('\n');
}
