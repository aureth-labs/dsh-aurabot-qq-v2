# 删除 packages/_template/index.mjs

- 编号：01
- 优先级：P0
- 状态：done

## 现状

模板目录里还留着 v2 示范入口 index.mjs，和「模板只放说明」的口径冲突。

## 目标

删掉该文件，_template 只保留一份 README 讲 v2 写法与目录约定。

## 验收

文件不存在；全仓 grep 无引用；npm run check 通过。
