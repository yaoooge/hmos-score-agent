@Entry
@ComponentV2
struct Index {
  build() {
    Column({ space: 12 }) {
      Text('餐厅管理后台')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor('#1F2937')

      Text('元服务工程基座')
        .fontSize(16)
        .fontColor('#6B7280')

      Text('该工程用于 requirement_008 元服务静默登录用例。')
        .fontSize(14)
        .fontColor('#6B7280')
        .textAlign(TextAlign.Center)
        .margin({ top: 8 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding(24)
    .backgroundColor('#F7F8FA')
  }
}
