# Inkloom 0.3 插件 SDK 初版

## 范围

宿主0.6.0，API为1.7.0。新增可信内置的 `queryAi`、`aiConfig`、`aiComplete` 接口，以及活动草稿快照、带修订号的草稿更新、统一保存与显式链接导航；研究资料和白板复用工作台查询，笔记多维视图增加分组、自定义属性列、内置派生公式/关系汇总列与数值统计汇总。原有读取取消、分页、后台收集、受限JSON设置及受控写入契约兼容。外观包不获得脚本权限，API密钥不向前端暴露明文，没有Obsidian/Electron兼容层或任意安装包加载器。

内置“未关联笔记”只依赖公开 API，不操作主界面 DOM。外部目录示例使用不带 `allow-same-origin` 的 sandbox iframe，CSP 默认拒绝网络、图片、嵌套页面和表单。Worker 用于后台任务，不当作权限沙箱。

## 目录与发现

每个插件位于 `plugins/<directory>`，包含 manifest.json 和清单指定的 JS 文件。构建工具扫描这些目录，无需修改主界面注册代码。重建后，外部插件默认关闭，在同一个设置窗口的“工作台与插件”中启用。当前是源码级开发协议，不是终端用户安装器。

完整可运行示例：[只读插件清单](../plugins/unlinked-notes/manifest.json)、[只读插件入口](../plugins/unlinked-notes/main.js)、[隔离清单](../plugins/sandbox-inspector/manifest.json)、[隔离入口](../plugins/sandbox-inspector/main.js)。

可信内置视图示例：[笔记视图清单](../plugins/note-views/manifest.json)、[表格/看板入口](../plugins/note-views/main.js)。本插件通过宿主查询与属性命令工作，启用时动态加载实现，打开时挂载页面；主界面不再保留第二份表格/看板实现。

图谱示例：[图谱清单](../plugins/knowledge-graph/manifest.json)、[全局/局部图谱入口](../plugins/knowledge-graph/main.js)。全局使用activity位置，局部使用context位置；只有可信内置插件可以挂载右栏DOM。宿主提供容器，插件不寻找主界面私有元素。

```json
{
  "id": "reading-list",
  "name": "阅读清单",
  "version": "0.1.0",
  "minHost": "0.3.0",
  "entry": "main.js",
  "activation": ["manual"],
  "dependencies": [],
  "capabilities": ["metadata.read", "views"]
}
```

版本必须为三段数字。ID、入口路径、能力、缺失入口和依赖环均由宿主检查；依赖未启用不能激活。外部插件先手动启用，之后可记住启用状态。安全模式停用非必要插件。

## 公共接口

| 接口 | 契约 |
| --- | --- |
| `query({orphan, limit})` | 1.3兼容同步元数据快照，最多250条，不返回全文；新内置功能使用queryAsync；`metadata.read` |
| `queryAsync(options, {signal,key})` | 已提交索引版本上的异步元数据查询；最多250条，含文本筛选；可取消、同键替换；`metadata.read` |
| `read(noteId)` | 返回 `{id, source, version}`，version 为当前源文字 SHA-256；`vault.read` |
| `write(noteId, version, source)` | 版本相符且没有未保存编辑才可交给统一文件入口；返回 ID 和新版本；`vault.write` |
| `activeDocument()` | 仅可信内置；返回克隆的 `{id,source,revision,dirty,name}` 或null；id是笔记永久身份而非恢复会话ID；`vault.read` |
| `updateActiveDocument(id,revision,source)` | 仅可信内置；要求当前ID、精确修订号、无保存/切库/组合输入冲突；正文最多8MiB字符，进入同一草稿和恢复服务；`vault.write` |
| `saveActiveDocument(id)` | 仅可信内置；只保存当前笔记，返回 `{id,saved,revision,dirty}`；保留外部冲突检查；`vault.write` |
| `openLink(link)` | 仅可信内置的显式点击导航；支持真实知识库路径、章节、块与别名，或无凭据HTTP(S)地址，最多2048字符；拒绝file/javascript；不提供网络读取能力；`metadata.read` |
| `registerView({id,name,icon,location,order,mount})` | 返回带命名空间的viewId；外部仅声明式列表，`mount`只允许明确可信的内置插件；`views` |
| `queryDatabase(filters, {signal,key})` | 可信内置API，后台返回10/25/50/100行DTO、总数、页码与分组，不返回全文；`metadata.read` |
| `queryGraph(options, {signal,key})` | 可信内置API，后台返回全局/局部节点与边、标签及统计；不含source/excerpt；`metadata.read` |
| `createNote(title, {folder,source,background})` | 可信内置API；无选项保留打开行为；background走独占新文件提交，相同路径及内容可重试，不覆盖冲突内容；folder仅单层字母数字短横线；`vault.write` |
| `queryWorkspace(options, {signal,key})` | 任务50条/页、Memo20条/页、白板和研究资料各25条/页、项目最多50、星标最多20、日历最多400；研究支持researchMode/researchText/researchPage与来源字段，不返回全文；按已提交索引版本查询，`metadata.read` |
| `notify({noteId,title})` | 仅可信内置的应用内提示，最多显示3条，不调用系统通知/网络；`metadata.read` |
| `updateProperties(id,version,patch)` | 可信内置API，要求64位SHA-256版本、无未保存编辑，复用原子保存入口；`vault.write` |
| `updateView(viewId,{type:'notes',rows})` | 每行使用 id/title/folder，文字由宿主安全渲染；不能提交任意 HTML |
| `registerCommand({id,name,shortcut,run})` | 内置及隔离插件均可注册；隔离回调经宿主调用并有5秒预算，故障停用所属实例；`commands` |
| `registerSetting(...)` | boolean/number/choice汇入同窗设置；可信内置额外可用data保存最多131072字符的JSON，普通设置列表不渲染data；所属权限与写入失败回退保持；`settings` |
| `getSetting`、`setSetting` | 只能访问所属插件已登记的设置；不能读其他插件或未登记键；`settings` |
| `on(event, handler)` | 订阅vault.changed、workspace.active、workspace.draft、workspace.appearance、settings.changed；draft事件只含元数据；隔离插件须await注册，返回异步取消函数；停用自动取消 |
| `own(dispose)`、`interval`、`ownWorker` | 可信插件资源登记，停用逆序释放，已释放项不重复调用 |

外部iframe经受控RPC调用query/read/write/request/execute/registerView/updateView/showView/open，以及声明设置、命令和事件订阅。能力清单不等于授权：当前宿主仍拒绝授予外部插件写入、联网和执行权限；未声明或未授予的读取也被拒绝。不能把可信内置的DOM/Worker资源API当作第三方权限。

外部入口运行在异步函数内，可用 `await api.query(...)`、`await api.registerView(...)` 和 `await api.updateView(...)`；不支持 Node.js、任意模块导入或父页面 DOM。示例内的 `evidence` 仅供隔离验证，不是业务 API。

## 资源与数据

内置视图的`mount(container, scope)`只接收宿主提供的内容容器，必须返回销毁函数。`scope.signal`用于DOM事件取消，`scope.own`登记订阅等清理。关闭、切换、停用和挂载失败都由宿主清理。该接口不是对可信JS的安全沙箱，也不向外部iframe授予DOM权限。异步查询必须在返回时检查scope.signal与请求代际；已提交保存可完成，不能宣称关闭视图会撤销磁盘事务。

`location: 'context'`由宿主按右栏可见性挂载/卸载，可用`visibleSetting`引用所属插件的布尔设置。布局Worker必须随对应视图销毁，不能只隐藏Canvas。图谱的节点位置缓存只存在插件实例中，停用后清除；未完成布局不缓存，旧异步结果不得覆盖新实例。

停用会移除贡献、事件、定时器和登记的Worker；隔离插件同时移除iframe、消息监听、订阅和未完成回调。保留过期API引用也不能继续调用。激活、RPC和回调各有5秒预算。旧实例的异步失败不会停用新一代实例，不自动重试或提权。

API1.4读取可传第二参数`{ signal: scope.signal, key: '所属视图查询键' }`，同键新请求取代旧请求。队列最多64个等待/运行记录，客户端最多2个并行读取，Worker串行执行查询；索引更新取消过期读取，返回前再次校验库身份与索引版本。AbortError表示取消，不作为插件故障。外部iframe的原`await api.query(...)`桥接到异步队列，调用形式不变。

读取取消与写入提交分开：write/updateProperties在进入文件服务前校验权限、64位内容版本和脏状态；已提交的保存不会因停用而回滚，返回实际保存后版本。`query`同步兼容入口不是新后台任务入口，不能据此声称1.3调用已经变成可硬中断计算。

插件数据不能成为 Markdown 唯一副本。只读示例停用后文件不变。ID 是 profile 内的永久笔记身份，不是路径，也不是编辑会话 ID。不要缓存路径作为永久主键，不要把图谱当前版本号当作写入版本。

可信后台创建的source上限为8MiB字符；白板自身另执行6MiB场景上限。元件库与研究登记草稿仍受单个data设置131072字符的限制，达到配额时必须显示失败，不能声称草稿已保存。活动草稿接口与openLink没有加入外部iframe RPC白名单。

## 复用与未完成项

生命周期参考 [Obsidian API](https://github.com/obsidianmd/obsidian-api)，未宣称实现其宿主或复制完整插件系统。后台 RPC 使用 [Comlink 4.4.2](https://github.com/GoogleChromeLabs/comlink/tree/v4.4.2)，图布局使用 [d3-force 3.0.0](https://github.com/d3/d3-force/tree/v3.0.0)；随包保留许可证。

表格/看板与全局/局部图谱已迁为内置插件。权限确认界面、签名、安装/升级/回退仍未完成；隔离探针及事件/设置联动通过不代表已经证明任意恶意插件安全。
