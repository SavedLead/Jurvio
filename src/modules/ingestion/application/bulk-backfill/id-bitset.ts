/**
 * A growable bitset over non-negative integer ids. CourtListener docket ids run to
 * ~75 million, so "is this docket/cluster one we loaded?" costs ~10 MB here instead
 * of the multi-GB Map the first-generation loader built. Ids beyond `maxId` are not
 * stored; `mayContain` answers true for them so the database join, not this
 * prefilter, stays the source of truth.
 */
export class IdBitset {
  private bits: Uint8Array;
  private count = 0;

  constructor(
    initialIds = 1 << 20,
    private readonly maxId = 2 ** 32,
  ) {
    this.bits = new Uint8Array(Math.ceil(initialIds / 8));
  }

  get size(): number {
    return this.count;
  }

  add(id: string | number): void {
    const value = typeof id === "number" ? id : Number(id);
    if (!Number.isSafeInteger(value) || value < 0 || value >= this.maxId) return;
    const byte = value >>> 3;
    if (byte >= this.bits.length) {
      let length = this.bits.length || 1;
      while (length <= byte) length *= 2;
      const grown = new Uint8Array(length);
      grown.set(this.bits);
      this.bits = grown;
    }
    const mask = 1 << (value & 7);
    if ((this.bits[byte]! & mask) === 0) {
      this.bits[byte] = this.bits[byte]! | mask;
      this.count += 1;
    }
  }

  mayContain(id: string | number): boolean {
    const value = typeof id === "number" ? id : Number(id);
    if (!Number.isSafeInteger(value) || value < 0) return false;
    if (value >= this.maxId) return true;
    const byte = value >>> 3;
    return byte < this.bits.length && (this.bits[byte]! & (1 << (value & 7))) !== 0;
  }
}
