/**
 * 餐厅数据模型
 * 使用 @Observed 实现状态观察（V1 装饰器）
 */

@Observed
export class Restaurant {
  id: string = '';
  name: string = '';
  rating: number = 0;
  cuisineType: string = '';
  address: string = '';
  imageUrl: string = '';
  isFavorite: boolean = false;

  constructor(
    id: string,
    name: string,
    rating: number,
    cuisineType: string,
    address: string,
    imageUrl: string = '',
    isFavorite: boolean = false
  ) {
    this.id = id;
    this.name = name;
    this.rating = rating;
    this.cuisineType = cuisineType;
    this.address = address;
    this.imageUrl = imageUrl;
    this.isFavorite = isFavorite;
  }

  /**
   * 切换收藏状态
   */
  toggleFavorite(): void {
    this.isFavorite = !this.isFavorite;
  }
}

/**
 * 餐厅数据接口（用于数据传输和初始化）
 */
export interface RestaurantData {
  id: string;
  name: string;
  rating: number;
  cuisineType: string;
  address: string;
  imageUrl?: string;
  isFavorite?: boolean;
}

/**
 * 从数据接口创建 Restaurant 实例
 */
export function createRestaurant(data: RestaurantData): Restaurant {
  return new Restaurant(
    data.id,
    data.name,
    data.rating,
    data.cuisineType,
    data.address,
    data.imageUrl ?? '',
    data.isFavorite ?? false
  );
}