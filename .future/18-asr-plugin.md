# 语音转文字做成插件

- 编号：18
- 优先级：P1
- 状态：todo

## 现状

ASR 逻辑留在内核，且识别结果不可见。

## 目标

插件前置中间件把 <voice>file://…</voice> 扩成 <voice>file://…<translateVoice>文本</translateVoice></voice>；识别不到要明说可能识别有误；语音文件落本地留存。

## 验收

关插件时 voice 元素按原样处理；开插件时 session.content 内是文本；文件在 data/media 下留存。
