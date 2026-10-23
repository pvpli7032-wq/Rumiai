# 私有测试环境运行数据

按仓库所有者明确要求，以明文交付实际测试服务器的数据与配置，仅限私有仓库使用。

文件归属：

- runtime/database.db：实际 SQLite 在线一致性快照，含账号及密码哈希等原始数据库记录。
- runtime/app.env：服务器环境参数与应用密钥。
- runtime/candidate.env.local：候选验收环境参数，正式端口以 PM2 显式参数为准。
- runtime/uploads：实际上传目录（可能为空）。
- credentials/server-test-access.txt：用户提供的服务器、面板和数据库测试访问资料。

登录密码保持应用原有 bcrypt 哈希，商户加密字段保留原始数据库形式。个人 GitHub 授权与服务器部署 SSH 私钥不属于项目数据，未上传。真实收款数据库总闸保持关闭。

上述材料会进入 Git 历史。不要将仓库公开；若扩大访问范围或资料泄露，应先轮换凭证。
