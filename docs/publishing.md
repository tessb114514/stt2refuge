# 上传GitHub

1. 创建仓库，例如 `ST-refuge`，选择公开或私有。当前材料尚未上传或绑定任何GitHub账户。
2. 上传本目录的**内容**到仓库根目录，保证 `manifest.json` 位于根目录。不要把外层ST-refuge文件夹再套一层，也不要仅上传ZIP后期待酒馆自动解压安装。
3. 填写manifest的作者；拿到真实地址后可增加 `homePage`。README中的账号示例替换为真实账号。
4. 确认图片授权说明。检查仓库没有聊天JSONL、账号设置、API密钥、密码保险库、私人管理员哈希、缓存、node_modules和本机安装日志。
5. 运行 `npm run check`，再进行安装/兼容测试。`release-files.json` 是本次文件校验清单，不包含私人配置。
6. 创建 `v0.5.4` 标签与Release。ZIP可作为Release附件；源码目录仍按第2步放在仓库根目录。
7. 测试GitHub URL前端安装后，还须按README执行主机端安装。更新前端不会自动更新服务器副本，主机升级后需重启。

官方参考：

- https://docs.sillytavern.app/for-contributors/writing-extensions/
- https://docs.sillytavern.app/for-contributors/server-plugins/
- https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
- https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
