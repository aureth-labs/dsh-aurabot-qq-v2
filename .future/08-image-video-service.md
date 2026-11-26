# 生图/生视频做成服务，XML 改 tool

- 编号：08
- 优先级：P1
- 状态：todo

## 现状

生图生视频靠 <generateImage> 这类 XML 元素触发，模型不听话就发不出去，也无法被其它插件复用。

## 目标

注册 ctx.generateImage / ctx.generateVideo 服务；出站只保留 voice 这类必要元素，生图生视频一律走 AI tool 调用。

## 验收

服务可用；模型 tool 调用能返回图片/视频并发送；format/sanitize.ts 不再处理 generateImage 元素。
