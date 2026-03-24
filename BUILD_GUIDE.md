# 打包指南 - ClioSoft SOS Manager v0.2.0

## 📦 打包步骤

### 前置要求

确保已安装：
- ✅ Node.js (v14+)
- ✅ npm 或 yarn
- ✅ TypeScript
- ✅ vsce (VSCode Extension Manager)

### 步骤 1: 安装 vsce

如果还没有安装 vsce，在命令行中运行：

```bash
npm install -g @vscode/vsce
```

或者使用 yarn：

```bash
yarn global add @vscode/vsce
```

### 步骤 2: 安装项目依赖

在项目根目录运行：

```bash
cd "D:\分支项目\cliosoft-sos-manager"
npm install
```

### 步骤 3: 编译 TypeScript

编译 TypeScript 代码到 JavaScript：

```bash
npm run compile
```

或者直接运行：

```bash
tsc -p ./
```

**预期结果**：
- 在 `out/` 目录下生成编译后的 JavaScript 文件
- `out/extension.js`
- `out/soscmd.js`
- `out/utils.js`

### 步骤 4: 验证编译结果

检查 `out/` 目录：

```bash
dir out
```

应该看到：
```
extension.js
extension.js.map
soscmd.js
soscmd.js.map
utils.js
utils.js.map
```

### 步骤 5: 打包 VSIX

运行打包命令：

```bash
vsce package
```

**预期结果**：
- 生成 `cliosoft-sos-manager-0.2.0.vsix` 文件
- 文件大小约 50-100 KB（不包含 node_modules）

### 步骤 6: 验证 VSIX 文件

检查生成的文件：

```bash
dir *.vsix
```

应该看到：
```
cliosoft-sos-manager-0.2.0.vsix
```

---

## 🔍 常见问题

### 问题 1: vsce 未找到

**错误**：
```
'vsce' is not recognized as an internal or external command
```

**解决方案**：
```bash
# 全局安装 vsce
npm install -g @vscode/vsce

# 或使用 npx 运行
npx @vscode/vsce package
```

### 问题 2: TypeScript 编译错误

**错误**：
```
error TS2307: Cannot find module 'vscode'
```

**解决方案**：
```bash
# 重新安装依赖
npm install

# 清理并重新编译
rm -rf out node_modules
npm install
npm run compile
```

### 问题 3: 缺少文件

**错误**：
```
ERROR  Missing publisher name
```

**解决方案**：
- 检查 `package.json` 中的 `publisher` 字段
- 当前已设置为 `"publisher": "xhopo"`

### 问题 4: 图标文件缺失

**错误**：
```
ERROR  Icon not found: resources/cliosoft-icon.png
```

**解决方案**：
- 确保 `resources/cliosoft-icon.png` 文件存在
- 或在 `package.json` 中移除 `icon` 字段

### 问题 5: 打包文件过大

**警告**：
```
WARNING  This extension consists of XXX files, out of which XXX are JavaScript files
```

**解决方案**：
- 创建 `.vscodeignore` 文件排除不必要的文件
- 参考下面的 `.vscodeignore` 配置

---

## 📝 .vscodeignore 配置

创建或更新 `.vscodeignore` 文件：

```
.vscode/**
.vscode-test/**
src/**
.gitignore
.yarnrc
vsc-extension-quickstart.md
**/tsconfig.json
**/.eslintrc.json
**/*.map
**/*.ts
node_modules/**
!node_modules/es6-promise/**
!node_modules/es6-promisify/**
*.vsix
.git/**
.github/**
*.md
!README.md
!CHANGELOG.md
FIXES_SUMMARY.md
QUICK_FIX_GUIDE.md
TESTING_CHECKLIST.md
MIGRATION_GUIDE.md
CODE_REVIEW.md
RELEASE_NOTES.md
COMPLETION_SUMMARY.md
SUMMARY.md
BUILD_GUIDE.md
compress-design-code.js
```

---

## 🚀 快速打包命令

### Windows PowerShell

```powershell
# 一键打包脚本
cd "D:\分支项目\cliosoft-sos-manager"
npm install
npm run compile
npx @vscode/vsce package
```

### Windows CMD

```cmd
cd /d "D:\分支项目\cliosoft-sos-manager"
npm install
npm run compile
npx @vscode/vsce package
```

### Git Bash

```bash
cd "/d/分支项目/cliosoft-sos-manager"
npm install
npm run compile
npx vsce package
```

---

## 📦 打包选项

### 基本打包

```bash
vsce package
```

### 指定版本

```bash
vsce package --version 0.2.0
```

### 预发布版本

```bash
vsce package --pre-release
```

### 不包含 yarn.lock

```bash
vsce package --no-yarn
```

### 详细输出

```bash
vsce package --verbose
```

---

## ✅ 验证打包结果

### 1. 检查文件大小

```bash
# Windows
dir cliosoft-sos-manager-0.2.0.vsix

# Linux/Mac
ls -lh cliosoft-sos-manager-0.2.0.vsix
```

**预期大小**：50-100 KB

### 2. 查看包内容

```bash
# 解压查看（可选）
unzip -l cliosoft-sos-manager-0.2.0.vsix
```

### 3. 测试安装

```bash
code --install-extension cliosoft-sos-manager-0.2.0.vsix
```

### 4. 验证功能

1. 重启 VSCode
2. 打开一个 SOS 管理的项目
3. 测试基本功能：
   - 文件状态装饰
   - 版本面板
   - 右键菜单命令
   - 状态栏按钮

---

## 🔧 高级选项

### 使用 npm scripts

在 `package.json` 中添加：

```json
{
  "scripts": {
    "package": "vsce package",
    "package:pre": "vsce package --pre-release"
  }
}
```

然后运行：

```bash
npm run package
```

### 自动化打包脚本

创建 `build.bat`（Windows）：

```batch
@echo off
echo Building ClioSoft SOS Manager v0.2.0...
echo.

echo Step 1: Installing dependencies...
call npm install
if errorlevel 1 goto error

echo Step 2: Compiling TypeScript...
call npm run compile
if errorlevel 1 goto error

echo Step 3: Packaging VSIX...
call npx @vscode/vsce package
if errorlevel 1 goto error

echo.
echo ✅ Build completed successfully!
echo VSIX file: cliosoft-sos-manager-0.2.0.vsix
goto end

:error
echo.
echo ❌ Build failed!
exit /b 1

:end
```

运行：

```bash
build.bat
```

---

## 📊 打包检查清单

打包前检查：

- [ ] 所有 TypeScript 文件已修复
- [ ] `package.json` 版本号正确（0.2.0）
- [ ] README.md 已更新
- [ ] CHANGELOG.md 已更新
- [ ] 图标文件存在（resources/cliosoft-icon.png）
- [ ] `.vscodeignore` 配置正确
- [ ] 依赖已安装（npm install）

打包后检查：

- [ ] VSIX 文件已生成
- [ ] 文件大小合理（50-100 KB）
- [ ] 测试安装成功
- [ ] 基本功能正常
- [ ] 无控制台错误

---

## 🎯 发布准备

### 1. 本地测试

```bash
# 安装测试
code --install-extension cliosoft-sos-manager-0.2.0.vsix

# 卸载
code --uninstall-extension xhopo.cliosoft-sos-manager
```

### 2. 创建 GitHub Release

1. 在 GitHub 上创建新 Release
2. 标签：`v0.2.0`
3. 标题：`ClioSoft SOS Manager v0.2.0`
4. 描述：复制 RELEASE_NOTES.md 内容
5. 上传 VSIX 文件

### 3. 发布到 VSCode Marketplace（可选）

```bash
# 需要先创建 Personal Access Token
vsce publish
```

---

## 📞 获取帮助

如果遇到问题：

1. **检查日志**：
   ```bash
   vsce package --verbose
   ```

2. **清理重建**：
   ```bash
   rm -rf out node_modules
   npm install
   npm run compile
   vsce package
   ```

3. **查看文档**：
   - [vsce 官方文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
   - [VSCode 扩展开发指南](https://code.visualstudio.com/api)

4. **报告问题**：
   - GitHub Issues
   - 包含完整的错误日志

---

## 🎉 完成！

成功打包后，你将得到：

- ✅ `cliosoft-sos-manager-0.2.0.vsix` 文件
- ✅ 可以安装和分发的扩展包
- ✅ 准备发布的版本

**下一步**：
1. 测试 VSIX 文件
2. 创建 GitHub Release
3. 分发给用户

---

**最后更新**: 2026-03-23
**版本**: 0.2.0
**状态**: 准备打包
