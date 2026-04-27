
const DEFAULT_COLORS: readonly string[] = [
  '#FF564AF7',
  '#FF46B1E3',
  '#FF61CFBE',
  '#FF64BB5C',
  '#FFAC49F5',
  '#FFE64566',
  '#FFE84026',
  '#FFED6F21',
  '#FFF9A01E',
  '#FFF7CE00'
];

export class ColorPalette {

  private static _index: number = 0;

  public static getColor(index: number, alpha: number = 1.0): string {
    const color: string = DEFAULT_COLORS[index] ?? DEFAULT_COLORS[0];
    return ColorPalette.applyAlpha(color, alpha);
  }

  public static nextColor(alpha: number = 1.0): string {
    const color: string = DEFAULT_COLORS[ColorPalette._index];
    ColorPalette._index = (ColorPalette._index + 1) % DEFAULT_COLORS.length;
    return ColorPalette.applyAlpha(color, alpha);
  }

  public static setIndexByColor(hexColor: string): void {
    const normalized: string = ColorPalette.applyAlpha(hexColor, 1.0);
    const index: number = DEFAULT_COLORS.findIndex(
      color => color.toUpperCase() === normalized.toUpperCase()
    );
    if (index >= 0) {
      ColorPalette._index = (index + 1) % DEFAULT_COLORS.length;
    }
  }

  public static applyAlpha(hexColor: string, alpha: number): string {
    const a: number = Math.max(0, Math.min(1, alpha));
    const alphaHex: string = ColorPalette.toHex2(Math.round(a * 255));
    const s: string = hexColor.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) {
      return `#${alphaHex}${s.slice(1).toUpperCase()}`;
    }
    if (/^#[0-9a-fA-F]{8}$/.test(s)) {
      return `#${alphaHex}${s.slice(3).toUpperCase()}`;
    }
    throw new Error(`ColorPalette.applyAlpha: invalid hex color: ${hexColor}`);
  }

  private static toHex2(n: number): string {
    return n.toString(16).padStart(2, '0').toUpperCase();
  }
}
