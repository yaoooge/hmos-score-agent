## 组件里有this对象时，builder作为参数应正确传递this作用域


```ts
@Component
struct Test{
  // ...
  build(){
    Comp({
      // btnBuilder:this.btnBuilder  反例
      btnBuilder: ()=> this.btnBuilder() // 正例
    })
  }
  
  @Builder
  btnBuilder(){
    Button('click').onclick(()=>{
      this.info.check()
    })
  }
}
```