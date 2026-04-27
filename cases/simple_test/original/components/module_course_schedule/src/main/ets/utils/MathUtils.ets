

export class MathUtils {
  /**
   * 取模运算。
   */
  public static mod(n: number, m: number): number {
    return ((n % m) + m) % m;
  }
}
