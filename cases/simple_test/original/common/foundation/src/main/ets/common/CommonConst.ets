import { Period, DayPart } from 'module_course_schedule';

export class CommonConst {

  public static readonly DEFAULT_AVATAR: ResourceStr = $r('app.media.atomic_default_avatar');

  public static readonly DEFAULT_NICKNAME: string = '华为用户';

  public static readonly TITLE_BAR_HEIGHT: number = 56;

  public static readonly PREF_SESSION_TOKEN: string = 'pref.session.token';

  public static readonly PREF_TIMETABLE: string = 'pref.timetable';

  public static readonly IS_MOCK_ADAPTER_ENABLE: boolean = true;

  public static readonly API_BASE_URL: string = '';

  public static readonly REQUEST_TIMEOUT: number = 8 * 1000;

  public static readonly MAX_COURSE_NAME_LENGTH: number = 100;

  public static readonly DEFAULT_TOTAL_WEEKS: number = 25;

  public static readonly DEFAULT_PERIODS: Period[] = [
    // 08:00 ~ 08:45
    {
      dayPart: DayPart.Morning,
      startMin: 480,
      endMin: 525
    },
    // 08:50 ~ 09:35
    {
      dayPart: DayPart.Morning,
      startMin: 530,
      endMin: 575
    },
    // 09:55 ~ 10:40
    {
      dayPart: DayPart.Morning,
      startMin: 595,
      endMin: 640
    },
    // 10:45 ~ 11:30
    {
      dayPart: DayPart.Morning,
      startMin: 645,
      endMin: 690
    },
    // 13:00 ~ 13:45
    {
      dayPart: DayPart.Afternoon,
      startMin: 780,
      endMin: 825
    },
    // 13:50 ~ 14:35
    {
      dayPart: DayPart.Afternoon,
      startMin: 830,
      endMin: 875
    },
    // 14:55 ~ 15:40
    {
      dayPart: DayPart.Afternoon,
      startMin: 895,
      endMin: 940
    },
    // 15:45 ~ 16:30
    {
      dayPart: DayPart.Afternoon,
      startMin: 945,
      endMin: 990
    },
    // 17:05 ~ 17:50
    {
      dayPart: DayPart.Evening,
      startMin: 1025,
      endMin: 1070
    },
    // 17:55 ~ 18:40
    {
      dayPart: DayPart.Evening,
      startMin: 1075,
      endMin: 1120
    }
  ];

  public static readonly HOME_BANNER_LIST: ResourceStr[] = [
    $r('app.media.home_banner_01'),
    $r('app.media.home_banner_01'),
    $r('app.media.home_banner_01'),
    $r('app.media.home_banner_01'),
    $r('app.media.home_banner_01')
  ];
}
