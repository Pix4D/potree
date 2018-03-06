export function getIndexFromName(name: string) {
  return parseInt(name.charAt(name.length - 1), 10);
}
