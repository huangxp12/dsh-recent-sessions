/**
 * 最近会话（Recent Sessions）——浏览器半（手写 bundle，无需构建链）。
 *
 * 为什么是手写：DSH 的客户端插件产物只是 `window.__ModuleLoader__.load({ id, factory })`
 * 这一层包装，容器里的代码通过 `require("react")` 等拿到外壳提供的共享模块
 * （PLATFORM_MODULES 基座：React / react-dom / 静态 UI 库）。因此一个足够小的插件
 * 完全可以零构建链直接写 —— 本文件即证明。
 *
 * 它注册两样东西：
 *   1. root 作用域 `main` keyed slot 的一个新 key（recent-sessions）= 全局面板；
 *   2. `sidebar.panellist` 的一枚图标 = 面板入口（id 必须与上面的 key 一致）。
 *
 * 面板内的数据全部来自外壳提供的 root hooks（useSessions / useSessionStatus /
 * useWorkspaces），不读文件、不碰会话日志。
 */
window.__ModuleLoader__.load({
	id: "dsh-recent-sessions",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		/** 全局面板 key；侧栏条目的 id 必须与它相同（侧栏用 id 调 layout.selectPanel）。 */
		const PANEL_ID = "recent-sessions";
		const NS = "recentSessions";
		const STYLE_ID = "dsh-recent-sessions-style";
		const DAY = 86400000;
		/** 已经请求过轮次大纲投影的会话（模块级，跨渲染去重，避免重复 RPC）。 */
		const projectionRequested = new Set();

		const DICT = {
			zh: {
				panel: "最近会话",
				tagline: "最近会话 · 跨所有工作目录（点任意一行回到那个会话）",
				subtitleZh: "",
				search: "搜索标题 / 目录…",
				openWindow: "在独立窗口打开",
				today: "今天",
				yesterday: "昨天",
				week: "本周",
				earlier: "更早",
				untitled: "（未命名）",
				newSession: "（新会话）",
				empty: "还没有任何会话。先在左侧开一个会话吧。",
				loading: "正在读取会话…",
				showBlank: "含空会话",
				showChild: "含子会话",
				count: "{n} 个会话 · {d} 个目录",
			},
			en: {
				panel: "Recent Sessions",
				tagline: "Recent sessions across every workspace (click a row to jump back)",
				subtitleZh: "",
				search: "Search title / directory…",
				openWindow: "Open in a separate window",
				today: "Today",
				yesterday: "Yesterday",
				week: "This week",
				earlier: "Earlier",
				untitled: "(untitled)",
				newSession: "(new session)",
				empty: "No sessions yet. Start one from the sidebar.",
				loading: "Loading sessions…",
				showBlank: "Include blank",
				showChild: "Include subagents",
				count: "{n} sessions · {d} directories",
			},
		};

		const CSS = `
.dsh-recent { height:100%; box-sizing:border-box; overflow:auto; padding:22px 26px 48px;
  padding-top:calc(22px + var(--dsh-frame-top-clearance, 0px));
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); }
.dsh-recent-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:4px; }
.dsh-recent-title { font-size:17px; font-weight:600; }
.dsh-recent-meta { font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-tagline { margin:2px 0 14px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-spacer { flex:1; }
.dsh-recent-btn { font:inherit; font-size:12px; padding:5px 10px; cursor:pointer; border-radius:7px;
  border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:inherit; }
.dsh-recent-btn:hover { background:var(--dsw-alias-bg-layer-2); }
.dsh-recent-tools { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:14px 0 6px; }
.dsh-recent-search { flex:1 1 240px; max-width:420px; box-sizing:border-box; padding:7px 10px;
  border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1);
  color:inherit; font:inherit; font-size:13px; }
.dsh-recent-search:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.dsh-recent-toggle { display:flex; align-items:center; gap:5px; font-size:12px;
  color:var(--dsw-alias-label-secondary); cursor:pointer; user-select:none; }
.dsh-recent-group { margin:20px 0 6px; font-size:11px; font-weight:600; letter-spacing:.06em;
  color:var(--dsw-alias-label-secondary); text-transform:uppercase; }
.dsh-recent-item { padding:8px 10px; border-radius:9px; border:1px solid transparent; cursor:pointer; }
.dsh-recent-item:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l1); }
.dsh-recent-row { display:flex; align-items:center; gap:10px; }
.dsh-recent-snippet { margin:4px 0 0 17px; font-size:12.5px; line-height:1.45;
  color:var(--dsw-alias-label-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-recent-dot { flex:none; width:7px; height:7px; border-radius:50%; background:var(--dsw-alias-state-idle-primary); }
.dsh-recent-ttl { font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-recent-pin { flex:none; font-size:11px; opacity:.75; }
.dsh-recent-dir { flex:none; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:11.5px; padding:1px 6px; border-radius:5px; color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2); font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  cursor:pointer; border:1px solid transparent; }
.dsh-recent-dir:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l2); }
/* 工具条：排序分段控件 + 目录筛选胶囊 */
.dsh-recent-seg { display:flex; border:1px solid var(--dsw-alias-border-l1); border-radius:7px; overflow:hidden; }
.dsh-recent-segbtn { font:inherit; font-size:11.5px; padding:4px 9px; cursor:pointer;
  color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-1);
  border:0; border-right:1px solid var(--dsw-alias-border-l1); }
.dsh-recent-segbtn:last-child { border-right:0; }
.dsh-recent-segbtn:hover { color:var(--dsw-alias-label-primary); }
.dsh-recent-segbtn.on { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); font-weight:600; }
.dsh-recent-dirfilter { font:inherit; font-size:11.5px; padding:4px 9px; cursor:pointer; border-radius:999px;
  color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-brand-primary);
  background:var(--dsw-alias-bg-layer-1); }
.dsh-recent-time { flex:none; margin-left:auto; font-size:11.5px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-hintline { margin:6px 0 0; font-size:12px; color:var(--dsw-alias-brand-primary); }
.dsh-recent-hitmark { flex:none; font-size:12px; opacity:.85; }
.dsh-recent-empty { margin-top:64px; text-align:center; font-size:13px; color:var(--dsw-alias-label-secondary); }
/* 行上的自有动作与「记一笔」编辑器 */
.dsh-recent-iconbtn { flex:none; margin-left:4px; padding:1px 5px; border-radius:5px; cursor:pointer;
  font:inherit; font-size:12px; line-height:1.4; color:var(--dsw-alias-label-secondary);
  border:1px solid transparent; background:transparent; opacity:0; }
.dsh-recent-item:hover .dsh-recent-iconbtn { opacity:1; }
.dsh-recent-iconbtn:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1); }
.dsh-recent-count { flex:none; padding:1px 6px; border-radius:999px; cursor:pointer; font:inherit; font-size:11.5px;
  color:var(--dsw-alias-label-secondary); border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1); }
.dsh-recent-count:hover { color:var(--dsw-alias-label-primary); }
.dsh-recent-editor { margin:6px 0 2px 17px; }
.dsh-recent-textarea { width:100%; box-sizing:border-box; min-height:58px; resize:vertical; padding:7px 9px;
  border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1);
  color:inherit; font:inherit; font-size:12.5px; line-height:1.5; }
.dsh-recent-textarea:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.dsh-recent-editor-actions { display:flex; align-items:center; gap:8px; margin-top:6px; }
.dsh-recent-hint { font-size:11.5px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-thoughts { margin:4px 0 2px 17px; display:flex; flex-direction:column; gap:4px; }
.dsh-recent-thought { display:flex; align-items:baseline; gap:8px; padding:5px 8px; border-radius:7px;
  background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
.dsh-recent-thought-text { flex:1; font-size:12.5px; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
.dsh-recent-thought-meta { flex:none; font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-thought .dsh-recent-iconbtn { opacity:.5; margin-left:0; }
.dsh-recent-thought:hover .dsh-recent-iconbtn { opacity:1; }
/* 输入框上方的「待问」卡片：默认只有一行小条，点「展开」才铺开 */
.dsh-recent-dock { margin:0 0 6px; padding:5px 9px; border-radius:9px;
  border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
.dsh-recent-dock.open { padding-bottom:9px; border-color:var(--dsw-alias-border-l2);
  box-shadow:0 2px 10px rgba(0,0,0,.10); }
.dsh-recent-dock-bar { display:flex; align-items:center; gap:8px; }
.dsh-recent-dock-bar .dsh-recent-btn { flex:none; font-size:11.5px; padding:3px 8px; }
.dsh-recent-dock-title { flex:none; font-size:12px; font-weight:600; }
.dsh-recent-dock-peek { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-dock-when { flex:none; font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-recent-dock-x { opacity:.55; margin-left:0; }
.dsh-recent-dock-x:hover { opacity:1; }
.dsh-recent-dock-body { margin-top:8px; }
.dsh-recent-dock-text { font-size:12.5px; line-height:1.55; white-space:pre-wrap; word-break:break-word;
  max-height:7.5em; overflow:auto; color:var(--dsw-alias-label-primary); }
.dsh-recent-dock-actions { display:flex; align-items:center; gap:8px; margin-top:8px; }
/* 帧级悬浮入口：不在雷达面板时一直可见，点一下进入雷达。
   浮层本身点击穿透，只有这个胶囊重新开启指针事件。 */
.dsh-recent-pill { position:fixed; right:18px; bottom:18px; z-index:40; pointer-events:auto;
  display:flex; align-items:center; gap:6px; padding:7px 12px; border-radius:999px;
  font:inherit; font-size:12.5px; line-height:1; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-overlay);
  color:var(--dsw-alias-label-primary); box-shadow:0 4px 14px rgba(0,0,0,.18); }
.dsh-recent-pill:hover { border-color:var(--dsw-alias-brand-primary); }
`;

		// ---------------------------------------------------------------- 纯函数

		/** 相对时间（面板每 60 秒重算一次）。 */
		function relTime(ms, now) {
			if (!ms) return "—";
			const d = now - ms;
			if (d < 60000) return "刚刚";
			if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`;
			if (d < DAY) return `${Math.floor(d / 3600000)} 小时前`;
			const days = Math.floor(d / DAY);
			if (days === 1) return "昨天";
			if (days < 7) return `${days} 天前`;
			if (days < 30) return `${Math.floor(days / 7)} 周前`;
			return `${Math.floor(days / 30)} 个月前`;
		}

		/** 时间分组桶。 */
		function bucketOf(ms, now) {
			if (!ms) return "earlier";
			const startOfToday = new Date(now).setHours(0, 0, 0, 0);
			if (ms >= startOfToday) return "today";
			if (ms >= startOfToday - DAY) return "yesterday";
			if (ms >= startOfToday - 6 * DAY) return "week";
			return "earlier";
		}

		/** 目录显示名：路径末段（保留完整路径给 tooltip）。 */
		function dirLabel(p) {
			if (!p) return "(未注册)";
			const parts = String(p).split(/[\\/]+/).filter(Boolean);
			return parts.length ? parts[parts.length - 1] : String(p);
		}

		/** 是否包含（兼容数组与 Set）。 */
		function has(collection, id) {
			if (!collection) return false;
			if (typeof collection.has === "function") return collection.has(id);
			if (Array.isArray(collection)) return collection.indexOf(id) >= 0;
			return false;
		}

		/** 状态点颜色：待处理交互 > 运行中 > 未读完成 > 空闲。 */
		function dotColor(status) {
			if (!status) return "var(--dsw-alias-state-idle-primary)";
			if (status.pendingInteraction) return "var(--dsw-alias-state-warn-primary)";
			if (status.running) return "var(--dsw-alias-state-success-primary)";
			if (status.completionUnread) return "var(--dsw-alias-brand-primary)";
			return "var(--dsw-alias-state-idle-primary)";
		}

		// ------------------------------------------------- 本地存储（想法 / 备注）
		// PRD D7=A：只存本机 localStorage —— 不写宿主存储、不写任何会话日志。
		// 独立窗口与主窗口同源，因此天然共享同一份；跨窗口变更靠 storage 事件同步。
		const STORE_KEY = "dsh-recent-sessions:store:v1";
		/** 旧键（插件还叫「项目雷达」时用的）：首次加载时做一次迁移，之后只写新键。 */
		const LEGACY_STORE_KEY = "dsh-project-radar:store:v1";
		let storeCache = null;
		const storeListeners = new Set();

		function storeLoad() {
			if (storeCache) return storeCache;
			let raw = null;
			try {
				raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
				if (raw === null) {
					// 改名迁移：接管旧键里已有的想法与视图状态，写回新键后清掉旧键
					const legacy = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY) || "null");
					if (legacy !== null && typeof legacy === "object") {
						raw = legacy;
						localStorage.setItem(STORE_KEY, JSON.stringify(legacy));
						localStorage.removeItem(LEGACY_STORE_KEY);
					}
				}
			} catch (error) {
				raw = null;
			}
			storeCache = {
				thoughts: raw && Array.isArray(raw.thoughts)
					? raw.thoughts.filter((item) => item && typeof item.text === "string" && typeof item.sessionId === "string")
					: [],
				notes: raw && raw.notes && typeof raw.notes === "object" ? raw.notes : {},
				// 每个会话的「待问卡片」静音时刻：✕ 之后不再打扰，直到有新想法落进来
				dockMuted: raw && raw.dockMuted && typeof raw.dockMuted === "object" ? raw.dockMuted : {},
				// 视图状态（排序 / 过滤 / 目录筛选）：跟着本机走，下次打开保持一致
				view: raw && raw.view && typeof raw.view === "object" ? raw.view : {},
			};
			return storeCache;
		}

		function storeEmit() {
			for (const listener of [...storeListeners]) {
				try { listener(); } catch (error) { /* 单个监听器失败不影响其它 */ }
			}
		}

		function storeSave() {
			try {
				localStorage.setItem(STORE_KEY, JSON.stringify(storeLoad()));
			} catch (error) {
				console.warn("[recent-sessions] 本地存储写入失败", error);
			}
			storeEmit();
		}

		/**
		 * 收起某个会话的待问卡片（不改动想法本身）。
		 *
		 * 语义：这是"先不打扰"，不是"不要了"。此后只有**新记的想法**
		 * （createdAt 晚于静音时刻）才会再把它叫出来；旧想法仍然留在
		 * 雷达面板的 📝 徽标里，随时可以回去看。
		 */
		function muteDock(sessionId) {
			const store = storeLoad();
			store.dockMuted = Object.assign({}, store.dockMuted, { [sessionId]: Date.now() });
			storeSave();
		}

		/** 合并写入一条视图状态（排序 / 过滤 / 目录筛选）。 */
		function storeSetView(patch) {
			const store = storeLoad();
			store.view = Object.assign({}, store.view, patch);
			storeSave();
		}

		/** 某个会话下未被丢弃的想法。 */
		function thoughtsFor(sessionId) {
			return storeLoad().thoughts.filter((item) => item.sessionId === sessionId && item.status !== "dropped");
		}

		function addThought(sessionId, text) {
			const clean = String(text == null ? "" : text).replace(/\s+$/u, "");
			if (clean.trim() === "") return null;
			const entry = {
				id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
				sessionId,
				text: clean,
				createdAt: Date.now(),
				status: "pending",
			};
			storeLoad().thoughts.push(entry);
			storeSave();
			return entry;
		}

		function patchThought(id, patch) {
			const entry = storeLoad().thoughts.find((item) => item.id === id);
			if (!entry) return;
			Object.assign(entry, patch);
			storeSave();
		}

		function removeThought(id) {
			const store = storeLoad();
			store.thoughts = store.thoughts.filter((item) => item.id !== id);
			storeSave();
		}

		/** 订阅本地存储（含来自独立窗口的 storage 事件）。 */
		function useRecentStore() {
			const [, bump] = React.useState(0);
			React.useEffect(() => {
				const listener = () => bump((n) => n + 1);
				storeListeners.add(listener);
				const onStorage = (event) => {
					if (event.key !== null && event.key !== STORE_KEY) return;
					storeCache = null;
					storeEmit();
				};
				window.addEventListener("storage", onStorage);
				return () => {
					storeListeners.delete(listener);
					window.removeEventListener("storage", onStorage);
				};
			}, []);
			return storeLoad();
		}

		/** 错误边界：任何子组件炸掉都不许影响宿主界面。 */
		class Safe extends React.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				console.warn("[recent-sessions] 组件异常（已隔离，不影响宿主界面）", error);
			}
			render() {
				if (!this.state.failed) return this.props.children;
				return this.props.fallback || null;
			}
		}

		// ---------------------------------------------------------------- 组件

		/** 侧栏图标：雷达准星。 */
		function RecentGlyph(props) {			const size = props.size || 16;
			return h(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.6,
					strokeLinecap: "round",
					style: { opacity: props.active ? 1 : 0.7 },
				},
				h("circle", { cx: 12, cy: 12, r: 8.5 }),
				h("path", { d: "M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" }),
				h("circle", { cx: 12, cy: 12, r: 2.2, fill: "currentColor", stroke: "none" }),
			);
		}

		/**
		 * 帧级悬浮入口（shell.overlay）。
		 *
		 * 两个作用：
		 *   1. 一个不可能看不见的入口 —— 不依赖侧栏面板列表是否渲染；
		 *   2. 一个诊断信号 —— 只要你在这个页面里看到它，就说明插件已经在这个页面加载并注册成功。
		 * 已经站在雷达面板里时自动隐藏，不碍事。
		 */
		function RecentPill(props) {
			const usePanelInfo = props.usePanelInfo;
			const active = typeof usePanelInfo === "function"
				? usePanelInfo((info) => info.activePanelId === PANEL_ID)
				: false;
			if (active) return null;
			return h(
				"button",
				{
					type: "button",
					className: "dsh-recent-pill",
					title: "最近会话：最近会话（跨所有工作目录）",
					onClick: props.openRecent,
				},
				"🛰 最近会话",
			);
		}

		/**
		 * 面板里的一行 = 一个会话。
		 *
		 * 行上带两个自有动作：
		 *   ✎ 记一笔 —— 就地写一句话（只存本机，不发请求、不唤醒会话）；
		 *   📝 n —— 展开已有想法，可逐条删除。
		 */
		function RecentRow(props) {
			const row = props.row;
			const t = props.t;
			const now = props.now;
			const thoughts = props.thoughts;
			const [editing, setEditing] = React.useState(false);
			const [draft, setDraft] = React.useState("");
			const [open, setOpen] = React.useState(false);

			const stop = (event) => event.stopPropagation();
			const save = () => {
				if (addThought(row.id, draft)) {
					setDraft("");
					setEditing(false);
					setOpen(true);
				}
			};

			const line1 = h(
				"div",
				{ className: "dsh-recent-row" },
				h("span", { className: "dsh-recent-dot", style: { background: dotColor(row.status) } }),
				row.pinned ? h("span", { className: "dsh-recent-pin" }, "📌") : null,
				h("span", { className: "dsh-recent-ttl" }, row.title),
				h(
					"button",
					{
						type: "button",
						className: "dsh-recent-dir",
						title: `只看这个目录：${row.dir || row.id}`,
						onClick: (event) => {
							stop(event);
							if (props.onFilterDir) props.onFilterDir(row.dir);
						},
					},
					row.dirLabel,
				),
				h("span", { className: "dsh-recent-time" }, relTime(row.at, now)),
				h(
					"button",
					{
						type: "button",
						className: "dsh-recent-iconbtn",
						title: "记一笔（只存在本机，不会发给模型）",
						onClick: (event) => { stop(event); setEditing((value) => !value); },
					},
					"✎",
				),
				// 行级「找回来」动作：在文件管理器中显示目录 / 复制路径（hover 才出现）
				props.canReveal && row.dir
					? h(
						"button",
						{
							type: "button",
							className: "dsh-recent-iconbtn",
							title: "在文件管理器中显示这个目录",
							onClick: (event) => { stop(event); if (props.onReveal) props.onReveal(row.dir); },
						},
						"📂",
					)
					: null,
				row.dir
					? h(
						"button",
						{
							type: "button",
							className: "dsh-recent-iconbtn",
							title: "复制目录路径",
							onClick: (event) => { stop(event); if (props.onCopyPath) props.onCopyPath(row.dir); },
						},
						"⧉",
					)
					: null,
				thoughts.length > 0
					? h(
						"button",
						{
							type: "button",
							className: "dsh-recent-count",
							title: "查看这个会话下的想法",
							onClick: (event) => { stop(event); setOpen((value) => !value); },
						},
						`📝 ${thoughts.length}`,
					)
					: null,
			);

			// 第二行：最后一句我在问什么（hover 还能看到最后一句它的结论）
			const snippet = row.lastPrompt
				? h(
					"div",
					{
						className: "dsh-recent-snippet",
						title: row.lastResponse ? `它的结论：${row.lastResponse}` : row.lastPrompt,
					},
					`「${row.lastPrompt}」`,
				)
				: null;

			const editor = editing
				? h(
					"div",
					{ className: "dsh-recent-editor" },
					h("textarea", {
						className: "dsh-recent-textarea",
						autoFocus: true,
						value: draft,
						placeholder: "记一句：以后要接着问、要改、或当时没想清楚的地方…（Ctrl+Enter 保存，Esc 取消）",
						onChange: (event) => setDraft(event.target.value),
						onKeyDown: (event) => {
							event.stopPropagation();
							if ((event.ctrlKey || event.metaKey) && event.key === "Enter") save();
							if (event.key === "Escape") setEditing(false);
						},
					}),
					h(
						"div",
						{ className: "dsh-recent-editor-actions" },
						h("button", { type: "button", className: "dsh-recent-btn", onClick: save }, "保存（Ctrl+Enter）"),
						h("button", { type: "button", className: "dsh-recent-btn", onClick: () => setEditing(false) }, "取消"),
						h("span", { className: "dsh-recent-hint" }, "存在本机；下次打开这个会话时，输入框上方会提示你"),
					),
				)
				: null;

			const list = open && thoughts.length > 0
				? h(
					"div",
					{ className: "dsh-recent-thoughts" },
					thoughts.map((item) =>
						h(
							"div",
							{ className: "dsh-recent-thought", key: item.id },
							h("span", { className: "dsh-recent-thought-text" }, item.text),
							h(
								"span",
								{ className: "dsh-recent-thought-meta" },
								`${relTime(item.createdAt, now)}${item.status === "delivered" ? " · 已填入过" : ""}`,
							),
							h(
								"button",
								{
									type: "button",
									className: "dsh-recent-iconbtn",
									title: "删除这条想法",
									onClick: () => removeThought(item.id),
								},
								"✕",
							),
						),
					),
				)
				: null;

			return h(
				"div",
				{
					className: "dsh-recent-item",
					role: "button",
					tabIndex: 0,
					title: row.dir || row.id,
					onClick: () => props.openSession(row.id),
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							props.openSession(row.id);
						}
					},
				},
				line1,
				snippet,
				editor,
				list,
			);
		}

		/**
		 * 输入框上方的「待问」卡片（conversation.input.dock，session 作用域）。
		 *
		 * PRD D4=B 的送达机制：当你打开这个会话时，如果本机存着它的想法，
		 * 就在这里出现一张卡片 —— 你必须点一下才填入草稿，绝不自动发送、
		 * 绝不排队投递、绝不触发模型运行。
		 */
		function ThoughtDock(props) {
			const sessionId = props.sessionId || (props.session && props.session.id);
			const inputActions = props.inputActions;
			const store = useRecentStore();
			const [hint, setHint] = React.useState("");
			const [expanded, setExpanded] = React.useState(false);

			const all = store.thoughts.filter((item) => item.sessionId === sessionId && item.status !== "dropped");
			const mutedAt = (store.dockMuted && store.dockMuted[sessionId]) || 0;
			// 默认只显示一行；被 ✕「先不打扰」之后，只有新记的想法才会再叫它出来
			const pending = all.filter((item) => item.createdAt > mutedAt);
			if (!sessionId || pending.length === 0) return null;

			const text = pending.map((item) => item.text).join("\n");
			const peek = String(pending[0].text).replace(/\s+/g, " ").slice(0, 64);

			const deliver = () => {
				let ok = false;
				try {
					const span = inputActions && typeof inputActions.captureInsertion === "function"
						? inputActions.captureInsertion()
						: undefined;
					if (inputActions && typeof inputActions.insertText === "function") {
						ok = inputActions.insertText(text, span) === true;
					}
				} catch (error) {
					ok = false;
					console.warn("[recent-sessions] 插入草稿失败", error);
				}
				if (ok) {
					for (const item of pending) patchThought(item.id, { status: "delivered", deliveredAt: Date.now() });
					// 卡片已完成使命：连同静音一起收起，不再占地方
					muteDock(sessionId);
					return;
				}
				try {
					navigator.clipboard.writeText(text);
					setHint("编辑器此刻不接受插入，已复制到剪贴板：直接粘贴即可");
				} catch (error) {
					setHint("编辑器此刻不接受插入，请到「最近会话」面板里手动复制");
				}
			};

			/** ✕ = 先不打扰：不改动想法本身，只是不再主动出现。 */
			const mute = () => {
				setHint("");
				setExpanded(false);
				muteDock(sessionId);
			};

			return h(
				Safe,
				null,
				h(
					"div",
					{ className: `dsh-recent-dock${expanded ? " open" : ""}` },
					h(
						"div",
						{ className: "dsh-recent-dock-bar" },
						h("span", { className: "dsh-recent-dock-title" }, `📝 ${pending.length} 条想法`),
						h("span", { className: "dsh-recent-dock-peek", title: peek }, peek),
						h("span", { className: "dsh-recent-dock-when" }, relTime(pending[0].createdAt, Date.now())),
						h(
							"button",
							{ type: "button", className: "dsh-recent-btn", onClick: () => setExpanded((value) => !value) },
							expanded ? "收起" : "展开",
						),
						h(
							"button",
							{
								type: "button",
								className: "dsh-recent-iconbtn dsh-recent-dock-x",
								title: "先不打扰（不改动想法；以后再记新的会重新出现）",
								onClick: mute,
							},
							"✕",
						),
					),
					expanded
						? h(
							"div",
							{ className: "dsh-recent-dock-body" },
							h("div", { className: "dsh-recent-dock-text" }, text),
							h(
								"div",
								{ className: "dsh-recent-dock-actions" },
								h("button", { type: "button", className: "dsh-recent-btn", onClick: deliver }, "填入输入框"),
								h(
									"button",
									{ type: "button", className: "dsh-recent-btn", onClick: mute },
									"先不打扰",
								),
								h(
									"button",
									{
										type: "button",
										className: "dsh-recent-btn",
										title: "把这些想法标记为丢弃（雷达里也不再多显示）",
										onClick: () => {
											for (const item of pending) patchThought(item.id, { status: "dropped" });
											setHint("");
										},
									},
									"丢弃",
								),
								hint ? h("span", { className: "dsh-recent-hint" }, hint) : null,
							),
						)
						: null,
				),
			);
		}

		/**
		 * 全局面板。props 里由外壳提供 root hooks 与 locale-bound 的 t。
		 */
		function RecentPanel(props) {
			const useSessions = props.useSessions;
			const useSessionStatus = props.useSessionStatus;
			const useWorkspaces = props.useWorkspaces;
			const t = typeof props.t === "function" ? props.t : (key, vars) => {
				const raw = DICT.zh[key] !== undefined ? DICT.zh[key] : key;
				return vars ? String(raw).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : raw;
			};
			const openSession = props.openSession; // 由注册项的 inject face 注入（闭包）
			const refreshProjections = props.refreshProjections;
			const searchSessions = props.searchSessions;
			const canOpenWorkspacePath = props.canOpenWorkspacePath;
			const openWorkspacePath = props.openWorkspacePath;

			// 防御：外壳的 slot catalog 保证这些 root hook 会以标准 prop 传入；
			// 万一组合里少了一个，也不要让整个主面板白屏。这个判断在同一次组合内恒定，
			// 因此不违反 hooks 调用顺序（同一组件实例的 hook 数量不会变化）。
			if (typeof useSessions !== "function") {
				return h("div", { className: "dsh-recent" },
					h("div", { className: "dsh-recent-empty" }, "recent-sessions: useSessions hook 不可用（外壳未提供该 root hook）"));
			}

			const list = useSessions((s) => s);
			const statuses = useSessionStatus ? useSessionStatus((s) => s) : null;
			const ws = useWorkspaces ? useWorkspaces((s) => s) : null;

			// 本地存储：想法 + 视图状态（视图状态跟着本机走，下次打开保持一致）
			const localStore = useRecentStore();
			const view = localStore.view || {};
			const sortMode = view.sort === "stale" ? "stale" : "recent";
			const onlyUnfinished = view.onlyUnfinished === true;
			const showBlank = view.showBlank === true;
			const showChild = view.showChild === true;
			const dirFilter = typeof view.dirFilter === "string" ? view.dirFilter : "";
			const changeView = (patch) => storeSetView(patch);

			const [query, setQuery] = React.useState("");
			const [hits, setHits] = React.useState(null); // 内容全文检索命中：{ items, hasMore } | null
			const [hint, setHint] = React.useState(""); // 一次性提示（显示位置 / 复制路径的结果）
			const [canReveal, setCanReveal] = React.useState(false); // 宿主是否具备原生文件管理器能力
			const [, forceTick] = React.useState(0);

			React.useEffect(() => {
				const timer = setInterval(() => forceTick((n) => n + 1), 60000);
				return () => clearInterval(timer);
			}, []);

			// 宿主有没有原生文件管理器能力（整页只问一次；没有就隐藏「显示位置」按钮）
			React.useEffect(() => {
				if (!canOpenWorkspacePath) return undefined;
				let alive = true;
				(async () => {
					try {
						const value = await canOpenWorkspacePath();
						if (alive) setCanReveal(value === true);
					} catch (error) {
						if (alive) setCanReveal(false);
					}
				})();
				return () => { alive = false; };
			}, [canOpenWorkspacePath]);

			// 内容全文检索：250ms 防抖 + 取消上一请求；失败静默（本地过滤照常显示）
			React.useEffect(() => {
				const needle = query.trim();
				if (!searchSessions || needle === "") {
					setHits(null);
					return undefined;
				}
				const controller = new AbortController();
				const timer = setTimeout(async () => {
					try {
						const result = await searchSessions(needle, controller.signal);
						const items = result && Array.isArray(result.items) ? result.items : [];
						setHits({ items, hasMore: Boolean(result && result.hasMore) });
					} catch (error) {
						setHits(null);
					}
				}, 250);
				return () => {
					clearTimeout(timer);
					controller.abort();
				};
			}, [query, searchSessions]);

			/** 一次性提示；4 秒后自动消失。 */
			const notify = (message) => {
				setHint(message);
				window.setTimeout(() => setHint((current) => (current === message ? "" : current)), 4000);
			};

			/** 在文件管理器中显示目录；失败则退化为复制路径。 */
			const revealPath = (target) => {
				if (!openWorkspacePath || !target) return;
				try {
					const pending = openWorkspacePath(target);
					if (pending && typeof pending.catch === "function") {
						pending.then(
							() => notify("已在文件管理器中显示"),
							() => {
								try { navigator.clipboard.writeText(target); } catch (error) { /* ignore */ }
								notify("打不开文件管理器，路径已复制到剪贴板");
							},
						);
						return;
					}
					notify("已在文件管理器中显示");
				} catch (error) {
					try { navigator.clipboard.writeText(target); } catch (inner) { /* ignore */ }
					notify("打不开文件管理器，路径已复制到剪贴板");
				}
			};

			/** 复制目录路径。 */
			const copyPath = (target) => {
				if (!target) return;
				try {
					navigator.clipboard.writeText(target);
					notify("已复制路径");
				} catch (error) {
					notify("复制失败（浏览器未授权剪贴板）");
				}
			};

			const now = Date.now();
			const ids = (list && list.ids) || [];
			const byId = (list && list.byId) || {};
			const pinned = ws && ws.pinnedSessionIds;
			const archived = ws && ws.archivedSessionIds;
			/** 每会话的投影值（sessionId → { values: { title, turnOutline, … } }）。 */
			const projections = (list && list.projectionsBySession) || {};
			/** 本地想法：按会话分桶（dropped 的不再出现）。 */
			const thoughtsBySession = {};
			for (const item of localStore.thoughts) {
				if (item.status === "dropped") continue;
				if (!thoughtsBySession[item.sessionId]) thoughtsBySession[item.sessionId] = [];
				thoughtsBySession[item.sessionId].push(item);
			}

			// 目录 chip 的完整路径（优先取登记的工作区路径，回落到会话自身 cwd）
			const workspacePathBySession = {};
			if (ws && ws.items) {
				for (const item of ws.items) {
					for (const sid of item.sessionIds || []) workspacePathBySession[sid] = item.path;
				}
			}

			const rows = [];
			for (const id of ids) {
				const row = byId[id];
				if (!row) continue;
				if (row.origin === "subagent" && !showChild) continue;
				if (row.blank && !showBlank) continue;
				if (has(archived, id)) continue;
				const dir = workspacePathBySession[id] || row.cwd || "";
				if (dirFilter && dir !== dirFilter) continue;
				const status = statuses ? statuses.get(id) : undefined;
				const rowThoughts = thoughtsBySession[id] || [];
				const title = row.blank ? t("newSession") : String(row.title || row.displayTitle || "").trim() || t("untitled");
				if (query) {
					const needle = query.toLowerCase();
					if (`${title} ${dir} ${row.id}`.toLowerCase().indexOf(needle) < 0) continue;
				}
				// 轮次大纲投影：最后一条人类提问 + 最后一条助手回复（预览已由宿主截断）
				const projectionStore = projections[id];
				const turns = projectionStore && projectionStore.values && Array.isArray(projectionStore.values.turnOutline)
					? projectionStore.values.turnOutline
					: null;
				const lastTurn = turns && turns.length > 0 ? turns[turns.length - 1] : null;
				// 「未收尾」的口径：有待问想法 / 最后一轮还没落定回复 / 正在跑 / 有未查看的完成
				const unsettled = Boolean(lastTurn && lastTurn.prompt && !lastTurn.response);
				if (onlyUnfinished) {
					const busy = Boolean(status && (status.running || status.pendingInteraction || status.completionUnread));
					if (rowThoughts.length === 0 && !unsettled && !busy) continue;
				}
				rows.push({
					id,
					title,
					dir,
					dirLabel: dirLabel(dir),
					at: row.updatedAt || 0,
					pinned: has(pinned, id),
					status,
					unsettled,
					lastPrompt: lastTurn && typeof lastTurn.prompt === "string" ? lastTurn.prompt : "",
					lastResponse: lastTurn && typeof lastTurn.response === "string" ? lastTurn.response : "",
					turnCount: turns ? turns.length : 0,
				});
			}
			// 排序：置顶优先；最近活动（默认）降序，或最久没动升序；从未活动过的永远排最后
			const sortKey = (item) => (item.at ? item.at : (sortMode === "stale" ? Number.MAX_SAFE_INTEGER : -1));
			rows.sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return sortMode === "stale" ? sortKey(a) - sortKey(b) : sortKey(b) - sortKey(a);
			});
			// 「最久没动」时把时间桶倒过来，最早的排在最前
			const bucketOrder = sortMode === "stale"
				? ["earlier", "week", "yesterday", "today"]
				: ["today", "yesterday", "week", "earlier"];

			// 按需补拉「前 30 行」的轮次大纲投影：不激活会话、不打开日志正文（读的是持久投影缓存）。
			// 首屏先用已有字段渲染；全部拉完后再强制重绘一次，保证第二行一定出现
			// （不依赖列表快照对象是否换了身份）。
			const fetchIds = rows.slice(0, 30).map((item) => item.id).join(",");
			const [, projectionTick] = React.useState(0);
			React.useEffect(() => {
				if (!refreshProjections || fetchIds === "") return;
				let alive = true;
				(async () => {
					for (const sessionId of fetchIds.split(",")) {
						if (projectionRequested.has(sessionId)) continue;
						projectionRequested.add(sessionId);
						try {
							await refreshProjections(sessionId);
						} catch (error) {
							/* 单个会话的投影失败不影响列表 */
						}
					}
					if (alive) projectionTick((value) => value + 1);
				})();
				return () => { alive = false; };
			}, [fetchIds, refreshProjections]);

			const groups = { today: [], yesterday: [], week: [], earlier: [] };
			for (const row of rows) groups[bucketOf(row.at, now)].push(row);
			const dirCount = new Set(rows.map((r) => r.dir).filter(Boolean)).size;

			const openWindow = () => {
				const base = location.origin + location.pathname;
				window.open(`${base}#${PANEL_ID}`, "dsh-recent-sessions", "width=380,height=760");
			};

			const children = [];
			children.push(
				h(
					"div",
					{ className: "dsh-recent-head", key: "head" },
					h("div", { className: "dsh-recent-title" }, t("panel")),
					h("div", { className: "dsh-recent-meta" }, t("count", { n: rows.length, d: dirCount })),
					h("div", { className: "dsh-recent-spacer" }),
					h("button", { className: "dsh-recent-btn", type: "button", onClick: openWindow, title: t("openWindow") }, t("openWindow")),
				),
			);
			children.push(h("div", { className: "dsh-recent-tagline", key: "tagline" }, t("tagline")));
			/** 工具条里的一个复选项（视图状态写进本地存储，下次打开保持）。 */
			const check = (label, checked, onChange) => h(
				"label",
				{ className: "dsh-recent-toggle" },
				h("input", { type: "checkbox", checked, onChange: (event) => onChange(event.target.checked) }),
				label,
			);

			children.push(
				h(
					"div",
					{ className: "dsh-recent-tools", key: "tools" },
					h("input", {
						className: "dsh-recent-search",
						type: "search",
						placeholder: t("search"),
						value: query,
						onChange: (e) => setQuery(e.target.value),
					}),
					h(
						"div",
						{ className: "dsh-recent-seg", role: "group" },
						h(
							"button",
							{
								type: "button",
								className: `dsh-recent-segbtn${sortMode === "recent" ? " on" : ""}`,
								title: "按最近活动排序",
								onClick: () => changeView({ sort: "recent" }),
							},
							"最近活动",
						),
						h(
							"button",
							{
								type: "button",
								className: `dsh-recent-segbtn${sortMode === "stale" ? " on" : ""}`,
								title: "按最久没动排序（适合清理搁置的会话）",
								onClick: () => changeView({ sort: "stale" }),
							},
							"最久没动",
						),
					),
					check("仅未收尾", onlyUnfinished, (value) => changeView({ onlyUnfinished: value })),
					check(t("showBlank"), showBlank, (value) => changeView({ showBlank: value })),
					check(t("showChild"), showChild, (value) => changeView({ showChild: value })),
					dirFilter
						? h(
							"button",
							{
								type: "button",
								className: "dsh-recent-dirfilter",
								title: `只看：${dirFilter}（点击取消）`,
								onClick: () => changeView({ dirFilter: "" }),
							},
							`📁 ${dirLabel(dirFilter)} ✕`,
						)
						: null,
				),
			);

			if (hint) children.push(h("div", { className: "dsh-recent-hintline", key: "hint" }, hint));

			// 内容命中（宿主的消息索引）：独立分区，点击直接回到那个会话
			if (hits && hits.items.length > 0) {
				children.push(
					h(
						"div",
						{ className: "dsh-recent-group", key: "g-hits" },
						`🔎 内容命中 · ${hits.items.length}${hits.hasMore ? "+" : ""}`,
					),
				);
				for (const hit of hits.items) {
					const summary = byId[hit.sessionId];
					const hitDir = workspacePathBySession[hit.sessionId] || (summary && summary.cwd) || "";
					const hitTitle = summary
						? (summary.blank ? t("newSession") : String(summary.title || summary.displayTitle || "").trim() || t("untitled"))
						: hit.sessionId;
					children.push(
						h(
							"div",
							{
								className: "dsh-recent-item",
								key: `hit-${hit.sessionId}`,
								role: "button",
								tabIndex: 0,
								title: hitDir || hit.sessionId,
								onClick: () => openSession(hit.sessionId),
								onKeyDown: (event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										openSession(hit.sessionId);
									}
								},
							},
							h(
								"div",
								{ className: "dsh-recent-row" },
								h("span", { className: "dsh-recent-hitmark" }, "🔎"),
								h("span", { className: "dsh-recent-ttl" }, hitTitle),
								hitDir ? h("span", { className: "dsh-recent-dir", style: { cursor: "default" } }, dirLabel(hitDir)) : null,
							),
							h("div", { className: "dsh-recent-snippet" }, hit.snippet),
						),
					);
				}
			}

			if (rows.length > 0) {
				for (const key of bucketOrder) {
					const bucket = groups[key];
					if (bucket.length === 0) continue;
					children.push(h("div", { className: "dsh-recent-group", key: `g-${key}` }, `${t(key)} · ${bucket.length}`));
					for (const row of bucket) {
						children.push(
							h(RecentRow, {
								key: row.id,
								row,
								now,
								t,
								openSession,
								thoughts: thoughtsBySession[row.id] || [],
								onFilterDir: (dir) => changeView({ dirFilter: dir }),
								onReveal: revealPath,
								onCopyPath: copyPath,
								canReveal,
							}),
						);
					}
				}
			} else if (list && list.phase && list.phase !== "ready") {
				children.push(h("div", { className: "dsh-recent-empty", key: "loading" }, t("loading")));
			} else {
				children.push(h("div", { className: "dsh-recent-empty", key: "empty" }, t("empty")));
			}

			return h(
				Safe,
				{
					fallback: h(
						"div",
						{ className: "dsh-recent" },
						h("div", { className: "dsh-recent-empty" }, "最近会话内部出错，已隔离（不影响其它界面）。刷新页面可重试。"),
					),
				},
				h("div", { className: "dsh-recent" }, children),
			);
		}

		// ---------------------------------------------------------------- 插件

		const inject = ["slots", "locale", "sessions", "remote", "uiWorkspace", "layout"];

		function apply(ctx) {
			const uiWorkspace = ctx.get("uiWorkspace");
			const sessions = ctx.get("sessions");
			const remote = ctx.get("remote");

			ctx.effect(() => ctx.locale.register(NS, DICT), "recent-sessions: dictionaries");

			// 样式注入（声明式；dispose 时移除）
			ctx.effect(() => {
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, "recent-sessions: styles");

			// 1) 全局面板
			ctx.effect(
				() =>
					ctx.slots.inject("main", () =>
						ctx.slots.register(
							{
								name: "main",
								key: PANEL_ID,
								locale: NS,
								inject: () => ({
									openSession: (sessionId) => uiWorkspace.openSession(sessionId),
									// 轮次大纲投影：客户端按会话拉取完整投影基线（宿主读持久缓存，不激活会话）
									refreshProjections: (sessionId) => sessions.refreshProjections(sessionId),
									// 内容全文检索（宿主消息索引）
									searchSessions: (query, signal) => sessions.search(query, signal),
									// 原生路径能力：能否打开文件管理器 / 在文件管理器中显示目录
									canOpenWorkspacePath: () => remote.session.canOpenWorkspacePath(),
									openWorkspacePath: (path) => remote.session.openWorkspacePath({ path, action: "reveal" }),
								}),
							},
							RecentPanel,
						),
					),
				"recent-sessions: main panel",
			);

			// 2) 侧栏入口（id 必须等于 main 的 key）
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.panellist", () =>
						ctx.slots.register(
							{
								name: "sidebar.panellist",
								id: PANEL_ID,
								order: 40,
								locale: NS,
								// 纯字符串：不依赖词典绑定时机，保证悬停提示与行标签一定可解析
								label: "最近会话",
							},
							RecentGlyph,
						),
					),
				"recent-sessions: sidebar entry",
			);

			// 3) 输入框上方的「待问」卡片（session 作用域）
			//    D4=B 的送达机制：打开有想法的会话时出现；必须用户点一下才填入草稿，
			//    绝不自动发送、绝不排队投递、绝不触发模型运行。整卡包在 Safe 里，
			//    任何异常都只让它自己消失，不影响宿主输入框。
			ctx.effect(
				() =>
					ctx.slots.inject("conversation.input.dock", () =>
						ctx.slots.register(
							{
								name: "conversation.input.dock",
								id: "recent-sessions-thoughts",
								order: 30,
								locale: NS,
							},
							ThoughtDock,
						),
					),
				"recent-sessions: thought dock",
			);

			// 4) 帧级悬浮入口（不依赖侧栏列表渲染，点击即进雷达）
			ctx.effect(
				() =>
					ctx.slots.inject("shell.overlay", () =>
						ctx.slots.register(
							{
								name: "shell.overlay",
								id: "recent-sessions-pill",
								order: 60,
								locale: NS,
								inject: () => ({ openRecent: () => ctx.layout.selectPanel(PANEL_ID) }),
							},
							RecentPill,
						),
					),
				"recent-sessions: overlay pill",
			);

			// 5) 独立窗口标记：URL 带 #recent-sessions 时自动切到本面板。
			//    在 Web GUI 下用同源 window.open 就能开出一个真正独立的窗口
			//    （认证是签名 cookie，同源新窗口会带上）。
			ctx.effect(() => {
				if (location.hash !== `#${PANEL_ID}`) return;
				const timer = setTimeout(() => {
					try {
						ctx.layout.selectPanel(PANEL_ID);
					} catch (error) {
						console.warn("[recent-sessions] 无法自动选中面板", error);
					}
				}, 0);
				return () => clearTimeout(timer);
			}, "recent-sessions: popout marker");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
