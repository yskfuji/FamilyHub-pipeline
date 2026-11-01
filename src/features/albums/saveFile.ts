/** ファイルを端末へ保存する。実際のファイルをブラウザの保存に渡す（保存先はブラウザの設定による）。 */
export function saveFile(url: string, name: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
