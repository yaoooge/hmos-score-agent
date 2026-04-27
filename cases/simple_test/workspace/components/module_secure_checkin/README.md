# 签到组件快速入门

## 目录

- [简介](#简介)
- [约束与限制](#约束与限制)
- [使用](#使用)
- [API参考](#API参考)
- [示例代码](#示例代码)

## 简介

本组件提供课堂签到功能，支持根据实时位置与验证码进行签到。

<img src="screenshots/checkin.jpg" width="300">

## 约束与限制

### 环境

* DevEco Studio版本：DevEco Studio 5.1.0 Release及以上
* HarmonyOS SDK版本：HarmonyOS 5.1.0 Release SDK及以上
* 设备类型：华为手机（包括双折叠和阔折叠）
* 系统版本：HarmonyOS 5.1.0(18)及以上

### 权限

* 网络权限：ohos.permission.INTERNET
* 位置权限：ohos.permission.LOCATION
* 模糊位置权限：ohos.permission.APPROXIMATELY_LOCATION

## 使用

1. 安装组件。

   如果是在DevEco Studio使用插件集成组件，则无需安装组件，请忽略此步骤。

   如果是从生态市场下载组件，请参考以下步骤安装组件。

   a. 解压下载的组件包，将包中所有文件夹拷贝至您工程根目录的XXX目录下。

   b. 在项目根目录build-profile.json5添加module_secure_checkin模块。

   ```
   // 项目根目录下build-profile.json5填写module_secure_checkin路径。其中XXX为组件存放的目录名
   "modules": [
     {
       "name": "module_secure_checkin",
       "srcPath": "./XXX/module_secure_checkin"
     }
   ]
   ```

   c. 在项目根目录 oh-package.json5 中添加依赖。

   ```
   // XXX 为组件存放的目录名称
   "dependencies": {
     "module_secure_checkin": "file:./XXX/module_secure_checkin"
   }
   ```

2. 引入组件。

   ```
   import { CHECKIN_PAGE_NAME } from 'module_secure_checkin';
   ```

## API参考

不涉及。

## 示例代码

```
import { CHECKIN_PAGE_NAME } from 'module_secure_checkin';

@Entry
@ComponentV2
struct Index {

  private navPathStack: NavPathStack = new NavPathStack()

  public build(): void {
    Navigation(this.navPathStack) {
      Column() {
        Button('课堂签到')
          .onClick(() => this.navPathStack.pushPathByName(CHECKIN_PAGE_NAME, null))
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
    }
    .hideTitleBar(true)
    .mode(NavigationMode.Stack)
  }
}
```
