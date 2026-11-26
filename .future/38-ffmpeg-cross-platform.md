# ffmpeg 查找跨平台

- 编号：38
- 优先级：P3
- 状态：todo

## 现状

img.ts 里只按 Windows 路径找。

## 目标

用 where/which 探测，覆盖 Linux/macOS。

## 验收

三平台探测逻辑有单测；找不到时给出安装提示。
