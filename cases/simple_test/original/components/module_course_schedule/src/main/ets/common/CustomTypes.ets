
/**
 * 周选择模式
 */
export enum WeekSelectMode {
  All = 'ALL',   // 全选
  Odd = 'ODD',   // 单周
  Even = 'EVEN', // 双周
  Custom = 'CUSTOM' // 自定义
}

/**
 * 时段
 */
export enum DayPart {
  Morning = 'MORNING',
  Afternoon = 'AFTERNOON',
  Evening = 'EVENING'
}

/**
 * 课程表
 */
export interface Timetable {
  id: string;         // 唯一标识
  semester: Semester; // 学期信息
  periods: Period[];  // 节次时间表，按照索引顺序，0 为第一节
  courses: Course[];  // 课程数据
}

/**
 * 学期信息
 */
export interface Semester {
  label: string;        // 学期描述
  anchorTimeMs: number; // 学期的基准/锚点时间戳，即开学后第一节课所在的日期，并非开学日期
  weekCount: number;    // 该学期共有多少周 (受当前设计约束，不可以超过 31 周)
}

/**
 * 课程节次
 */
export interface Period {
  dayPart: DayPart; // 所处时段，上午、下午、晚上
  startMin: number; // 起始时间 [0, 60 * 24)
  endMin: number;   // 结束时间 (startMin, 60 * 24)
}

/**
 * 课程
 */
export interface Course {
  id: string;    // 唯一标识
  name: string;  // 课程名
  color: string; // 课程颜色
  arrangements: CourseArrangement[]; // 课程安排
}

/**
 * 课程安排
 */
export interface CourseArrangement {
  id: string;          // 唯一标识
  courseId: string;    // 所属课程唯一标识
  dayOfWeek: number;   // 课程在星期几 (0: 周日, 1: 周一...)
  periodStart: number; // 起始节数索引 (0: 第一节, 1: 第二节...)
  periodEnd: number;   // 终止节数索引
  location: string;    // 授课地点
  teacher: string;     // 授课教师
  weekMask: number;    // 周选择掩码 (即课程属于哪些周)
}

/**
 * 课程预览项
 */
export interface CourseOverviewItem {
  courseId: string;       // 所属课表id
  arrangementId: string;  // 所属课程安排id
  name: string;           // 课程名
  dayOfWeek: number;      // 课程在星期几 (0: 周日, 1: 周一...)
  periodStart: number;    // 起始节数索引 (0: 第一节, 1: 第二节...)
  periodEnd: number;      // 终止节数索引
  location: string;       // 授课地点
  teacher: string;        // 授课教师
  dayPartLabel: string;   // 时段描述
  timeRangeLabel: string; // 起止时间文本 (例如 10:00-11:30)
  color: string;          // 课程颜色
}

/**
 * 按照时段切分的课程节次段落
 *
 * 应用场景：一门课程的起止节数可能存在跨时段现象，可按照时段对起止节数进一步切分；
 */
export interface DayPartPeriodSegment  {
  periodStart: number; // 起始节数索引 (0: 第一节, 1: 第二节...)
  periodEnd: number;   // 终止节数索引
  dayPart: DayPart;    // 所处时段，上午、下午、晚上
}

/**
 * 时段块
 *
 * 应用场景：将节次时间表按照时段进行分块，不同块分别存放各自的时段描述以及节数索引表；
 */
export interface DayPartBlock {
  dayPartLabel: string;
  periodIndices: number[];
}
