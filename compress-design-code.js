const fs = require('fs');
const path = require('path');

// 设计代码文件路径
const designFiles = [
    './src/soscmd.ts',
    './src/extension.ts',
    './src/utils.ts'
];

// 输出文件路径
const outputFile = './out2ai.txt';

// 移除单行注释和多行注释的函数
function removeComments(code) {
    // 移除多行注释
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    // 移除单行注释（不在字符串内的）
    code = code.replace(/([^"\\']|^)\/\/.*$/gm, '$1');
    return code;
}

// 压缩代码的函数
function compressCode(code) {
    // 移除多余的空白字符
    code = code.replace(/\s+/g, ' ');
    // 移除行尾的分号前的空格
    code = code.replace(/\s*;\s*/g, ';');
    // 移除花括号周围的空格
    code = code.replace(/\s*{\s*/g, '{');
    code = code.replace(/\s*}\s*/g, '}');
    // 移除括号周围的空格
    code = code.replace(/\s*\(\s*/g, '(');
    code = code.replace(/\s*\)\s*/g, ')');
    // 移除逗号后的空格
    code = code.replace(/,\s*/g, ',');
    // 移除冒号周围的空格
    code = code.replace(/\s*:\s*/g, ':');
    // 移除多余的分号
    code = code.replace(/;+/g, ';');
    // 移除开头和结尾的空白
    code = code.trim();
    return code;
}

// 读取并处理所有设计代码文件
function processDesignFiles() {
    let allCode = '';
    
    designFiles.forEach(filePath => {
        try {
            const fullPath = path.resolve(__dirname, filePath);
            if (fs.existsSync(fullPath)) {
                console.log(`Processing file: ${filePath}`);
                let code = fs.readFileSync(fullPath, 'utf8');
                code = removeComments(code);
                code = compressCode(code);
                allCode += code + '\n';
            } else {
                console.log(`File not found: ${filePath}`);
            }
        } catch (error) {
            console.error(`Error processing file ${filePath}:`, error);
        }
    });
    
    return allCode;
}

// 主函数
function main() {
    console.log('Processing design code files...');
    const processedCode = processDesignFiles();
    
    try {
        fs.writeFileSync(outputFile, processedCode, 'utf8');
        console.log(`Successfully wrote compressed code to ${outputFile}`);
        console.log(`File size: ${processedCode.length} characters`);
    } catch (error) {
        console.error(`Error writing to output file:`, error);
    }
}

// 执行主函数
main();