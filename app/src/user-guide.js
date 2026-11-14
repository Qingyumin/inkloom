export function mountUserGuide({ insertSnippet, openView }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'guide-dialog';
  dialog.className = 'about-dialog guide-dialog';
  dialog.setAttribute('aria-labelledby', 'guide-title');
  dialog.innerHTML = `
    <form method="dialog">
      <div class="dialog-heading">
        <h2 id="guide-title">操作手册与语法速查 (F1 · 全界面从上到下、从左到右详解)</h2>
        <button class="icon-button" aria-label="关闭操作手册">✕</button>
      </div>
      <div class="about-content guide-content">
        <div class="guide-toolbar">
          <div class="segmented-control ux-pill-bar" id="guide-chapter-tabs" role="tablist">
            <button type="button" class="ux-pill-option" data-guide-chapter="all" data-pill-tone="teal" aria-selected="true">全景总览</button>
            <button type="button" class="ux-pill-option" data-guide-chapter="topbar" data-pill-tone="blue">① 顶部工具栏</button>
            <button type="button" class="ux-pill-option" data-guide-chapter="left" data-pill-tone="emerald">② 左侧活动与导航</button>
            <button type="button" class="ux-pill-option" data-guide-chapter="center" data-pill-tone="purple">③ 中央双栏与语法</button>
            <button type="button" class="ux-pill-option" data-guide-chapter="right" data-pill-tone="rose">④ 右侧脉络与双链</button>
            <button type="button" class="ux-pill-option" data-guide-chapter="workbenches" data-pill-tone="amber">⑤ 五大工作台与架构</button>
          </div>
          <input type="search" id="guide-search-input" placeholder="搜索界面按钮、语法或算法关键词（如：智能双链、RRule、余弦、孤岛织网）..." aria-label="搜索操作手册">
        </div>

        <section class="guide-section" data-chapter="left">
          <h3>一、 左侧窄活动栏与导航面板（从上到下逐项说明）</h3>
          <p>窗口最左侧为 40px 窄活动栏（可在「设置 → 工作台与插件」勾选「活动栏显示文字」或固定/排序图标），上方为导航与五大工作台入口，底部为「刷新知识库」与唯一「设置」入口：</p>
          <div class="guide-actions-row">
            <button type="button" class="phase-command" data-guide-view="workspace-home:home-view">打开工作台 (Ctrl+Alt+H)</button>
            <button type="button" class="phase-command" data-guide-view="note-views:database-view">打开多维笔记视图</button>
            <button type="button" class="phase-command" data-guide-view="knowledge-graph:global-view">打开万象知识图谱 (Ctrl+G)</button>
            <button type="button" class="phase-command" data-guide-view="whiteboard:whiteboard-view">打开白板与手绘手帐</button>
            <button type="button" class="phase-command" data-guide-view="research-desk:research-view">打开阅读与长稿研究</button>
            <button type="button" class="phase-command" data-guide-view="ai-assistant:ai-view">打开智识与编译器 (Ctrl+Alt+A)</button>
          </div>
          <table class="release-table">
            <thead><tr><th>从上到下位置</th><th>图标/页签名称</th><th>功能逻辑与操作案例</th></tr></thead>
            <tbody>
              <tr><td>活动栏 1~4</td><td>知识库 / 标签 / 星标 / 大纲</td><td>点击切换左侧导航；再次点击可收起。默认宽度 260px，可拖动内侧边界调节；支持顶部<strong>四维排序切换（名称 A→Z / Z→A / 最近日期 / ★星标优先）</strong>与<strong>鼠标直接拖拽笔记/目录移动（悬停 450ms 自动展开折叠目录）</strong>。在任意目录或笔记上<strong>点击右键</strong>可执行「在此目录新建笔记」「新建子目录」「重命名此目录」「移动此目录至」「移动至目录」「在本地文件夹中定位」「删除笔记/目录并自动清理全库双链引用」。</td></tr>
              <tr><td>活动栏 5~6</td><td>今日手记 / 搜索笔记 (Ctrl+K)</td><td>「今日手记」点击直达 <code>YYYY-MM-DD.md</code>，悬停或右键展开「周期手记」二级菜单（一键生成或打开本周周报 <code>YYYY-Www</code>、本月复盘 <code>YYYY-MM</code>、本季规划 <code>YYYY-Qn</code>）；「搜索笔记」支持按标题、别名、#标签、待建节点或全局命令快速跳转。</td></tr>
              <tr><td>活动栏 7~11</td><td>工作台 / 笔记视图 / 知识图谱 / 白板 / 研究 / 智识</td><td>切换主舞台视图，离开视图时自动销毁后台 DOM 与布局 Worker，不留内存残留。其中知识图谱寻路器支持展开「路径依据 (N 跳)」查看每跳源文件与行号；智识编译器「审校」支持上游笔记变更后的 Wiki 证据失效增量重算与概念实体关系原位采纳。</td></tr>
              <tr><td>活动栏底部</td><td>导入与库管理 / 刷新知识库 / 设置</td><td>向下箭头菜单提供<strong>全库便携归档（.inkloom-vault.zip 含 SHA-256 验签还原）</strong>、OneNote 迁入与知识库管理。设置按七组折叠，点击分类展开；主题包、Obsidian 配色、图标与 CSS 位于「外观与主题 → 主题包与外观扩展」。切换暗色色系会同步正文底色和文字；已有字号偏好保留，新配置默认正文 15px、行距 1.75。</td></tr>
            </tbody>
          </table>
        </section>

        <section class="guide-section" data-chapter="topbar">
          <h3>二、 顶部 40px 全局工具栏（从左到右逐项说明）</h3>
          <table class="release-table">
            <thead><tr><th>从左到右区域</th><th>按钮/控件名称</th><th>功能逻辑与快捷键</th></tr></thead>
            <tbody>
              <tr><td>左侧品牌与导航区</td><td>左侧栏开关 / 文件菜单 / 保存 / 新建</td><td>左侧栏开关控制导航抽屉显隐；「文件」菜单汇总打开知识库、新建笔记、另存为、复制段落块引用（自动生成 <code>^block-xxxx</code>）、收集研究摘录、专注模式（<code>F11</code>）与本手册（<code>F1</code>）。</td></tr>
              <tr><td>中央文档身份区</td><td>笔记标题徽章 / 重命名 / 属性药丸栏 / 对照原件</td><td>显示当前笔记标题、<code>#标签</code> 与 <code>status</code> 属性；当打开 <code>wiki/sources/</code> 文献笔记时自动显示 <strong>「📄 对照原件 · raw/...」</strong> 胶囊，点击即可在右侧分屏对照栏打开原始 PDF/Word/PPT/Excel/HTML 文件；点击「重命名」先预览受影响双链数再原子改写。</td></tr>
              <tr><td>右侧视图工具区</td><td>源码 / 阅读 / 格式 / 查找 / 导出 / 更多笔记工具（⋯） / 右侧栏开关</td><td>一键切换单栏阅读、单栏源码或双栏同步滚动；展开可视化格式工具条；打开页内查找替换（<code>Ctrl+F</code>，并可直达<strong>全库跨文件受控预览查找替换与 YAML 属性改名</strong>）；导出纯净 HTML / Word (.docx) / A4 PDF / EPUB 3.0 电子书 / 单文件离线知识微站；在「⋯ 更多笔记工具」菜单中收纳书籍朗读、专注禅模式、幻灯片演示、知识大纲思维导图、知识金句分享卡片（SVG/PNG）、跨笔记块/章节内嵌巡检、全库受控查找替换、版本对比与多屏副窗口管理；最右侧按钮控制关联脉络栏显隐。</td></tr>
            </tbody>
          </table>
        </section>

        <section class="guide-section" data-chapter="center">
          <h3>三、 中央双栏编辑、核心语法规则与一键插入案例</h3>
          <p>在工作台左上角「快速收集」可直接创建 Memo、任务、项目；在任意笔记正文中手写以下语法同样会自动汇总到清单、三态看板、月历与知识星图：</p>
          <table class="release-table">
            <thead><tr><th>功能模块</th><th>Markdown 语法规则与逻辑说明</th><th>快捷插入体验</th></tr></thead>
            <tbody>
              <tr>
                <td>三态任务（对应看板三列与月历）</td>
                <td><code>- [ ] 未开始</code> / <code>- [/] 进行中</code> / <code>- [x] 已完成</code>，附加 <code>@due(YYYY-MM-DD) @time(HH:mm) @priority(high|normal|low)</code></td>
                <td><button type="button" class="small-command" data-guide-insert="- [ ] 待办事项 @due(2026-10-25) @priority(high)">插入任务示例</button></td>
              </tr>
              <tr>
                <td>重复规则（RRule 2.8.1）</td>
                <td><code>@repeat(daily|weekdays|weekly|monthly|yearly) @every(2) @days(MO,WE) @until(2026-12-31)</code>；勾选完成时仅推进生成下一期单条任务</td>
                <td><button type="button" class="small-command" data-guide-insert="- [ ] 每周复盘 @due(2026-10-26) @repeat(weekly) @days(MO,FR)">插入重复任务</button></td>
              </tr>
              <tr>
                <td>双链与章节/别名引用 + 悬停预览</td>
                <td><code>[[目标笔记#章节标题|显示别名]]</code>；鼠标悬停在双链上即弹出毛玻璃预览卡片展示目标章节正文与出入链统计</td>
                <td><button type="button" class="small-command" data-guide-insert="[[00-墨图导览与万象星图|墨图导览]]">插入双链</button></td>
              </tr>
              <tr>
                <td>只读嵌入（段落/行内/白板矢量图）</td>
                <td><code>![[笔记名#章节]]</code> 或 <code>![[笔记名#^block-id]]</code>；整篇共享 24 处/80,000 字展开预算，导出时自动展开为静态正文</td>
                <td><button type="button" class="small-command" data-guide-insert="![[01-双链笔记与卡片盒方法#双链语法与自动补全]]">插入嵌入示例</button></td>
              </tr>
              <tr>
                <td>Callout 提示框（或空行输入 <code>/</code>）</td>
                <td><code>&gt; [!TIP] 标题</code>（支持 NOTE / TIP / IMPORTANT / WARNING / CAUTION，可在设置中切换柔和/描边/极简三种样式）</td>
                <td><button type="button" class="small-command" data-guide-insert="> [!TIP] 灵感提示\n> 在此记录关键结论。">插入 Callout</button></td>
              </tr>
              <tr>
                <td>长稿角色/术语设定语法</td>
                <td><code>【实体名·属性名】：属性值</code>（如 <code>【林深·年龄】：28岁</code>），用于「智识 → 长稿一致性」跨章节自动检测前后设定冲突</td>
                <td><button type="button" class="small-command" data-guide-insert="【林深·身份】：星图架构师">插入设定示例</button></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="guide-section" data-chapter="right">
          <h3>四、 右侧关联脉络栏与「三模式 × 三引擎」智能双链</h3>
          <ul>
            <li><strong>上部：局部星图（Local Graph）</strong>：实时渲染当前笔记 1~2 跳邻居子图，支持切换跳数、勾选「含同标签」与点击节点直接跳转。</li>
            <li><strong>下部四页签：反向链接 / 出链 / 章节 / 提及（含智能双链面板）</strong>：
              <ul>
                <li><strong>触发模式（<code>#smart-wikilink-mode</code>）</strong>：① <strong>半自动 · 提醒双链</strong>（实时扫描正文候选词并展示余弦相似度与得分，悬停可预览目标笔记，支持单条「补链」或「一键自动补链」）；② <strong>全自动 · 自动补充双链</strong>（按 <code>Ctrl+S</code> 保存时自动将高置信度词项转为双链，支持 <code>Ctrl+Z</code> 撤销）；③ <strong>纯手工双链</strong>。</li>
                <li><strong>识别引擎（<code>#smart-wikilink-engine</code>）</strong>：① <strong>离线余弦相似度+词法</strong>（128 维向量余弦 + 标题/别名扫描）；② <strong>本地小模型 SmolLM2/Ollama</strong>（调用本机 <code>127.0.0.1:11435</code> 确认语义）；③ <strong>在线大模型 Gemini 4</strong>。</li>
              </ul>
            </li>
            <li><strong>底部可折叠微复习栏：🧠 今日到期微闪卡（<code>#context-micro-flashcards</code> · 1.7.9 新增）</strong>：在右侧关联栏底部常驻展示今日最急需巩固的 3 张到期闪卡（优先难点错题），无需切出当前写作流即可原位翻转看答案并点击「重来 / 掌握」回写 SM-2 进度。</li>
          </ul>
        </section>

        <section class="guide-section" data-chapter="workbenches">
          <h3>五、 五大专业工作台、2.0 多模态 OCR 与极简菜单体系</h3>
          <ul>
            <li><strong>2.7 EPUB 3.0 电子书离线打包出版与多维视图 CSV 双向批处理（MAJOR-270）</strong>：
              <ul>
                <li><strong>标准 EPUB 3.0 电子书离线打包（<code>#export-format</code> / <code>#manuscript-export-epub-btn</code>）</strong>：在顶栏「导出文档」弹窗或「研究 → 长稿 → 出版定稿」中一键导出包含 <code>content.opf</code>、<code>nav.xhtml</code>、<code>toc.ncx</code> 与分章 XHTML 的 <code>.epub</code> 电子书，并可直入原件精读器翻阅。</li>
                <li><strong>多维视图 CSV / Markdown 汇总表导出与 CSV 属性批量同步（<code>#database-view-manage-menu</code>）</strong>：在「笔记视图 → 视图管理 ▾」弹出菜单中一键导出当前筛选视图 CSV、保存为带 <code>[[双链]]</code> 的汇总笔记或粘贴 CSV 批量更新笔记 YAML 属性。</li>
              </ul>
            </li>
            <li><strong>2.6 多级目录长稿章节编排总控台与跨章节人物·概念·时间线矩阵（MAJOR-260）</strong>：
              <ul>
                <li><strong>多级目录一键汇编为长稿总览（<code>#research-folder-binder-toggle</code> / <code>[data-tree-cmd="bind-folder-manuscript"]</code>）</strong>：右键任意多级目录选择「汇编此目录为长稿总览…」，或在「研究 → + 新建与导入 ▾ → 多级目录汇编长稿」中一键递归生成分卷字数汇总、章节状态表与内嵌章节长稿。</li>
                <li><strong>跨章节人物·概念·时间线追踪矩阵（<code>#ai-consistency-matrix-menu</code>）</strong>：在「智识 → 长稿前后核查 → 🧭 设定与时间线矩阵 ▾」菜单中支持按目录筛选生成跨章设定演进矩阵与章节时间线序列表。</li>
              </ul>
            </li>
            <li><strong>2.5 多级目录树递归展开至最底层 / 选中目录全部收起与知识大纲思维导图（MAJOR-250）</strong>：
              <ul>
                <li><strong>多级目录递归展开 / 全部收起（<code>#vault-expand-deep-btn</code> / <code>#vault-collapse-all-btn</code> / <code>[data-folder-recursive-toggle]</code>）</strong>：点击左侧目录树中的任意文件夹即可展开至最底层或全部收起；亦可选中某个目录后点击顶栏「全部展开至最底层 / 全部收起」图标按钮或通过右键菜单操作。</li>
                <li><strong>交互式知识大纲与目录层级思维导图（<code>#mindmap-present-button</code> / <code>#mindmap-presenter-dialog</code>）</strong>：在笔记顶栏「⋯ 更多笔记工具」菜单或目录右键菜单点击<strong>「🌿 知识大纲与目录思维导图」</strong>，即可实时生成可折叠 SVG 思维导图并一键复制 SVG。</li>
              </ul>
            </li>
            <li><strong>2.4 Obsidian JSON Canvas (<code>.canvas</code> 1.0) 双向互通与星图路径投射白板（MAJOR-240）</strong>：
              <ul>
                <li><strong>JSON Canvas 1.0 (<code>.canvas</code>) 双向导入导出</strong>：在「白板」工作台中支持直接导入与导出 Obsidian <code>.canvas</code> 标准文件，自动双向映射 <code>file</code> 笔记卡片、<code>text</code> 文本框、<code>group</code> 分组容器与 <code>edges</code> 连线箭头。</li>
                <li><strong>星图路径 / 子图投射为空间白板（<code>#graph-project-whiteboard-btn</code>）</strong>：在「知识图谱 → 🧭 图谱寻路 ▾」弹出菜单中点击<strong>「🎨 投射为空间白板」</strong>，即可将当前寻路桥梁链路或核心群落一键合成为空间白板（存入 <code>whiteboards/</code>）。</li>
              </ul>
            </li>
            <li><strong>2.3 Obsidian Dataview DQL 实时查询与 Notion / Logseq 无损迁移（MAJOR-230）</strong>：
              <ul>
                <li><strong>Dataview DQL 实时查询引擎（<code>#ai-doctor-tools-menu</code>）</strong>：在「智识 → 格式与断链体检」点击<strong>「🧬 Dataview与多源迁移 ▾」</strong>弹出菜单，支持执行 <code>TABLE / LIST / TASK</code> 查询（含 <code>FROM</code>、<code>WHERE</code>、<code>SORT</code>、<code>LIMIT</code>），实时渲染带可跳转 <code>[[双链]]</code> 的 Markdown 汇总表与待办清单。</li>
                <li><strong>Notion 与 Logseq 多源无损迁移</strong>：自动剥离 Notion 导出 32 位十六进制 UUID 后缀并将顶部属性行转为标准 YAML Frontmatter；自动提取 Logseq <code>key:: value</code> 属性并将 <code>TODO / DOING / DONE</code> 转为标准任务复选框。</li>
              </ul>
            </li>
            <li><strong>2.2 零知识端到端加密（E2EE）增量同步仓与跨平台自检（MAJOR-220）</strong>：
              <ul>
                <li><strong>零知识 E2EE 增量密文仓（<code>#ai-sync-e2ee-menu</code>）</strong>：在「智识 → 多端目录增量同步」点击<strong>「🔐 零知识E2EE与跨平台 ▾」</strong>弹出菜单，支持基于 <code>PBKDF2-HMAC-SHA256 + AES-256-GCM</code> 将全库或指定目录增量推送至零知识密文仓（未改动笔记自动复用密文块，远端不暴露任何明文标题或正文），并支持口令解密还原与 64 位 SHA-256 完整性核验。</li>
                <li><strong>跨平台可移植性与三端宿主自检</strong>：自动巡检全库在 Windows (<code>NTFS</code>)、macOS (<code>APFS</code>/<code>NFC</code>) 与 Linux (<code>ext4</code>) 下的大小写路径冲突、保留名与盘符硬编码引用，输出三端桌面宿主适配状态矩阵。</li>
              </ul>
            </li>
            <li><strong>2.1.1 Markdown 书籍朗读与中文防拆词韵律管线（同步自 Inklet 0.11.8–0.11.9）</strong>：
              <ul>
                <li><strong>菜单收纳与划词即读</strong>：点击笔记顶栏右侧<strong>「⋯ 更多笔记工具 → 书籍朗读」</strong>或在划词浮栏点击<strong>「🔊 朗读选中文字」</strong>即可开启按需朗读播放条（<code>#speech-panel</code>），支持当前段落高亮跟随、上一段/下一段、暂停继续、从光标段朗读及按章/定时（15/30/60 分钟）停止。</li>
                <li><strong>16 款自然音色、防拆词韵律与三态隐私门禁</strong>：在「设置 → 阅读与排版 → 书籍朗读」中支持本机离线语音、16 款在线自然音色（含 4 款中英混读二代多语种模型与港台/方言讲书声）、4 档语调、<code>0.75x ~ 2.00x</code> 倍速与 OpenAI <code>/v1/audio/speech</code> 兼容服务；自动剥离括号纯拼音注音与短词强调引号防拆词，并对内控/机密笔记强制阻断外发。</li>
              </ul>
            </li>
            <li><strong>2.0 多模态 <code>raw/</code> 离线 OCR 摄取与本地 GGUF Embedding 向量索引（MAJOR-200）</strong>：
              <ul>
                <li><strong>多模态扫描件/长图离线 OCR 与表格还原</strong>：在「智识 → Karpathy 知识编译器」左上角点击<strong>「+ 导入与OCR ▾」</strong>弹出菜单，支持导入扫描版 PDF 与本地长图（<code>.png/.jpg/.webp/.svg</code>）或一键载入扫描长图样例，自动按空间行高与列坐标提取正文并还原为标准 Markdown 数据表。</li>
                <li><strong>可选本地 GGUF Embedding 语义向量索引与平滑重建</strong>：在「智识 → 模型与安全配置」右下角点击<strong>「🧬 向量索引管理 ▾」</strong>弹出菜单，可在<strong>128 维特征哈希向量</strong>、<strong>256 维本地轻量 GGUF 语义向量</strong>与<strong>384 维混合 RRF 向量</strong>间切换并一键平滑重建索引（未改动笔记按 SHA-256 自动增量复用，机密笔记 100% 物理剥离）。</li>
              </ul>
            </li>
            <li><strong>2.1 OneNote 手写墨迹还原与外部 MCP 权限审计台（MAJOR-210）</strong>：
              <ul>
                <li><strong>OneNote <code>&lt;one:InkDrawing&gt;</code> 手写墨迹 SVG 还原与四维全保真校验</strong>：迁入含手写笔迹的 OneNote 页面时，自动将 <code>&lt;one:Stroke&gt;</code> 笔触矢量还原为离线 SVG（<code>assets/onenote/*-ink-*.svg</code>），并在核对页输出二维坐标重排、原图字节、手写墨迹 SVG 与随页附件四维全保真核验摘要。</li>
                <li><strong>外部 MCP 工具级权限与审计菜单（<code>#ai-mcp-security-menu</code>）</strong>：在「智识 → 受控 Agent 工具箱 → 外部 AI 接入」点击<strong>「🛡️ 权限与审计 ▾」</strong>弹出菜单，支持一键切换「🔒 仅开放只读工具 / 🔓 开放全部工具」、按工具独立启停、设置允许访问的目录白名单，并实时记录 JSON-RPC 2.0 调用审计账本。</li>
              </ul>
            </li>
            <li><strong>1.9 跨原生窗口多屏协同与页签拖拽拆窗（MAJOR-190）</strong>：
              <ul>
                <li><strong>菜单隐藏与拖拽拆窗（Tear-Off Docking）</strong>：遵循表层极简原则，可通过笔记顶栏右侧<strong>「⋯ 更多笔记工具 → 在新窗口中打开当前笔记 / 多屏协同副窗口管理」</strong>、左侧目录树右键菜单<strong>「在新窗口中打开」</strong>、图谱<strong>「🧭 图谱寻路 ▾ → ↗ 新窗口打开星图」</strong>、原件精读<strong>「阅读与原件 ▾ → ↗ 新窗口打开阅读器」</strong>，或直接用鼠标将顶部页签水泡向下拖出顶栏（<code>deltaY &gt; 36px</code>），将笔记、星图、白板或 PDF/EPUB 阅读器拆分为独立 Windows WebView2 原生副窗口。</li>
                <li><strong>单实例写入锁与跨窗实时同步总线</strong>：主副窗口共享单实例 <code>VaultStore</code> 写入锁与跨窗事件总线；任一窗口保存修改后其他窗口自动同步更新（若另一窗口有未保存草稿，则弹出温和保护提醒而不覆盖草稿）。</li>
              </ul>
            </li>
            <li><strong>1.8 PDF 原生版面画布、框选区域批注与全站极简菜单收纳（MAJOR-180）</strong>：
              <ul>
                <li><strong>PDF 原生版面画布与框选批注（1.8.0）</strong>：在「研究 → 原件精读」中支持切换<strong>「原生版面 / 书卷流式」</strong>，点击<strong>「✏️ 框选批注」</strong>（或直接在 PDF 页面画布上按住左键拖拽）即可框选任意页面区域，自动提取框选区文本、生成离线矢量区域快照缩略图并双向写入 <code>excerpts/</code>（含 <code>source_bbox</code> 与 <code>#inkloom-reader?...&amp;bbox=x,y,w,h</code> 精确锚点）；通过右上角<strong>「阅读与原件 ▾」</strong>菜单可开启<strong>双页并排视图</strong>与版面缩放。</li>
                <li><strong>表层极简 · 菜单收纳统一化（<code>.ux-popover-menu</code>）</strong>：全站遵循极简界面原则，次级工具统一收纳进轻量弹出菜单——笔记顶栏右侧<strong>「⋯ 更多笔记工具」</strong>（专注禅模式 / 幻灯片演示 / 版本对比）、笔记视图顶栏<strong>「视图管理 ▾」</strong>、研究顶栏<strong>「+ 新建与导入 ▾」</strong>、知识图谱<strong>「🧭 图谱寻路 ▾」</strong>以及记忆闪卡<strong>「牌组与制卡 ▾」</strong>。</li>
              </ul>
            </li>
            <li><strong>1.7 学术文献精读、视图保存与沉浸写作增强（1.7.1 ~ 1.7.9）</strong>：
              <ul>
                <li><strong>研究 → 阅读器与引文联动（1.7.1 ~ 1.7.5）</strong>：支持 <code>raw/</code> PDF 按页、EPUB/DOCX/MD 按章节阅读，选段划词五色摘录并生成 <code>[[raw/xxx.pdf#page=N]]</code> 精确锚点；右侧分屏对照栏支持「引用此段」一键插入光标处；原件更新后顶部自动弹出 <code>SHA-256</code> 哈希漂移提醒条；「研究 → 资料」支持导入 <code>.bib</code> / <code>.ris</code> 文献并一键切换 <code>WikiLink</code> / <code>GB/T 7714</code> / <code>APA 7th</code> / <code>BibTeX</code> 四种引用格式。</li>
                <li><strong>笔记视图自定义页签与多选批处理（1.7.6 ~ 1.7.7）</strong>：多维数据库顶部支持将「筛选 + 分组 + 排序 + 展示模式」保存为持久化的自定义视图页签（如「🔥 进行中重点」）；左侧文档树与数据库表格支持 <code>Shift</code> 连续多选、<code>Ctrl</code> 跳选与顶部浮动批处理栏（批量加减标签、改状态、移动目录）；<code>Ctrl+K</code> 空输入时自动展示最近访问的 8 项笔记、章节与 PDF 页码（MRU 栈）。</li>
                <li><strong>Zen 禅定聚光灯、表格列对齐与 SM-2 闪卡牌组（1.7.8 ~ 1.7.9）</strong>：按 <code>Ctrl+Shift+F</code>（或点击顶栏 <code>禅定</code> 按钮）开启打字机段落聚光灯模式；Markdown 表格工具栏支持列左/中/右对齐与一键复制整列数据，代码块与 Mermaid 图表支持右上角一键复制源码或 SVG；「智识 → 记忆闪卡」支持按<strong>来源目录 / <code>#标签</code> / 🔥 难点错题本</strong>精准筛选牌组。</li>
              </ul>
            </li>
            <li><strong>工作台</strong>：默认“总览”展示笔记日期活动、最近记录、待办与星标；“面板”保留六个完整模块及拖拽布局、任务、日历和模板导出。热图不是编辑次数，缺日期不会补造。</li>
            <li><strong>窗内布局</strong>：两侧边界支持拖动、键盘左右键调宽，Home 或双击恢复默认。已打开标签可拖动排序，Alt+Shift+左右键同样可用；参考栏可左右换位。尚未实现跨独立窗口拖动。</li>
            <li><strong>图谱关系审阅、星团水泡与 Hodge 能级分层</strong>：悬停或点击节点展开“关系依据与审阅”，区分 <code>EXTRACTED</code>（显式双链，附源文件与行号直达）与 <code>INFERRED</code>（同标签推断关系，支持原位点击<strong>「✨ 采纳双链」</strong>晋升写入原文或点击<strong>「忽略」</strong>）；顶栏支持切换<strong>「🫧 星团水泡」</strong>（ALGO-007 重整化群多尺度凝聚）与<strong>「能级分层」</strong>布局（ALGO-003 纵向 L1 基石 → L2 晶体 → L3 综合三层势阱）。</li>
            <li><strong>孤岛笔记智能织网与一键周报汇编（「智识 → 孤岛织网与周报」）</strong>：
              <ul>
                <li><strong>孤岛织网（Orphan Weaver）</strong>：一键扫描全库 0 入链且 0 出链的孤岛笔记，通过 128 维余弦向量 + 标签重合度 + 枢纽中心性推荐最佳主干笔记，一键写入 <code>## 关联脉络</code>。</li>
                <li><strong>周报与专题综述（Weekly Digest）</strong>：按近 7 天 / 30 天 / 全周期自动聚合手记、已完成任务与研究摘录，生成带 <code>[[双链]]</code> 与 <code>![[#^block]]</code> 出处的综述笔记。</li>
                <li><strong>长文 H2 原子拆卡（Card Splitter）</strong>：将长笔记按二级标题拆分为独立原子卡片存入 <code>cards/</code> 并生成 MOC 索引。</li>
              </ul>
            </li>
            <li><strong>Karpathy 知识编译器与认知演进史（「智识 → Karpathy 知识编译器 / 认知演进史」）</strong>：
              <ul>
                <li><strong>Karpathy <code>raw/ → wiki/</code> 三大算子（Ingest / Query / Lint）</strong>：① <strong>Ingest</strong>：支持将 PDF、Word (<code>.docx</code>)、PPT (<code>.pptx</code>)、Excel (<code>.xlsx</code>)、CSV、网页 (<code>.html</code>)、TXT 直接拖入窗口或点击「+ 导入资料」放入 <code>raw/</code>（100% 只读保护），自动生成或增量更新 <code>wiki/sources/</code> 文献笔记、<code>wiki/entities/</code> 概念百科与 <code>wiki/topics/</code> 跨源专题综合页（含多源结论对照矩阵，重编译自动保留 <code>## ✍️ 人工研读批注</code>），并支持在右侧分屏对照栏直接阅读 <code>raw/</code> 原件；② <strong>Query</strong>：智识问答支持「Wiki 百科优先 + 原文穿透」检索并一键将高价值回答反哺存入 <code>wiki/</code>；③ <strong>Lint</strong>：审校台支持一键同步待摄取 <code>raw/</code> 文件、一键修复缺失概念页与索引、一键将胡克张力冲突写入 <code>wiki/</code> 正反边界辨析节。</li>
                <li><strong>认知演进史</strong>：按笔记记录中的真实有效日期展示轨迹与本地规则指标，点击右上角可保存为 <code>chronicles/认知演进史.md</code>。</li>
              </ul>
            </li>
            <li><strong>OneNote 迁入与外部 MCP 评估</strong>：
              <ul>
                <li><strong>OneNote</strong>：活动栏底部“工具与迁移” → OneNote 迁入 → 明确选择来源 → 勾选页面并填写目录 → 核对迁入 → 展开预览 → 确认迁入。初始未连接；浏览器只预览，Windows 才写入。缺少附件原字节时阻止迁入；真实 COM 和复杂图文无损迁移尚未认证，请先用副本。</li>
                <li><strong>外部 MCP</strong>：“智识 → 受控 Agent 工具箱 → 外部 AI 接入”保留实验配置。本轮未认证 Copilot、Claude、Cursor 的完整互操作及权限边界，只应在隔离测试库中评估。</li>
              </ul>
            </li>
            <li><strong>核心算法与离线扩展包管理（SDK-007）</strong>：
              <ul>
                <li><strong>星图算法</strong>：有向图 $G=(V,E)$ + Web Worker <code>d3-force</code> 力导向/径向/目录聚类 + IndexedDB 坐标缓存。</li>
                <li><strong>混合检索算法</strong>：范围白名单硬过滤 → 中文 Bigram + BM25 词法打分 → 32 位 FNV-1a 哈希投影 128 维 $L_2$ 归一化向量余弦相似度 → 1 跳双链图扩展。</li>
                <li><strong>离线扩展包（设置 → 工作台与插件）</strong>：支持生成 <code>.inkloom-plugin.json</code> 开发模板、SHA-256 完整性校验安装、版本升级自动备份与一键回退。</li>
              </ul>
            </li>
          </ul>
        </section>
      </div>
      <div class="dialog-footer">
        <button class="primary-command">关闭</button>
      </div>
    </form>
  `;
  document.querySelector('#app').append(dialog);

  const chapterTabs = dialog.querySelector('#guide-chapter-tabs');
  const searchInput = dialog.querySelector('#guide-search-input');
  const sections = [...dialog.querySelectorAll('.guide-section')];
  let activeChapter = 'all';

  function applyFilter() {
    const q = (searchInput?.value || '').trim().toLocaleLowerCase();
    for (const sec of sections) {
      const matchChapter = activeChapter === 'all' || sec.dataset.chapter === activeChapter;
      const matchQuery = !q || sec.textContent.toLocaleLowerCase().includes(q);
      sec.hidden = !(matchChapter && matchQuery);
    }
  }

  chapterTabs?.addEventListener('click', event => {
    const btn = event.target.closest('[data-guide-chapter]');
    if (!btn) return;
    activeChapter = btn.dataset.guideChapter;
    for (const child of chapterTabs.children) {
      child.setAttribute('aria-selected', String(child === btn));
    }
    applyFilter();
  });

  searchInput?.addEventListener('input', applyFilter);

  dialog.addEventListener('click', event => {
    const viewBtn = event.target.closest('[data-guide-view]');
    if (viewBtn) {
      dialog.close();
      openView?.(viewBtn.dataset.guideView);
      return;
    }
    const insertBtn = event.target.closest('[data-guide-insert]');
    if (insertBtn) {
      const snippet = insertBtn.dataset.guideInsert.replaceAll('\\n', '\n');
      dialog.close();
      insertSnippet?.('\n\n' + snippet + '\n');
    }
  });

  return {
    open: () => {
      activeChapter = 'all';
      if (searchInput) searchInput.value = '';
      if (chapterTabs) {
        for (const child of chapterTabs.children) {
          child.setAttribute('aria-selected', String(child.dataset.guideChapter === 'all'));
        }
      }
      applyFilter();
      dialog.showModal();
    },
    close: () => dialog.close(),
  };
}
