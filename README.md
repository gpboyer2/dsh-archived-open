# dsh-archived-open

English → [README.en.md](README.en.md)

## 适合你吗？

DSH 把会话归档以后，侧栏筛「全部对话」还能看见它，但点开只会弹一句「已归档对话暂时无法查看，请取消归档后查看」。得先右键取消归档、再点一次，才能进去看。

- 你经常归档，又经常想回头翻某个旧会话。装。点一下就进去，不用再走两步。
- 你只是想瞟一眼、并不想改归档状态。别装。这个插件是真的会取消归档——会话会回到普通列表里。
- 你从不归档，或者归档了就再也不看。不用装。

## 快速开始

```sh
# 1. 克隆到 ~/.dsh/plugins/dsh-archived-open
git clone https://github.com/gpboyer2/dsh-archived-open.git ~/.dsh/plugins/dsh-archived-open

# 2. 注册到 desktop profile
dsh plugin --profile desktop add link:$HOME/.dsh/plugins/dsh-archived-open

# 3. 重启 DSH
```

`package.json` 里的 `dsh.bundle.patch` 指向自带的 `cordis.patch.yml`，会把插件自动插进插件树；不用手改 profile 的 patch 文件。

重启后随便点一个归档会话。它会先取消归档，然后直接打开。

## 它做的事

一句话：**把「取消归档」和「打开」接成一个动作。**

- 点侧栏里的归档会话行 → 自动取消归档 → 打开该会话。
- 行内的「…」菜单、归档/置顶按钮照旧，点它们不会触发自动取消归档。
- 双击、连点只会执行一次。
- 取消归档失败时不吞错：日志里记一条 `error`，界面不会莫名其妙跳走。

## 原理

DSH 0.2 的侧栏把所有会话行点击都收口到一个守卫里：

```js
const guardedOpen = (sessionId) => {
  if (archivedSessionIds.includes(sessionId)) {
    notifyArchivedNotOpenable()
    return
  }
  open(sessionId)
}
```

归档会话因此永远进不去。但「取消归档」本身是官方能力（`uiWorkspace.unarchiveSession`），只是没有和点击连起来。

本插件在 `document` 的 capture 阶段先接住点击：

1. 命中 `[data-row-key="session:<id>"]`，且这个 id 在 `archivedSessionIds` 里；
2. `preventDefault()` + `stopPropagation()`，拦掉原生的提示；
3. `await unarchiveSession(id)`；
4. 等本地快照把它从归档集合里去掉（最多 3 秒）；
5. `openSession(id)`。

第 4 步不能省：DSH 有一条「归档会话不能保持打开」的规则，快照还没更新就打开，视图会被立刻清掉。

## 诊断

插件把每一步写进 `~/.dsh/logs/archived-open.log`。点了一次没反应，先看这个文件：

| 日志里最后出现 | 说明 |
| --- | --- |
| 什么都没有 | 插件没进插件树：检查 profile 的 `dsh.profile.bundles` 是否含 `dsh-archived-open`，以及包的 `dsh.bundle.patch` 是否被读到 |
| `host-apply` 之后没有了 | 宿主加载了插件，但客户端半部没送到浏览器：看浏览器控制台有没有 bundle 报错 |
| `client-apply` 之后没有了 | 插件在跑，但点击没命中会话行：`nomatch` 行会带上实际看到的 `aria-description` 与 `data-row-key` |
| `hit` → `unarchived` → `opened` | 正常 |
| `error` | 取消归档被宿主拒绝，行尾带原因 |

`nomatch` 每种形态只记一次，不会刷屏。

## 配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `debug` | `true` | 是否写诊断日志并注册 trace 路由 |
| `logFile` | `~/.dsh/logs/archived-open.log` | 日志位置 |

在 `cordis.patch.yml` 的 `config:` 里改，或者装成插件后在 profile 的 patch 层覆盖。`debug: false` 时连 trace 路由都不注册，日志一行不写。

## 测试

```sh
npm test
```

4 个测试：拦截归档行、放行行内控件、放行普通行、连点只触发一次；外加宿主 trace 路由的写入与坏请求拒绝。

## 已知边界

- **搜索结果里的归档行点不了。** 那一行 DOM 上没有会话 id，插件拿不到目标，仍旧走原生的提示。侧栏的行不受影响。
- **打开即取消归档。** 插件不做「看完自动重新归档」，因为那会让会话在列表里跳来跳去，比原问题更烦。
- **必须重启 DSH 才生效。** 客户端 bundle 是启动时扫描的。
- 只适配 DSH 0.2.x 的桌面/Web 客户端；依赖 `uiWorkspace`、`workspaces` 两个客户端服务。

## 许可证

MIT。全文见 [MIT](LICENSE)。
