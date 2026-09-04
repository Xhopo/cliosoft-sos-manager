# ClioSoft SOS Manager — 项目文档

## 目录

1. [项目简介](#1-项目简介)
2. [功能概览](#2-功能概览)
3. [环境要求与安装](#3-环境要求与安装)
4. [使用指南](#4-使用指南)
5. [配置参考](#5-配置参考)
6. [源码架构](#6-源码架构)
7. [各模块详解](#7-各模块详解)
8. [数据流与刷新机制](#8-数据流与刷新机制)
9. [构建与打包](#9-构建与打包)
10. [常见问题](#10-常见问题)

---

## 1. 项目简介

**ClioSoft SOS Manager** 是一个 VS Code 扩展，为 [ClioSoft SOS](https://www.cliosoft.com/) 版本控制系统提供图形化集成。

SOS（Software & IP Lifecycle Management）是半导体 / IC 设计行业常用的版本管理工具，
底层通过命令行工具 `soscmd` 操作。本扩展将 `soscmd` 的核心操作（Checkout、Checkin、Diff、Discard、版本切换等）搬到 VS Code 内，
并在资源管理器和编辑器中直接显示文件的 SOS 状态（已检出、已修改、有新版本等）。

| 字段 | 值 |
|------|----|
| 扩展 ID | `xhopo.cliosoft-sos-manager` |
| 当前版本 | 0.48.2 |
| VS Code 最低版本 | 1.85.0 |
| 目标平台 | Linux（`soscmd` 仅在 Linux 上可用） |
| 语言 | TypeScript |

---

## 2. 功能概览

### 2.1 SOS 命令集成

| 命令 | 描述 | 默认快捷键 |
|------|------|------------|
| Check Out | 检出文件（无锁模式 `-Nlock`） | `Ctrl+Alt+O` |
| Check In | 检入文件，弹出输入框填写 Log | `Ctrl+Alt+I` |
| Diff | 对每个选中文件执行 `soscmd diff -gui <file>`，与 SOS 默认版本比较 | — |
| Diff Two SOS Revisions | 选择 1 个 revision 与 workarea 比较，或选择 2 个 revision 互相比较 | — |
| Discard | 丢弃检出，可选 `-F`（强制覆盖）。对"未 checkout 但本地已改"（`-sncm`）的文件会引导走 Update | `Ctrl+Alt+D` |
| Office Open | 用 LibreOffice 等打开文件 | — |
| Rebuild Ctags | 重建项目 ctags 索引 | — |

所有命令均支持：
- **资源管理器右键菜单**（单选 / 多选）
- **编辑器右键菜单**
- **Changed Files 树视图右键**（文件 / 文件夹批量）
- **键盘快捷键**（Quick 命令系列）

快捷键在**非文本编辑器**（如 Hex Viewer 打开二进制/不支持的文件）中同样生效：不要求 `editorTextFocus`，活动文件从当前活动标签页解析。

多文件操作自动分批（每批 50 个），带进度条和取消支持。

### 2.2 文件状态装饰

在资源管理器中每个文件名右侧显示 badge：

| Badge | 含义 | 颜色 |
|-------|------|------|
| `CO` | Checked Out（未修改） | 绿色 |
| `M` | 已修改 | 橙色 / 黄色 |
| `D` | 已删除 | 红色 |
| `N!` | 有新版本 | 紫色 |
| `CI` | Checked In（SOS 管理的未变更文件） | 灰色 |
| 数字 | 文件夹内变更文件数量 | 紫色 |

### 2.3 侧边栏视图

扩展在活动栏注册了 **ClioSoft SOS** 视图容器，包含两个面板：

1. **File Versions** — 显示当前活动文件的版本历史，点击可切换到指定版本
2. **Changed Files** — 显示工作区所有"值得关注"的文件（已检出 / 已修改 / 已删除 / 有新版本），以文件夹层级树形式呈现

### 2.4 状态栏

右下角显示 `SOS: Active` 或 `SOS: Paused`，点击可暂停 / 恢复自动状态刷新。

---

## 3. 环境要求与安装

### 3.1 前提条件

- **Linux** 操作系统（扩展在非 Linux 下会弹出警告并禁用所有 SOS 命令）
- **ClioSoft SOS** 客户端已安装，`soscmd` 命令可在 PATH 中执行
- **VS Code** ≥ 1.85.0

### 3.2 安装方式

#### 方式 A：从 VSIX 安装

```bash
code --install-extension cliosoft-sos-manager-0.2.0.vsix
```

#### 方式 B：从源码编译

```bash
git clone <repo-url>
cd cliosoft-sos-manager
npm install
npm run compile
# 打包
npx @vscode/vsce package
```

---

## 4. 使用指南

### 4.1 基本工作流

1. 在 VS Code 中打开一个 SOS 管理的工作区
2. 侧边栏自动出现 **ClioSoft SOS** 图标
3. 点击 **Changed Files** 面板，首次会自动扫描工作区
4. 在资源管理器中右键文件 → 选择 `Check Out` / `Check In` / `Diff` / `Discard`
5. 编辑器中也可通过右键菜单或快捷键操作

### 4.2 版本切换

1. 在编辑器中打开某个 SOS 管理的文件
2. 在侧边栏 **File Versions** 面板中查看历史版本
3. 点击某个版本号，确认后自动执行 `userev` 切换
4. 如果文件已检出，会先提示 Discard 再切换

### 4.3 批量操作

在资源管理器或 Changed Files 树中多选文件（Ctrl / Shift 点击），右键执行命令即可批量操作。
文件夹节点上右键会展开为该文件夹下所有变更文件。

### 4.4 暂停刷新

点击状态栏 `SOS: Active` 可暂停自动状态查询（节省 SOS 服务器资源），再次点击恢复。

---

## 5. 配置参考

所有配置项前缀为 `cliosoft-sos-manager.`，在 VS Code Settings 中搜索 `cliosoft` 即可找到。

### 5.1 通用配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableDebugInfo` | boolean | `false` | 启用调试日志输出到 Output Channel |
| `autoShowOutputOnError` | boolean | `false` | 出错时自动弹出 SOS 输出面板 |
| `statusRefreshInterval` | number | `30` | 活动文件自动刷新间隔（秒），范围 5–300 |
| `cacheExpiryTime` | number | `180` | 文件夹状态缓存过期时间（秒），范围 30–3600 |
| `enableDiskCache` | boolean | `true` | 将状态缓存持久化到磁盘，加速下次启动 |

### 5.2 命令启用 / 自定义

每个命令都有 `enable` 和 `command` 两个配置：

| 命令名 | enable 默认 | command 说明 |
|--------|------------|-------------|
| `commands.checkout` | `true` | 留空则使用 `soscmd co -Nlock` |
| `commands.checkin` | `true` | 留空则使用 `soscmd ci -aLog=...` |
| `commands.diff` | `true` | 留空则使用 `soscmd diff -gui`；多文件时按文件分别执行 |
| `commands.discard` | `true` | 留空则使用 `soscmd discard [-F]` |
| `commands.officeOpen` | `true` | 留空则使用 `soffice "文件路径"` |
| `commands.rebuildCtags` | `true` | 留空则使用内置 ctags 命令 |
| `commands.compileRtl` | `true` | 留空则无默认行为 |

自定义命令中可用变量：
- `${filePath}` — 文件路径（批量时自动展开为空格分隔的引号路径）
- `${filePath1}` / `${filePath2}` — Diff Two SOS Revisions 的 pathname（可带 `/#/revision`）
- `${revision1}` / `${revision2}` — 选中的 SOS revision ID
- `${comments}` — 检入注释（仅 checkin 命令）
- `${useForce}` — `-F` 或空字符串（仅 discard 命令）

`soscmd diff` 最多接受同一文件的两个 pathname。多文件 Diff 是逐文件比较各自默认版本，不会把不同文件当成同一条 diff 的两端。

示例：
```json
{
  "cliosoft-sos-manager.commands.checkout.command": "soscmd co -Nlock ${filePath}"
}
```

---

## 6. 源码架构

### 6.1 目录结构

```
cliosoft-sos-manager/
├── src/
│   ├── extension.ts           # 总装层：activate、命令注册、事件订阅
│   ├── fileStatusDecorator.ts  # 状态中心：缓存管理、刷新编排、装饰通知
│   ├── fileVersionsTree.ts     # 版本树视图 provider
│   ├── filteredStatusTree.ts   # Changed Files 只读投影视图
│   ├── soscmd.ts               # SOS 适配层：执行命令、解析状态
│   └── utils.ts                # 工具函数：日志、配置读取、平台检查
├── resources/                  # 图标资源
├── out/                        # 编译输出
├── package.json                # 扩展清单
└── tsconfig.json               # TypeScript 配置
```

### 6.2 模块依赖关系

```
extension.ts
  ├──→ fileStatusDecorator.ts  (状态中心)
  ├──→ fileVersionsTree.ts     (版本树)
  ├──→ filteredStatusTree.ts   (变更文件树)
  ├──→ soscmd.ts               (SOS 命令执行)
  └──→ utils.ts                (工具)

fileStatusDecorator.ts
  ├──→ soscmd.ts
  ├──→ filteredStatusTree.ts
  └──→ utils.ts

fileVersionsTree.ts
  ├──→ soscmd.ts
  └──→ utils.ts

filteredStatusTree.ts
  ├──→ soscmd.ts  (仅类型 FileStatus)
  └──→ utils.ts

soscmd.ts
  └──→ utils.ts
```

### 6.3 职责边界

| 模块 | 职责 | 不该做什么 |
|------|------|-----------|
| `extension.ts` | 命令注册、事件订阅、模块 wiring | 不放业务逻辑 |
| `fileStatusDecorator.ts` | statusCache 管理、刷新调度、decoration 通知、磁盘缓存 | 不处理命令 UI |
| `fileVersionsTree.ts` | 版本列表查询与展示 | 不修改状态 |
| `filteredStatusTree.ts` | 从 statusCache 生成裁剪树 | 不触发刷新/扫描 |
| `soscmd.ts` | 执行 soscmd、解析输出、错误翻译 | 不持有缓存/状态 |
| `utils.ts` | 日志、配置读取、平台检查 | 不含业务逻辑 |

---

## 7. 各模块详解

### 7.1 `extension.ts`（1287 行）— 总装层

**activate() 做了什么：**

1. 创建 `FileVersionsTreeDataProvider`，注册到 `cliosoft-sos-manager.fileVersions` 视图
2. 注册所有命令（checkout / checkin / diff / discard / officeOpen / rebuildCtags / toggleRefresh / quick* 系列）
3. 实例化 `FileStatusDecorator`，配置磁盘缓存
4. 初始化：对已打开的文本文档触发状态查询
5. 创建 `FilteredStatusTreeDataProvider`（Changed Files 树），注册到 `cliosoft-sos-manager.filteredStatus` 视图
6. 订阅事件：文档打开、标签页切换、文件保存、工作区变更
7. 设置定时器：周期性刷新活动文件状态

**关键辅助函数：**

| 函数 | 作用 |
|------|------|
| `resolveCommandUris(arg0, arg1)` | 统一处理命令调用来源（Explorer 右键、树视图、快捷键、活动文件），返回 Uri 数组 |
| `getActiveFileUri()` | 解析活动文件 URI：优先 `activeTextEditor`，否则回退到活动标签页（覆盖 Hex Viewer 等非文本编辑器） |
| `revertFileInEditor(filePath)` | 版本切换 / Discard 后重新从磁盘加载文件，消除编辑器 dirty dot |
| `refreshFileStatus(filePaths, decorator)` | 批量清除缓存并触发状态更新 |
| `executeBatchCommand(...)` | 批量执行 SOS 命令，带进度条和取消支持 |

### 7.2 `fileStatusDecorator.ts`（440 行）— 状态中心

`FileStatusDecorator` 是整个扩展的核心类，它：

1. **持有 statusCache**（`Map<filePath, FileStatus>`）— 全局唯一的文件状态真相源
2. **注册 FileDecorationProvider** — 根据 statusCache 为资源管理器中的文件/文件夹渲染 badge
3. **驱动刷新链路**：
   - `updateFileStatus(path)` → 防抖 → `doUpdateFileAndAncestors(path)`
   - → `getFileStatus()` 查单文件
   - → `updateFolderStatus()` 查所在目录
   - → `doInterestingScan()` 全量查 interesting 文件
4. **磁盘缓存**：启动时从 `globalStorage/statusCache.json` 加载，扫描后写入
5. **暂停/恢复**：`toggleRefresh()` 控制是否响应 `updateFileStatus` 调用

**关键属性和方法：**

```
statusCache         Map<string, FileStatus>    文件级状态缓存
folderStatusCache   Map<string, {statusMap, timestamp}>  文件夹级状态缓存（带过期）
fileStatusCache     (getter) 暴露 statusCache 给 FilteredStatusTreeDataProvider
onDidUpdateStatus   Event<void>                状态变化事件，驱动 Changed Files 树 rebuild

updateFileStatus(path)          公开入口，带防抖
performFullWorkspaceScan(root)  全量扫描（由 refresh 按钮触发）
clearFolderCache(folder)        命令执行后清缓存
toggleRefresh()                 暂停/恢复
```

**刷新策略：**

- **单文件快速路径**：`getFileStatus()` 查单个文件，200ms 防抖
- **目录批量**：`getFolderStatus()` 查所在目录所有文件状态，带 `cacheExpiryTime` 秒缓存
- **全量 interesting 扫描**：`getInterestingStatus()` 用 `soscmd status * -sco -suco -sncm -sne -snt` 递归查所有值得关注的文件（检出 / 无锁检出 / 未检出但已改 / 缺失 / 有新版本）
- **精确 decoration 刷新**：`doUpdateFolderStatus` 只 fire 变化文件及其祖先文件夹的 Uri（而非全量 `undefined`）

### 7.3 `fileVersionsTree.ts`（146 行）— 版本树

两个类：

- **`FileVersionItem`** — TreeItem 子类，表示一个文件版本
  - 当前版本显示 ✓ 图标，其他版本显示 ○
  - 点击触发 `switchVersion` 命令

- **`FileVersionsTreeDataProvider`** — TreeDataProvider 实现
  - `setFile(path)` 设置当前文件并刷新
  - `getChildren()` 调用 `getFileVersions()` 获取版本列表

### 7.4 `filteredStatusTree.ts`（258 行）— Changed Files 投影

**设计原则：只读投影，不触发刷新。**

- **`FilteredStatusTreeDataProvider`** 从 `statusCache` 引用中读取数据
- `doRebuild()` 遍历 statusCache，筛选 interesting 文件，构建 `treeIndex`（父→子映射）
- 支持防抖 `rebuild()` 和同步 `rebuildSync()`（后者用于 decoration fire 前确保数据一致）

**interesting 判断条件（`isFileInteresting`）：**

```typescript
status.state === 'O'           // Checked Out
|| status.state === 'W'        // Checked Out Without Lock
|| status.change === 'M'       // Modified
|| status.change === '!'       // Deleted
|| status.newRevision === 'N'  // Has New Revision
```

**辅助方法：**

| 方法 | 用途 |
|------|------|
| `getInterestingFileUris(folder)` | 文件夹节点展开为所有 interesting 文件 Uri |
| `getInterestingFileCount(folder)` | 文件夹 badge 数字来源 |
| `isEmpty()` | 判断是否需要触发首次扫描 |

### 7.5 `soscmd.ts`（646 行）— SOS 适配层

**命令执行：**

`executeSoscmd(commandOrArgs, cwd, showError)` — 双重重载：
- **字符串**参数 → 使用 `exec()`（Shell 展开通配符，如 `soscmd status *`）
- **数组**参数 → 使用 `spawn()`（安全传参，如 `['co', '-Nlock', file]`）
- 60 秒超时，10MB maxBuffer
- 错误时调用 `getUserFriendlyError()` 翻译为可读消息

**状态解析：**

`parseStatusLine(line)` 解析 soscmd status 输出行，格式为：

```
f O M - N -  3  ./path/to/file
│ │ │ │ │ │  │  └─ 文件路径
│ │ │ │ │ │  └─── 版本号
│ │ │ │ │ └───── (reserved)
│ │ │ │ └─────── newRevision: N=有新版本, -=最新
│ │ │ └───────── lock: L=已锁, -=未锁
│ │ └─────────── change: M=已修改, !=已删除, -=未修改
│ └───────────── state: O=检出, W=无锁检出, -=已检入
└─────────────── type: f=文件, d=目录
```

**查询函数：**

| 函数 | soscmd 命令 | 返回 |
|------|-------------|------|
| `getFileStatus(path)` | `soscmd status <filename>` | `FileStatus \| null` |
| `getFolderStatus(folder)` | `soscmd status *` | `Map<path, FileStatus>` |
| `getInterestingStatus(root)` | `soscmd status * -sco -suco -sncm -sne -snt` | `Map<path, FileStatus>` |
| `getFileVersions(path)` | `soscmd history -fs <path>` | `FileVersion[]` |
| `switchFileVersion(path, ver)` | `soscmd discard -F` + `soscmd userev` | `boolean` |

### 7.6 `utils.ts`（138 行）— 工具函数

| 导出 | 说明 |
|------|------|
| `outputChannel` | `ClioSoft SOS` 输出通道实例 |
| `isDebugEnabled()` | 读取 `enableDebugInfo` 配置，带缓存 |
| `logDebug(msg)` | 调试日志（仅 debug 模式下输出） |
| `logError(msg)` | 错误日志（始终输出，可配置自动弹出面板） |
| `getConfig()` | 获取 `cliosoft-sos-manager` 配置节 |
| `isCommandEnabled(name)` | 检查命令是否启用 |
| `getCommandConfig(name)` | 获取自定义命令字符串 |
| `replaceCommandVariables(cmd, vars)` | 替换 `${filePath}` 等变量 |
| `isPlatformSupported()` | 检查是否 Linux |
| `showPlatformWarning()` | 显示平台警告 |
| `BATCH_SIZE` | 批量处理大小常量（50） |
| `showSosError(msg)` | 显示错误消息并附带 "Show Output" 按钮 |

---

## 8. 数据流与刷新机制

### 8.1 状态数据流

```
┌──────────────────────────────────────────────────────────┐
│                      soscmd (CLI)                        │
│  getFileStatus()  getFolderStatus()  getInterestingStatus│
└──────────┬──────────────┬──────────────────┬─────────────┘
           │              │                  │
           ▼              ▼                  ▼
┌──────────────────────────────────────────────────────────┐
│              FileStatusDecorator                         │
│  statusCache: Map<filePath, FileStatus>                  │
│  folderStatusCache: Map<folder, {statusMap, timestamp}>  │
│                                                          │
│  decorationChangeEmitter ──→ FileDecorationProvider      │
│  _onDidUpdateStatus      ──→ FilteredStatusTree.rebuild()│
└──────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
   Explorer Badges              Changed Files Tree
   (CO/M/D/N!/CI)              (层级文件夹视图)
```

### 8.2 触发刷新的事件

| 事件 | 触发动作 |
|------|----------|
| 打开文件 (`onDidOpenTextDocument`) | `updateFileStatus(path)` |
| 切换标签页 (`onDidChangeActiveTextEditor` / `onDidChangeTabs`) | `updateFileStatus(path)` + `setFile(path)` |
| 保存文件 (`onDidSaveTextDocument`) | `clearFolderCache` + `updateFileStatus(path)` |
| 定时器 (`statusRefreshInterval` 秒) | `updateFileStatus(activePath)` |
| 命令执行后 (`checkout`/`checkin`/`discard`) | `refreshFileStatus(paths)` |
| 手动刷新按钮 | `performFullWorkspaceScan(root)` |
| Changed Files 面板首次可见 | `performFullWorkspaceScan(root)`（无磁盘缓存时） |

### 8.3 防抖与去重

- `updateFileStatus` 按文件夹粒度防抖 200ms
- `doInterestingScan` 用 `pendingInterestingScan` Promise 去重（多个文件触发只跑一次）
- `updateFolderStatus` 用 `pendingFolderUpdates` Map 去重
- `filteredTreeProvider.rebuild()` 自带 100ms 防抖

### 8.4 缓存层次

| 缓存 | 粒度 | 过期策略 |
|------|------|----------|
| `statusCache` | 单文件 | 不自动过期，由查询结果覆盖 |
| `folderStatusCache` | 文件夹 | `cacheExpiryTime` 秒过期（默认 180s） |
| 磁盘缓存 | 全局 | 24 小时过期 |

---

## 9. 构建与打包

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式开发
npm run watch

# 打包 VSIX
npx @vscode/vsce package

# 输出: cliosoft-sos-manager-0.2.0.vsix
```

### 依赖

仅开发依赖，无运行时 npm 依赖：

| 包 | 版本 | 用途 |
|----|------|------|
| `@types/vscode` | ^1.85.0 | VS Code API 类型 |
| `@types/node` | ^18.11.18 | Node.js 类型 |
| `typescript` | ^5.3.3 | TypeScript 编译器 |
| `vscode-test` | ^0.4.3 | 测试运行器 |

---

## 10. 常见问题

### Q: 非 Linux 系统能用吗？

扩展可以安装和加载，但所有 SOS 命令会被禁用并弹出警告。状态装饰和视图需要 `soscmd` 才能工作。

### Q: 文件状态不刷新？

1. 检查状态栏是否显示 `SOS: Paused`，如果是则点击恢复
2. 打开 Command Palette → `ClioSoft SOS: Refresh Changed Files` 手动刷新
3. 启用 `enableDebugInfo` 查看 Output Channel 中的日志

### Q: 版本切换后编辑器显示"未保存"？

正常情况下扩展会自动 revert 编辑器内容。如果仍有 dirty dot，手动执行 `File: Revert File` 命令。

### Q: 如何自定义命令？

在 Settings 中设置 `cliosoft-sos-manager.commands.<命令名>.command`，使用 `${filePath}` 变量占位。例如：

```json
{
  "cliosoft-sos-manager.commands.diff.command": "soscmd diff -gui ${filePath}"
}
```

### Q: 批量操作时卡住？

每批 50 个文件，SOS 服务器处理需要时间。可以通过进度条上的取消按钮中止，已成功的部分不会回滚。

### Q: 磁盘缓存在哪里？

位于 VS Code 的 `globalStorage` 路径下：
```
~/.vscode/globalStorage/xhopo.cliosoft-sos-manager/statusCache.json
```
设置 `enableDiskCache: false` 可禁用。

### Q: 文件显示 M（已修改），但 Discard 无效 / 提示未 checkout？

该文件属于 SOS `-sncm`（not checked out but modified）状态，例如状态行 `f-M---`：文件**未检出**（state `-`），但本地内容与服务器版本不同（change `M`）。大文件常见原因：最后一次 SOS 同步后被流程/工具重新生成过。

这类文件 `soscmd discard` 找不到 checkout lock、无对象可撤，因此无法还原，也不应报成功。正确恢复是 **Selective Update 一致性检查**：

```bash
soscmd updatesel -ccw <file>
```

`-ccw` 会检查工作区一致性，把被改的本地文件备份为 `<file>.SVM`，并将工作区副本恢复到受管版本（状态行恢复为 `f-----`）。

扩展在 v0.48 起已处理：对这类文件执行 Discard 时，会提示并引导改为 Update（内部执行上面的 `soscmd updatesel -ccw`），不再执行无用的 discard 或误报成功。

### Q: 快捷键在 Hex Viewer / 非文本编辑器里失效？

v0.48 起快捷键不再要求 `editorTextFocus`，且活动文件解析会回退到当前活动标签页（`getActiveFileUri`），因此 Quick Check Out / Check In / Discard 在非文本编辑器中也生效。注意文件必须通过标签页打开、且属于 `file` scheme。
