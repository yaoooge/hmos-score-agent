
@ComponentV2
export struct TitleBar {

  @Param
  public title: string | Resource = '';

  @Param
  public hideBackButton: boolean = false;

  @Param
  public barColor: ResourceColor = Color.Transparent;

  @Param
  public barExpandSafeArea: boolean = true;

  @Event
  public onBackButtonClick: () => void = () => {};

  public build(): void {
    Row() {
      Row() {
        if (!this.hideBackButton) {
          Column() {
            Image($r('app.media.ic_arrow_back'))
              .objectFit(ImageFit.Fill)
              .width(40)
              .height(40)
          }
          .width(56)
          .height(56)
          .alignItems(HorizontalAlign.End)
          .justifyContent(FlexAlign.Center)
          .onClick(this.onBackButtonClick)
        }
        Text(this.title)
          .fontSize($r('sys.float.Title_S'))
          .fontColor($r('sys.color.font_primary'))
          .fontWeight(FontWeight.Bold)
          .margin({ left: 8 })
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .height('100%')
      .alignItems(VerticalAlign.Center)
      .justifyContent(FlexAlign.Start)
      .backgroundColor(this.barColor)
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], this.barExpandSafeArea ? [SafeAreaEdge.TOP] : [])
    }
    .width('100%')
    .height(56)
  }
}
