
@ComponentV2
export struct CircleButton {

  @Param @Require
  public symbol: Resource;

  @Param
  public symbolSize: number | string | Resource = 18;

  public build() {
    Button() {
      SymbolGlyph(this.symbol)
        .fontSize(this.symbolSize)
        .fontColor([$r('sys.color.icon_primary')])
        .fontWeight(FontWeight.Normal)
    }
    .width(40)
    .height(40)
    .type(ButtonType.Circle)
    .backgroundColor($r('sys.color.comp_background_tertiary'))
  }
}
