export interface CrossDeviceAdaptationRuleData {
  id: string;
  name: string;
  priority: "P0" | "P1";
  kit?: string[];
  rules: Array<{ target: string; llmPrompt: string }>;
}

export const crossDeviceAdaptationRuleData: CrossDeviceAdaptationRuleData[] = [
  {
    id: "RSP-MUST-01",
    name: "横向断点划分范围必须符合系统推荐值",
    priority: "P0",
    kit: ["ArkUI: GridRow / WidthBreakpoint"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查工程中自定义断点系统或 WidthBreakpointType 工具类的断点边界定义，横向断点划分必须为 xs:(0,320)、sm:[320,600)、md:[600,840)、lg:[840,1440)、xl:[1440,+∞)。若使用 GridRow 的 breakpoints.value，值必须为 ['320vp','600vp','840vp','1440vp']。断点边界值与系统推荐不一致即判定失败",
      },
    ],
  },
  {
    id: "RSP-MUST-02",
    name: "布局条件分支必须使用断点枚举值而非硬编码宽度",
    priority: "P0",
    kit: ["ArkUI: WidthBreakpoint"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查所有参与断点计算、断点派发、布局条件判断的代码，包括页面组件、组件、模型、工具类和常量类。不得使用硬编码宽度数值进行断点判断，例如 width < 600、width < 840、vp > 840、screenWidth >= 600。即使硬编码判断位于 BreakpointUtils、WindowModel、constants 等封装层，只要其结果用于布局断点，也判定失败。布局条件必须基于 WidthBreakpoint 枚举、GridRow 标准 breakpoints、mediaquery 查询结果，或已覆盖 sm/md/lg/xl 的断点枚举值",
      },
    ],
  },
  {
    id: "RSP-MUST-03",
    name: "WidthBreakpointType 工具类必须覆盖 sm/md/lg/xl 四个断点",
    priority: "P0",
    kit: ["ArkUI: WidthBreakpoint"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 WidthBreakpointType 工具类定义，构造函数必须接受 sm、md、lg、xl 四个参数，getValue 方法必须根据 WidthBreakpoint 枚举正确返回对应值。缺失任一断点参数或 getValue 分支不完整即判定失败",
      },
    ],
  },
  {
    id: "RSP-MUST-04",
    name: "页面组件必须通过断点系统获取当前断点值",
    priority: "P0",
    kit: ["ArkUI: WidthBreakpoint"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查页面组件获取当前断点值的来源。允许的来源：1. ArkUI/系统提供的 WidthBreakpoint、GridRow breakpoints、@Env 系统断点变量；2. mediaquery.matchMediaSync 或 window.on('windowSizeChange') 驱动的断点状态；3. 项目封装的断点工具，但该工具底层必须来自上述系统断点或标准监听机制。不允许的来源：1. 组件 onAreaChange 回调直接读取 width 后自行计算断点；2. 自定义 calcBreakpoint(width) 使用 600、840 等宽度阈值推导断点；3. 页面或工具类自行用窗口宽度、组件宽度、px/vp 换算结果推导断点。命中任一不允许来源即判定失败",
      },
    ],
  },
  {
    id: "RSP-MUST-05",
    name: "窗口尺寸监听必须基于 on('windowSizeChange') 或者 mediaquery.matchMediaSync",
    priority: "P0",
    kit: ["ArkUI: Window"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查断点更新逻辑是否通过 window.on('windowSizeChange') 回调或 mediaquery.matchMediaSync 监听断点变化。使用 foldStatusChange 或设备方向 API 驱动断点更新即判定失败",
      },
    ],
  },
  {
    id: "RSP-MUST-06",
    name: "注册断点监听的方法必须在 loadContent 回调后调用",
    priority: "P0",
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "本规则只检查 window.on('windowSizeChange') 或 mediaquery.matchMediaSync 等断点监听注册的时序。如果工程没有使用 window.on('windowSizeChange') 或 mediaquery.matchMediaSync 注册断点监听，本规则判定为不涉及；监听方式是否合规由 RSP-MUST-05 判定。如果工程使用 window.on('windowSizeChange') 或 mediaquery.matchMediaSync，则注册动作必须发生在 windowStage.loadContent 成功回调之后。在 loadContent 之前注册，或无法确认注册发生在 loadContent 之后，判定失败。组件 onAreaChange 的注册时序不作为本规则检查对象，但其作为断点来源的合规性由 RSP-MUST-04 判定",
      },
    ],
  },
  {
    id: "RSP-MUST-07",
    name: "GridRow 的 breakpoints.value 必须与系统断点一致",
    priority: "P0",
    kit: ["ArkUI: GridRow"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查所有 GridRow 组件的 breakpoints.value 配置，值必须为 ['320vp','600vp','840vp','1440vp']。自定义栅格断点阈值（如 ['400vp','700vp']）会导致与全局断点系统不同步即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-01",
    name: "List lanes 必须按断点递增设置列数",
    priority: "P0",
    kit: ["ArkUI: List"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查使用 List 组件展示重复内容的页面，lanes 属性必须按断点从小到大非递减设置列数。对同一个 List，sm/md/lg/xl 的列数序列不得下降。例如 1/2/3 满足，2/2/3 满足，4/4/3 不满足，4/3/3 不满足。所有断点列数相同，或较大断点列数小于较小断点，均判定失败",
      },
    ],
  },
  {
    id: "CMP-SHOULD-01",
    name: "List space 建议按断点设置不同间距",
    priority: "P1",
    kit: ["ArkUI: List"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 List 组件的 space 属性是否根据断点设置不同值。sm下如果是单列列表推荐行间距为8vp，md下如果是双列列表推荐列间距为12vp行间距为12vp，lg下如果是三列列表推荐列间距为12vp行间距为16vp",
      },
    ],
  },
  {
    id: "CMP-SHOULD-02",
    name: "List 多列时 divider 应设为 undefined",
    priority: "P1",
    kit: ["ArkUI: List"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 List 组件在 lanes >= 2 时是否将 .divider() 设为 undefined。多列 List 保留 divider 会导致分割线在列间错乱则建议排查",
      },
    ],
  },
  {
    id: "CMP-MUST-02",
    name: "WaterFlow columnsTemplate 必须按断点非递减设置列数",
    priority: "P0",
    kit: ["ArkUI: WaterFlow"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 WaterFlow 组件的 columnsTemplate 是否按断点从小到大非递减设置列数。对同一个 WaterFlow，sm/md/lg/xl 的列数序列不得下降。例如 2/3/4 满足，3/3/4 满足，4/4/3 不满足，3/2/2 不满足。所有断点列数相同，或较大断点列数小于较小断点，均判定失败",
      },
    ],
  },
  {
    id: "CMP-SHOULD-03",
    name: "WaterFlow 动态切换列数应使用 SLIDING_WINDOW 模式",
    priority: "P1",
    kit: ["ArkUI: WaterFlow"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "若要动态设置列数，建议采用瀑布流的移动窗口布局模式，即取值为 WaterFlowLayoutMode 枚举说明中的 SLIDING_WINDOW，从而实现更快速的列数转换",
      },
    ],
  },
  {
    id: "CMP-SHOULD-04",
    name: "WaterFlow 应通过 itemConstraintSize 设置子组件约束尺寸",
    priority: "P1",
    kit: ["ArkUI: WaterFlow"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查图片或卡片类 WaterFlow 是否通过 itemConstraintSize 或等效的子项尺寸约束控制卡片尺寸。若未设置 itemConstraintSize，但每个 FlowItem 或其根容器已通过明确的 maxWidth/maxHeight/constraintSize/width/height 控制尺寸，可判定为满足。仅 padding、文本内容自适应或 aspectRatio 单独存在，不视为等效约束。如果 WaterFlow 不是图片或卡片瀑布流，判定为不涉及",
      },
    ],
  },
  {
    id: "CMP-MUST-03",
    name: "Swiper displayCount 必须按断点递增",
    priority: "P0",
    kit: ["ArkUI: Swiper"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Swiper 组件的 displayCount 是否按断点从小到大非递减设置。对同一个 Swiper，sm/md/lg/xl 的 displayCount 序列不得下降。例如 1/2/3 满足，2/2/3 满足，3/2/2 不满足，2/1/1 不满足。所有断点 displayCount 相同，或较大断点值小于较小断点，均判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-04",
    name: "Swiper indicator 必须按 displayCount 正确显隐",
    priority: "P0",
    kit: ["ArkUI: Swiper / indicator / displayCount"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Swiper 组件的 indicator 属性：displayCount 为 1（单元素展示）时应显示圆点指示器 Indicator.dot()，displayCount >= 2（多元素展示）时必须设为 false。多元素展示时仍显示圆点指示器会导致指示点位置错乱即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-05",
    name: "Grid columnsTemplate 必须按断点非递减设置列数",
    priority: "P0",
    kit: ["ArkUI: Grid / columnsTemplate"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Grid 组件的 columnsTemplate 是否按断点从小到大非递减设置列数。对同一个 Grid，sm/md/lg/xl 的列数序列不得下降。例如 1/2/3 满足，2/2/3 满足，4/4/3 不满足，4/3/3 不满足。所有断点列数相同，或较大断点列数小于较小断点，均判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-06",
    name: "SideBarContainer showSideBar 必须按断点动态控制",
    priority: "P0",
    kit: ["ArkUI: SideBarContainer / showSideBar"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 SideBarContainer 组件的 showSideBar 属性是否根据断点动态设置：sm 断点默认 false（隐藏侧边栏），md/lg 断点默认 true（显示侧边栏，充分利用横向空间展示辅助内容）。所有断点 showSideBar 值固定不变即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-07",
    name: "SideBarContainer sideBarWidth 必须按断点设置不同宽度",
    priority: "P0",
    kit: ["ArkUI: SideBarContainer / sideBarWidth"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 SideBarContainer 组件的 sideBarWidth 是否根据断点设置不同值。所有断点 sideBarWidth 值相同即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-08",
    name: "SideBarContainer 类型必须按断点区分 Overlay 和 Embed",
    priority: "P0",
    kit: ["ArkUI: SideBarContainer / SideBarContainerType"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 SideBarContainer 组件的构造参数是否根据断点区分：sm 使用 SideBarContainerType.Overlay（浮层模式，侧边栏浮在内容区上），md/lg 使用 SideBarContainerType.Embed（嵌入模式，侧边栏和内容区并列展示）。所有断点使用相同类型即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-17",
    name: "Swiper 多元素展示必须设置前后边距",
    priority: "P0",
    kit: ["ArkUI: Swiper / indicator / displayCount"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "横向sm断点下如果只展示一个元素，则无需设置前后边距，横向md断点下如果展示两个元素则建议设置前后边距12vp，横向lg断点下如果展示三个元素建议设置前后边距64vp",
      },
    ],
  },
  {
    id: "CMP-SHOULD-05",
    name: "Navigation 双栏时 navBarWidth 应设置为合理比例",
    priority: "P1",
    kit: ["ArkUI: Navigation / navBarWidth"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Navigation 组件在 Split 模式下是否设置了 navBarWidth。双栏时未设置 navBarWidth 导致导航栏占比不合理则建议排查",
      },
    ],
  },
  {
    id: "CMP-MUST-10",
    name: "Tabs vertical 必须按断点切换横向和纵向",
    priority: "P0",
    kit: ["ArkUI: Tabs"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查主导航 Tabs 组件的 vertical 属性是否根据断点动态设置：sm/md 断点 vertical 为 false（底部横向导航），lg 断点 vertical 为 true（侧边纵向导航）。所有断点 vertical 值相同即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-11",
    name: "Tabs barPosition 必须按断点切换 End 和 Start",
    priority: "P0",
    kit: ["ArkUI: Tabs"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Tabs 组件的 barPosition 属性是否根据断点动态设置：sm/md 断点为 BarPosition.End（底部），lg 断点为 BarPosition.Start（左侧）。barPosition 与 vertical 不匹配（如 vertical:true 但 barPosition:End）即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-12",
    name: "Tabs barWidth 和 barHeight 必须按断点设置",
    priority: "P0",
    kit: ["ArkUI: Tabs"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Tabs 组件的 barWidth 和 barHeight 是否根据断点动态设置。barWidth/barHeight 在所有断点保持固定值即判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-13",
    name: "GridRow columns 必须按断点非递减设置列数",
    priority: "P0",
    kit: ["ArkUI: GridRow"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 GridRow 组件的 columns 属性是否按断点从小到大非递减设置列数。对同一个 GridRow，sm/md/lg/xl 的列数序列不得下降。列数不随断点非递减、所有断点列数相同、或较大断点列数小于较小断点，均判定失败",
      },
    ],
  },
  {
    id: "CMP-MUST-14",
    name: "GridCol span 必须按断点声明不同的占据列数",
    priority: "P0",
    kit: ["ArkUI: GridCol"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查需要响应式适配的 GridCol 组件，sm/md/lg 断点下 span 值必须不同，以实现挪移或缩进等响应式布局效果。判定条件：如果 GridCol 所在 GridRow 的 columns 按断点变化（即 GridRow 本身是响应式的），则该 GridCol 的 span 必须按断点设置不同值；如果 GridCol 在所有断点都占据全部列数（如全宽横幅），或 GridRow 的 columns 在所有断点都相同，则判定为不涉及。在需要响应式适配的情况下，所有断点 span 相同即判定失败",
      },
    ],
  },
  {
    id: "CMP-SHOULD-06",
    name: "GridRow 应配置 gutter 属性",
    priority: "P1",
    kit: ["ArkUI: GridRow"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 GridRow 组件是否配置了 gutter.x 和 gutter.y 属性。缺失 gutter 导致栅格子组件之间无间距则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-SHOULD-07",
    name: "缩进布局应使用 GridCol offset 实现居中留白",
    priority: "P1",
    kit: ["ArkUI: GridCol"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查需要在大屏居中展示的内容区域是否通过 GridCol 的 offset 属性实现两侧留白。使用硬编码 margin/padding 模拟缩进而非栅格 offset 则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-MUST-15",
    name: "Flex 拉伸布局必须合理设置 flexGrow 和 flexShrink",
    priority: "P0",
    kit: ["ArkUI: Flex"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Flex 拉伸布局中，需要随容器伸缩的内容区子组件是否设置了 flexGrow(>=1)，需要固定尺寸的留白区子组件是否设置了 flexShrink(0)。所有子组件使用相同的 flexGrow/flexShrink 值或未设置拉伸/收缩属性即判定失败",
      },
    ],
  },
  {
    id: "CMP-SHOULD-08",
    name: "Flex 均分布局应使用 FlexAlign.SpaceEvenly",
    priority: "P1",
    kit: ["ArkUI: Flex"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Flex 等间距均分布局（如工具栏、菜单栏）是否将 justifyContent 属性设置为 FlexAlign.SpaceEvenly。使用固定 margin/padding 手动计算间距来实现均分则建议排查",
      },
    ],
  },
  {
    id: "CMP-SHOULD-09",
    name: "Flex 折行布局应设置 wrap 为 FlexWrap.Wrap",
    priority: "P1",
    kit: ["ArkUI: Flex"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查内容可能溢出容器宽度的 Flex 布局是否设置了 wrap: FlexWrap.Wrap。使用固定列数或手动计算换行位置则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-SHOULD-10",
    name: "Row/Column 占比布局中子组件应使用 layoutWeight",
    priority: "P1",
    kit: ["ArkUI: Row / Column"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Row/Column/Flex 容器中需要按比例分配空间的兄弟子组件是否使用 layoutWeight 属性或百分比（%）形式的 width/height。使用固定 vp 值导致无法随容器自适应则建议排查",
      },
    ],
  },
  {
    id: "CMP-SHOULD-11",
    name: "Row/Column 中随尺寸变化的显隐子组件应设置 displayPriority",
    priority: "P1",
    kit: ["ArkUI: Row / Column"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Row/Column/Flex 容器中需要随容器尺寸变化自动显示或隐藏的子组件是否设置了 displayPriority 属性控制显隐优先级。使用 if 条件判断配合断点手动控制显隐而非 displayPriority 则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-SHOULD-12",
    name: "Row/Column/Flex 中固定元素间的空白应使用 Blank 组件填充",
    priority: "P1",
    kit: ["ArkUI: Row / Column / Flex"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Row/Column/Flex 中固定元素（如文字与开关）之间的空白区域是否使用 Blank 组件填充剩余空间。使用固定 width/height 的空容器模拟空白区域则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-SHOULD-13",
    name: "横向延伸内容应使用 Scroll 配合 Row 实现",
    priority: "P1",
    kit: ["ArkUI: Scroll"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查横向可延伸的内容列表是否使用 Scroll 组件配合 Row/Column（设置 scrollable(ScrollDirection.Horizontal)）或使用 List 的 listDirection(Axis.Horizontal) 实现延伸能力。内容超出容器宽度但未使用可滚动容器则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-SHOULD-14",
    name: "需要保持宽高比的容器子组件应设置 aspectRatio",
    priority: "P1",
    kit: ["ArkUI: aspectRatio"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查需要随容器尺寸变化但保持固定宽高比的子组件（如图片容器、卡片）是否设置了 aspectRatio 属性，同时宽或高使用百分比或自适应尺寸。宽高都使用固定 vp 值且未设置 aspectRatio 则建议排查是否合理",
      },
    ],
  },
  {
    id: "CMP-SHOULD-15",
    name: "容器子组件的 aspectRatio 建议根据断点设置不同宽高比",
    priority: "P1",
    kit: ["ArkUI: aspectRatio"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查设置了 aspectRatio 的子组件是否根据断点设置不同宽高比（如 sm 断点使用 4:3 适配竖屏，lg 断点使用 16:9 适配宽屏）。所有断点 aspectRatio 值相同则建议排查是否合理",
      },
    ],
  },
  {
    id: "HOV-MUST-01",
    name: "悬停态页面布局必须将展示类组件置于上半屏、交互类组件置于下半屏",
    priority: "P0",
    kit: ["ArkUI: FolderStack / FoldSplitContainer / display"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查悬停态页面的布局结构，展示类组件（如视频画面、图片预览、游戏画面）必须位于上半屏区域，交互类组件（如播放控制、返回按钮、操作手柄）必须位于下半屏区域。交互类组件出现在上半屏或展示类组件出现在下半屏即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-02",
    name: "悬停态布局必须避让折叠屏折痕区域",
    priority: "P0",
    kit: ["ArkUI: FolderStack / FoldSplitContainer / display"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查悬停态布局是否对折痕区域进行了避让处理：使用 FolderStack 或 FoldSplitContainer 时组件会自动避让，自定义实现时必须通过 display.getCurrentFoldCreaseRegion() 获取折痕位置和大小，并据此计算上下半屏组件的位置和尺寸。未处理折痕避让导致内容覆盖折痕区域即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-03",
    name: "FolderStack 必须撑满页面全屏",
    priority: "P0",
    kit: ["ArkUI: FolderStack"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 FolderStack 组件的尺寸设置，宽高必须为 100% 或通过 .expandSafeArea 等方式撑满页面全屏。FolderStack 未撑满全屏时只会作为普通 Stack 使用，不具备悬停态布局能力即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-04",
    name: "FolderStack upperItems 必须正确注册展示类组件 ID",
    priority: "P0",
    kit: ["ArkUI: FolderStack"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 FolderStack 的 upperItems 数组，只应包含需要在悬停态时置于上半屏的展示类组件 ID，交互类组件（按钮、滑块、输入框等）的 ID 不得出现在 upperItems 中。upperItems 中包含交互类组件 ID 或展示类组件未注册到 upperItems 即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-05",
    name: "FolderStack upperItems 中的组件必须设置 id 属性",
    priority: "P0",
    kit: ["ArkUI: FolderStack"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 FolderStack 中需要注册到 upperItems 的子组件是否通过 .id('xxx') 设置了唯一标识，且 id 字符串值与 upperItems 数组中的字符串一致。子组件未设置 id 或 id 值与 upperItems 中的字符串不匹配即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-06",
    name: "FoldSplitContainer 的 primary 必须用于上半屏内容、secondary 必须用于下半屏内容",
    priority: "P0",
    kit: ["ArkUI: FoldSplitContainer"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 FoldSplitContainer 组件的 primary 回调中是否放置展示类组件（上半屏），secondary 回调中是否放置交互类组件（下半屏）。primary 中放置交互类控件或 secondary 中放置展示类内容即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-07",
    name: "自定义悬停态必须同时判断半折叠状态和横屏方向",
    priority: "P0",
    kit: ["ArkUI: display"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查自定义悬停态的判断逻辑，必须同时满足两个条件：display.on('foldStatusChange') 回调中 foldStatus 为 FOLD_STATUS_HALF_FOLDED，且 display.getDefaultDisplaySync().orientation 为 LANDSCAPE 或 LANDSCAPE_INVERTED。仅判断折叠状态不判断横屏方向，或仅判断横屏方向不判断折叠状态即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-08",
    name: "自定义悬停态必须通过 getCurrentFoldCreaseRegion 获取折痕区域",
    priority: "P0",
    kit: ["ArkUI: display"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查自定义悬停态布局中折痕区域的获取方式，必须使用 display.getCurrentFoldCreaseRegion() 接口获取折痕位置（rect.top）和高度（rect.height），并通过 px2vp 转换为 vp 值。使用硬编码数值作为折痕区域或未调用该接口即判定失败",
      },
    ],
  },
  {
    id: "HOV-MUST-09",
    name: "自定义悬停态退出页面时必须取消 foldStatusChange 监听",
    priority: "P0",
    kit: ["ArkUI: display"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查使用 display.on('foldStatusChange') 注册监听的页面，必须在页面销毁（aboutToDisappear）或退出悬停态场景时调用 display.off('foldStatusChange') 取消监听。未在适当时机调用 off 取消监听即判定失败",
      },
    ],
  },
  {
    id: "HOV-SHOULD-01",
    name: "自定义悬停态应根据折痕区域动态调整组件尺寸和位置",
    priority: "P1",
    kit: ["ArkUI: display"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查自定义悬停态实现中，上半屏展示组件的 height 是否根据折痕区域顶部位置（creaseRegion[0]）动态设置，下半屏交互组件是否根据折痕区域底部（creaseRegion[0] + creaseRegion[1]）计算起始位置。使用固定 vp 值设置组件位置而非基于折痕区域计算则建议排查是否合理",
      },
    ],
  },
  {
    id: "WEB-MUST-01",
    name: "Web 组件容器尺寸必须按断点动态设置",
    priority: "P0",
    kit: ["ArkUI: Web"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件的 width 和 height 属性是否根据断点动态设置，不得使用固定 vp 值。Web 组件容器必须随断点变化自适应调整尺寸，使用固定宽高导致在不同设备上内容显示不完整或留白过多即判定失败",
      },
    ],
  },
  {
    id: "WEB-MUST-02",
    name: "Native 侧断点变化时必须将断点信息同步至 Web 组件",
    priority: "P0",
    kit: ["ArkUI: Web / runJavaScript"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查使用 Web 组件的页面，当断点发生变化时，是否通过 WebController.runJavaScript() 或 javaScriptProxy 将当前断点值（sm/md/lg/xl）同步给 Web 侧。Native 侧断点变化后未通知 Web 组件导致 Web 侧布局未及时更新即判定失败",
      },
    ],
  },
  {
    id: "WEB-MUST-03",
    name: "Web 组件必须通过 on('windowSizeChange') 驱动断点同步而非 foldStatusChange",
    priority: "P0",
    kit: ["ArkUI: Web / Window"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件所在页面的断点监听方式，必须通过 window.on('windowSizeChange') 或 mediaquery 驱动断点变化后同步给 Web 组件，与 RSP-MUST-05 保持一致。使用 foldStatusChange 或设备方向 API 驱动 Web 组件断点更新即判定失败",
      },
    ],
  },
  {
    id: "WEB-MUST-04",
    name: "Web 侧媒体查询断点范围必须与系统断点一致",
    priority: "P0",
    kit: ["ArkUI: Web"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件加载的页面资源中 CSS 媒体查询断点范围，必须为 sm:[320px,600px)、md:[600px,840px)、lg:[840px,+∞)。Web 侧媒体查询使用与系统断点不一致的范围（如 sm:[300px,500px)）即判定失败",
      },
    ],
  },
  {
    id: "WEB-MUST-05",
    name: "Web 侧纵向断点必须使用宽高比（aspect-ratio）而非高宽比",
    priority: "P0",
    kit: ["ArkUI: Web"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件加载的页面资源中涉及纵向断点判断的 CSS 媒体查询，必须使用 aspect-ratio（宽高比，如 min-aspect-ratio: 1/1.2）而非 HarmonyOS 侧的高宽比。Web 侧使用 height/width 形式或使用 orientation 区分纵向断点即判定失败",
      },
    ],
  },
  {
    id: "WEB-SHOULD-01",
    name: "Web 侧布局属性应使用相对单位而非固定像素值",
    priority: "P1",
    kit: ["ArkUI: Web"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件加载的页面资源中，元素的尺寸、间距等布局属性是否优先使用百分比（%）、rem、vw/vh 等相对单位而非固定 px 值。布局关键属性（宽度、间距）全部使用固定 px 值导致无法随容器自适应则建议排查是否合理",
      },
    ],
  },
  {
    id: "WEB-SHOULD-02",
    name: "Web 侧宫格布局列数应按断点递增",
    priority: "P1",
    kit: ["ArkUI: Web"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件加载的页面资源中使用 CSS Grid 宫格布局的区域，grid-template-columns 的列数是否在不同断点下递增（如 sm:repeat(4,1fr)、md:repeat(6,1fr)、lg:repeat(8,1fr)）。所有断点宫格列数相同则建议排查是否合理",
      },
    ],
  },
  {
    id: "WEB-SHOULD-03",
    name: "Web 侧轮播布局 displayCount 应按断点递增且按条件显隐指示器",
    priority: "P1",
    kit: ["ArkUI: Web"],
    rules: [
      {
        target: "**/*.ets",
        llmPrompt: "检查 Web 组件加载的页面资源中轮播组件的实现：sm 断点应显示单张轮播元素并展示圆点指示器，md/lg 断点应同时显示多张轮播元素（displayCount >= 2）并隐藏圆点指示器。所有断点轮播元素显示数量相同或指示器显隐策略不随 displayCount 变化则建议排查是否合理",
      },
    ],
  },
];
