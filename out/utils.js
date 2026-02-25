"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.outputChannel = exports.DEBUG_INFO_CONFIG_KEY = void 0;
exports.isDebugEnabled = isDebugEnabled;
exports.logDebug = logDebug;
exports.logError = logError;
exports.getSelectedFilePath = getSelectedFilePath;
const vscode = __importStar(require("vscode"));
// 调试信息配置键
exports.DEBUG_INFO_CONFIG_KEY = 'cliosoft-sos-manager.enableDebugInfo';
// 创建输出通道
exports.outputChannel = vscode.window.createOutputChannel('ClioSoft SOS');
// 获取调试开关状态
function isDebugEnabled() {
    return vscode.workspace.getConfiguration().get(exports.DEBUG_INFO_CONFIG_KEY, false);
}
// 调试日志函数
function logDebug(message, ...args) {
    if (isDebugEnabled()) {
        const line = `[DEBUG ${new Date().toLocaleTimeString()}] ${message}`;
        console.log(line, ...args);
        exports.outputChannel.appendLine(line + (args.length ? ' ' + JSON.stringify(args) : ''));
    }
}
// 错误日志函数
function logError(message, error) {
    const line = `[ERROR ${new Date().toLocaleTimeString()}] ${message}`;
    console.error(line, error);
    exports.outputChannel.appendLine(line + (error ? ' ' + error : ''));
}
// 获取当前选中的文件路径
function getSelectedFilePath(context) {
    if (context && context.fsPath) {
        return context.fsPath;
    }
    // 如果没有上下文，尝试获取当前活动编辑器的文件
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.uri.fsPath;
    }
    return null;
}
//# sourceMappingURL=utils.js.map