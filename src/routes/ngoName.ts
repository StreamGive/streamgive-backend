export function getPublicNgoName(ngo: { name: string; displayName?: string | null }): string {
  return ngo.displayName || ngo.name;
}