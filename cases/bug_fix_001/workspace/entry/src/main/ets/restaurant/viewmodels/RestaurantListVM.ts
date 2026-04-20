/**
 * 餐厅列表 ViewModel
 * 使用 @Observed 管理状态和业务逻辑（V1 装饰器）
 * 
 * 关键设计：
 * 1. 筛选时重新生成 filteredRestaurants 数组，确保 UI 正确刷新
 * 2. 收藏操作直接修改 Restaurant 对象的 isFavorite 属性，触发 UI 更新
 * 3. 避免原地修改数组，防止状态错位
 */

import { Restaurant, createRestaurant, RestaurantData } from '../../common/models/Restaurant';
import { RestaurantFilter, RatingFilterOption } from '../models/RestaurantFilter';

@Observed
export class RestaurantListVM {
  // 全部餐厅列表
  allRestaurants: Restaurant[] = [];
  
  // 筛选后的餐厅列表（这是实际展示的列表）
  filteredRestaurants: Restaurant[] = [];
  
  // 筛选条件
  filter: RestaurantFilter = new RestaurantFilter();
  
  // 加载状态
  isLoading: boolean = true;
  
  // 是否显示筛选面板
  showFilterPanel: boolean = false;

  constructor() {
    this.loadMockData();
  }

  /**
   * 加载模拟数据
   * 实际项目中应替换为网络请求
   */
  private loadMockData(): void {
    this.isLoading = true;
    
    // 模拟数据
    const mockData: RestaurantData[] = [
      {
        id: '1',
        name: '川味轩',
        rating: 4.8,
        cuisineType: '川菜',
        address: '朝阳区建国路88号',
        isFavorite: false
      },
      {
        id: '2',
        name: '粤香楼',
        rating: 4.6,
        cuisineType: '粤菜',
        address: '海淀区中关村大街1号',
        isFavorite: true
      },
      {
        id: '3',
        name: '江南小馆',
        rating: 4.5,
        cuisineType: '江浙菜',
        address: '西城区金融街10号',
        isFavorite: false
      },
      {
        id: '4',
        name: '湘味居',
        rating: 4.3,
        cuisineType: '湘菜',
        address: '东城区王府井大街20号',
        isFavorite: false
      },
      {
        id: '5',
        name: '老北京炸酱面',
        rating: 4.0,
        cuisineType: '京菜',
        address: '朝阳区望京街道50号',
        isFavorite: true
      },
      {
        id: '6',
        name: '西北风味',
        rating: 3.8,
        cuisineType: '西北菜',
        address: '海淀区学院路30号',
        isFavorite: false
      },
      {
        id: '7',
        name: '东北人家',
        rating: 3.5,
        cuisineType: '东北菜',
        address: '丰台区丰台路100号',
        isFavorite: false
      },
      {
        id: '8',
        name: '云南米线',
        rating: 4.2,
        cuisineType: '云南菜',
        address: '朝阳区三里屯路15号',
        isFavorite: false
      }
    ];
    
    // 创建 Restaurant 实例
    this.allRestaurants = mockData.map(data => createRestaurant(data));
    
    // 初始显示全部餐厅
    this.filteredRestaurants = [...this.allRestaurants];
    
    this.isLoading = false;
  }

  /**
   * 应用筛选条件
   * 关键：重新生成 filteredRestaurants 数组，而不是原地修改
   * 这样可以确保 List 组件正确刷新，避免状态错位
   */
  applyFilter(): void {
    const minRating = this.filter.getMinRating();
    
    if (minRating === 0) {
      // 显示全部餐厅
      this.filteredRestaurants = [...this.allRestaurants];
    } else {
      // 筛选评分大于阈值的餐厅
      this.filteredRestaurants = this.allRestaurants.filter(
        (restaurant: Restaurant) => restaurant.rating >= minRating
      );
    }
    
    // 强制触发 UI 更新
    this.filteredRestaurants = [...this.filteredRestaurants];
  }

  /**
   * 设置评分筛选
   */
  setRatingFilter(option: RatingFilterOption): void {
    this.filter.setRatingFilter(option);
    this.applyFilter();
  }

  /**
   * 切换餐厅收藏状态
   * 直接修改 Restaurant 对象的 isFavorite 属性
   * 由于 Restaurant 使用了 @Observed，修改会自动触发 UI 更新
   */
  toggleFavorite(restaurantId: string): void {
    const restaurant = this.allRestaurants.find((r: Restaurant) => r.id === restaurantId);
    if (restaurant) {
      restaurant.toggleFavorite();
    }
  }

  /**
   * 切换筛选面板显示状态
   */
  toggleFilterPanel(): void {
    this.showFilterPanel = !this.showFilterPanel;
  }

  /**
   * 重置筛选条件
   */
  resetFilter(): void {
    this.filter.reset();
    this.applyFilter();
  }

  /**
   * 获取筛选后的餐厅数量
   */
  getFilteredCount(): number {
    return this.filteredRestaurants.length;
  }

  /**
   * 获取收藏的餐厅数量
   */
  getFavoriteCount(): number {
    return this.allRestaurants.filter((r: Restaurant) => r.isFavorite).length;
  }
}