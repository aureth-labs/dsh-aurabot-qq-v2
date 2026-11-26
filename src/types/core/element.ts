/**
 * 消息元素：入站出站共用的一棵树，平台差异留给适配器。
 *
 * 写法与 Satori 对齐：`<text>你好</text>`、`<img src="…"/>`、`<file src="…"/>`。
 * 内部只认「类型 + 属性 + 子节点」，不认任何具体平台的字段名。
 */

export interface Element {
  /** 元素类型：text / at / image / voice / video / file / face / quote / forward …… */
  type: string
  /**
   * 属性表。文本用 `content`，媒体统一用 `url`（转 Satori 时映射成 `src`）。
   * 不认识的属性照样能带，能不能发出去由适配器能力表决定。
   */
  attrs: Record<string, any>
  children?: Element[]
}

/** 能喂给 `h()` / `h.parse()` / 发送接口的所有形态。 */
export type ElementSource = string | Element | Element[] | null | undefined

/** `h.select()` 的选择器：类型名，或自定义断言。 */
export type Selector = string | ((element: Element) => boolean)

/** OneBot v11 的消息段。QQ 侧专用，核心不直接依赖它。 */
export interface OneBotSegment {
  type: string
  data: Record<string, any>
}

/**
 * 宿主注入的全局 `h`（和 Koishi 一样，不用 import）。
 *
 * 既能当构造函数用，也带一批快捷方法与解析/序列化工具。
 */
export interface ElementFactory {
  (type: string, attrs?: Record<string, any>, children?: Element[]): Element
  text(content: string): Element
  at(id: string | number, name?: string): Element
  image(url: string, extra?: Record<string, any>): Element
  voice(url: string, extra?: Record<string, any>): Element
  video(url: string, extra?: Record<string, any>): Element
  file(url: string, name?: string): Element
  face(id: string | number): Element
  quote(id: string | number): Element
  forward(idOrChildren: string | number | Element[]): Element
  parse(source: string): Element[]
  stringify(source: ElementSource): string
  select(source: ElementSource, selector: Selector): Element[]
  normalize(source: ElementSource): Element[]
  /** 按平台能力把发不出去的元素换成文字占位符。 */
  degrade(source: ElementSource, supports: (capability: import('../adapter/bot.ts').Capability) => boolean): Element[]
  isElement(value: unknown): value is Element
  fromOneBot(segments: unknown): Element[]
  toOneBot(source: ElementSource): OneBotSegment[]
}
