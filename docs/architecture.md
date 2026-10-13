# 开发交接：0.5.4独立发布目录

## 分层

```text
根目录 manifest / index.js    GitHub前端扩展入口
quick-start.js               猫猫主界面、角色选择、随机与教程
quick-model.js               分页、时间、随机选择纯函数
connection-guard.js          自定义连接管理员弹窗
ui-sound.js                  消息资源的独立点击播放器
style.css / assets           Shadow DOM隔离UI与插画
server/index.mjs             官方服务端 info / init(router)
server/access.mjs            文件管理、密码、令牌、API及原生守卫
server/defaults.mjs          新实例管理员初始化
patches/                    1.19.0必要接入的上下文变更
scripts/install.mjs          检查、备份、写入、回滚、迁移
```

前端使用 `/script.js` 和 `/scripts/*.js` 原生导出，避免依赖前端扩展文件夹名称或目录层级；素材用 `new URL(...,import.meta.url)`，样式只注入ShadowRoot。

## 主机接入与平台边界

官方服务端插件只收到专用Express Router，不能凭该接口自动拦截已经挂载的原生API或所有前端导航。因此本版保留可审查的兼容接入，集中在补丁文件，不分发酒馆完整源码：

- `public/script.js`：加载前选择，确认后才切换，访问令牌请求头。
- `welcome-screen.js`：最近聊天只选择一次。
- `personas.js`：同名跨卡缓存与头像回退。
- `public/index.html`：自定义连接控件初始隐藏。
- chats/characters端点：密码记录守卫与列表过滤。
- settings/secrets端点：自定义连接修改及密钥访问守卫。

`src/chat-selector.js`只是一行模块转发，实际实现位于 `plugins/ST-refuge/server/access.mjs`。原生兼容API与官方插件API共用同一模块、令牌Map和保险库，避免两套状态。

服务端status包含version/coreIntegration，前端握手成功后才启用流程。主机端缺失时显示安装说明；不要把该提示移除后让前端假装完成安全功能。

兼容接入不齐全时，服务端只挂载诊断status，不开放创建密码记录等功能，防止部分安装产生没有原生守卫的记录。

## 必须保持的业务约束

1. 等待/取消不能提前清空聊天、写角色ID或更换凭据。
2. 明确选择后，核心用 `{selectorChoice}` 加载，不能重复弹窗。
3. Persona保存于JSONL首行 `chat_metadata.persona`，不是新角色卡强制连接。
4. 聊天读写/导出/删除权限始终由服务端判断，扩展开关不解除保护。
5. 超过20条消息删除需管理员，首行元数据不计楼层。
6. 自定义连接令牌与聊天令牌分离；连接5分钟，聊天12小时，关闭连接弹窗撤销连接授权。

## 数据

数据路径取自酒馆 `req.user.directories`：聊天在账号chats目录，Persona在User Avatars。保险库为账号 `chat-selector/vault.json` 与随机key，管理员哈希在数据根目录 `chat-selector-admin.json`。发布包不包含这些运行文件。

管理员配置存在时保持原样；不存在时用公开bootstrap哈希初始化，或使用 `REFUGE_ADMIN_PASSWORD` 初始化新实例。后端管理员路由仍要求酒馆管理员账号和旧口令，源码初始密码不等于登录账号密码。

## 安装器

先计算全部计划、验证版本与上下文，才开始写文件；备份用原始字节和SHA256。每次写入还核对计划期间文件是否变化，失败恢复本次已写的文件。卸载验证安装后文件与备份哈希，拒绝覆盖后来的用户编辑。所有目标解析到酒馆根目录内，拒绝路径穿越/链接目标，不递归删除目录。

旧0.5.3迁移只接受已知后端代码哈希，移走旧前端manifest到备份，不删除旧用户数据。不要对未知修改强行迁移；补丁冲突应人工对比或增加明确适配版本。

## 后续开发

发布新版本要同时更新manifest、package、服务器status和安装记录版本，重新验证1.19.0上下文；若要完全免核心补丁，需要上游提供加载前导航与原生API守卫钩子，不能用加载完成后的事件替代取消语义。

图片替换只改tile渲染和资源，保持handler；API连接URL仍是客户端运行设置，不承诺隐藏开发者工具中的已加载配置。音效使用酒馆原资源，播放失败不能影响按钮。
