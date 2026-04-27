import { ViewModelState } from '../common/CustomTypes';
import { CheckinPageVM } from '../viewmodels/CheckinPageVM';
import { TitleBar } from '../components/TitleBar';
import { UIVerifyCodeInput } from '../components/UIVerifyCodeInput';
import { MOCK_CHECKIN_CODE } from '../http/Api';

@ComponentV2
export struct CheckinPage {

  private checkinMgr: CheckinPageVM = new CheckinPageVM(this.getUIContext());

  private navPathStack: NavPathStack = new NavPathStack();

  public build(): void {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
        Column()
          .linearGradient({
            direction: GradientDirection.Bottom,
            colors: [
              [$r('sys.color.multi_color_09'), 0.0],
              [$r('sys.color.background_secondary'), 1.0]
            ]
          })
          .width('100%')
          .height('25%')
          .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        Column() {
          TitleBar({
            title: '课堂签到',
            onBackButtonClick: () => this.navPathStack.pop()
          })
          Stack({ alignContent: Alignment.TopStart }) {
            Scroll() {
              this.buildMainContent()
            }
            .height('100%')
            .scrollBar(BarState.Auto)
            .edgeEffect(EdgeEffect.None)
            if (this.checkinMgr.isLoading) {
              this.buildLoadingMask();
            }
          }
          .layoutWeight(1)
        }
        .width('100%')
        .height('100%')
        .alignItems(HorizontalAlign.Start)
        .justifyContent(FlexAlign.Start)
      }
      .backgroundColor($r('sys.color.background_secondary'))
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .hideTitleBar(true)
    .hideToolBar(true)
    .onReady((ctx: NavDestinationContext) => {
      this.navPathStack = ctx.pathStack;
    })
  }

  @Builder
  private buildMainContent(): void {
    Column() {
      RelativeContainer() {
        this.buildCheckinInput();
        this.buildCheckinTips();
        Button() {
          Text('确定')
            .fontSize($r('sys.float.Body_M'))
            .fontColor($r('sys.color.font_on_primary'))
        }
        .height(40)
        .padding({ top: 8, bottom: 8 })
        .alignRules({
          top: { anchor: 'sign_in_tip_content', align: VerticalAlign.Bottom },
          left: { anchor: '__container__', align: HorizontalAlign.Start },
          right: { anchor: '__container__', align: HorizontalAlign.End }
        })
        .backgroundColor($r('sys.color.multi_color_09'))
        .margin({ top: 38, left: 16, right: 16 })
        .enabled(!this.checkinMgr.isCheckedIn && this.checkinMgr.checkinCode.length === 4)
        .onClick(() => {
          this.checkinMgr.doCheckin();
          this.getUIContext().getFocusController().clearFocus();
        })
      }
      .width('100%')
      .height('auto')
    }
    .width('100%')
    .constraintSize({ minHeight: '100%' })
    .alignItems(HorizontalAlign.Center)
    .justifyContent(FlexAlign.Start)
  }

  @Builder
  public buildCheckinInput(): void {
    Image($r('app.media.ic_sign_in_code_bg'))
      .height(80)
      .margin({ top: 12, left: 24, right: 24 })
      .objectFit(ImageFit.Fill)
      .alignRules({
        left: { anchor: '__container__', align: HorizontalAlign.Start },
        right: { anchor: '__container__', align: HorizontalAlign.End },
      })
      .id('sign_in_code_bg')
    RelativeContainer() {
      if (this.checkinMgr.state === ViewModelState.READY) {
        if (this.checkinMgr.isCheckedIn) {
          Column() {
            Text(this.checkinMgr.courseName)
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
            Image($r('app.media.ic_sign_in_success'))
              .size({ width: 64, height: 64 })
              .objectFit(ImageFit.Fill)
              .margin({ top: 12 })
            Text('签到成功')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .margin({ top: 12 })
          }
          .width('100%')
          .height('auto')
          .id('verify_tips')
        } else {
          Text('点击输入四位数签到码')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .alignRules({
              middle: { anchor: '__container__', align: HorizontalAlign.Center }
            })
            .id('verify_tips')
        }
        UIVerifyCodeInput({
          textInputContents: this.checkinMgr.checkinCode.split(''),
          verifyEnable: !this.checkinMgr.isCheckedIn,
          onFinishInput: (code: string) => {
            this.checkinMgr.checkinCode = code;
            this.checkinMgr.showErrorTips = false;
          },
          onCodeChange: (code: string) => {
            this.checkinMgr.checkinCode = code;
          }
        })
          .width(196)
          .margin({ top: 24 })
          .alignRules({
            top: { anchor: 'verify_tips', align: VerticalAlign.Bottom },
            middle: { anchor: '__container__', align: HorizontalAlign.Center }
          })
          .id('verify_input')
        if (this.checkinMgr.showErrorTips) {
          Row() {
            Image($r('app.media.ic_code_error_tips'))
              .size({ width: 11, height: 11 })
              .objectFit(ImageFit.Fill)
            Text('请输入正确的签到码')
              .fontSize(8)
              .fontColor('#FFE84026')
              .margin({ left: 8 })
          }
          .alignRules({
            top: { anchor: 'verify_input', align: VerticalAlign.Bottom },
            start: { anchor: 'verify_input', align: HorizontalAlign.Start }
          })
          .margin({ top: 8 })
          .id('code_error_container')
        }
      } else {
        Column()
          .height(82)
      }
    }
    .backgroundColor(Color.White)
    .height('auto')
    .alignRules({
      top: { anchor: 'sign_in_code_bg', align: VerticalAlign.Bottom },
      left: { anchor: '__container__', align: HorizontalAlign.Start },
      right: { anchor: '__container__', align: HorizontalAlign.End }
    })
    .borderRadius({ bottomLeft: 16, bottomRight: 16 })
    .margin({ top: -10.5, left: 44, right: 44 })
    .padding({ top: 16, bottom: 24 })
    .id('sign_input_container')
  }

  @Builder
  public buildCheckinTips(): void {
    Text('说明：')
      .fontSize(16)
      .fontWeight(FontWeight.Bold)
      .alignRules({
        top: { anchor: 'sign_input_container', align: VerticalAlign.Bottom }
      })
      .margin({ top: 24, left: 33 })
      .id('sign_in_tip_title')
    Text() {
      Span('1、正确输入任课老师公布的四位数签到码')
      Span('\n\n')
      Span('2、未签到成功的同学，请找老师补签')
      Span('\n\n')
      Span('3、当前为开发模式，签到码默认为: ' + MOCK_CHECKIN_CODE)
        .fontColor(Color.Blue)
    }
    .fontSize(12)
    .fontColor($r('sys.color.mask_secondary'))
    .alignRules({
      top: { anchor: 'sign_in_tip_title', align: VerticalAlign.Bottom },
      left: { anchor: 'sign_in_tip_title', align: HorizontalAlign.Start }
    })
    .margin({ top: 16 })
    .id('sign_in_tip_content')
  }

  @Builder
  private buildLoadingMask(showLoadingProgress: boolean = true): void {
    Column() {
      if (showLoadingProgress) {
        LoadingProgress()
          .width(32)
          .height(32)
      }
    }
    .width('100%')
    .height('100%')
    .padding({ bottom: 56 })
    .justifyContent(FlexAlign.Center)
    .hitTestBehavior(HitTestMode.Block)
    .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}

@Builder
export function buildCheckinPage(): void {
  CheckinPage();
}
