/** Splits `totalCents` into `count` whole-cent shares. Extra cents go to the first members. */
export function splitCents(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count)
  const extra = totalCents - base * count
  return Array.from({ length: count }, (_, i) => (i < extra ? base + 1 : base))
}
