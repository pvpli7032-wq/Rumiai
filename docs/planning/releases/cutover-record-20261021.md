# 生产切流记录：commercial-20261021-c5

> 本记录只写已发生事实，不补写未发生的步骤。来源为本次切流核实结果与交接事实。

## 结果摘要

| 项 | 实测结果 |
|---|---|
| 发布目录 | `commercial-20261021-c5` |
| 生产迁移 | 48 条 |
| PM2 | online；restarts=0；exec cwd 指向 c5 |
| PM2 持久化 | `pm2 save` 已执行 |
| Soak | 60 秒内 12/12 请求返回 200 |
| 回滚位 | `c2`、`c3`、`c4-rc2` 保留 |
| BUILD_ID | 以服务器 `.next-build/BUILD_ID` 为准；本记录不臆填具体值 |

## 时间线与门判据

| 阶段 | 门判据 | 实测/结果 |
|---|---|---|
| 发布候选目录 | 新 release 目录可用 | `commercial-20261021-c5` 作为目标 release |
| 数据库迁移 | 迁移完成且生产库可用 | 48 条迁移；最终生产状态通过 |
| PM2 切换 | 应用进程在线，cwd 指向目标 release | online，restarts=0，exec cwd=c5 |
| 持久化 | PM2 进程表保存 | `pm2 save` 已完成 |
| 稳定性观察 | 60 秒请求观察 | 12/12 返回 200 |
| 回滚准备 | 旧 release 仍可定位 | `c2`、`c3`、`c4-rc2` 保留 |

## 两次失败与处置

### 失败 A：占位空库构建

- 现象：使用占位空库构建，构建过程缺少 `tags` 表，导致构建失败。
- 处置：停止沿用占位空库构建路径，改用包含实际 schema 的生产数据/隔离库路径后继续。
- 记录边界：本记录确认失败现象和处置，不推断额外命令或未发生的回滚。

### 失败 B：PM2 cwd 未刷新

- 现象：对旧 app 使用 `start --update-env` 后，PM2 的旧 `exec cwd` 未随新 release 刷新。
- 处置：执行 `pm2 delete`，再从 `commercial-20261021-c5` 的 ecosystem 重建 PM2 app；随后核对 cwd。
- 结果：PM2 online，restarts=0，exec cwd 指向 c5；之后执行 `pm2 save`。

## 结论

c5 已上线生产。48 条迁移、PM2 online/restarts 0/cwd=c5、`pm2 save` 和 60 秒 12/12 200 均已核实；回滚位 `c2`/`c3`/`c4-rc2` 保留。未在本记录中增加未核实的时间戳、BUILD_ID、备份路径或命令输出。
