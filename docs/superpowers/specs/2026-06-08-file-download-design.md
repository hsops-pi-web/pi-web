# 文件下载功能设计

日期: 2026-06-08
分支: `feat/file-download`（用户验证通过后合并回 `main`，先重新 build，再用 systemd 重启服务）

## 背景

Agent 经常会在当前会话 cwd 下生成或修改文档、图片、音频等文件。当前 Web 端可以通过文件树查看部分文件，但没有统一的一键下载入口。过去临时方案是让 agent 启动一个简单 HTTP 服务供浏览器下载，这会引入额外端口、权限边界不一致和用户操作复杂度。

## 目标

- Web 内置下载能力，不再依赖 agent 另起 HTTP 服务
- 文件查看页提供下载按钮
- 聊天消息中的 cwd 相对文件路径可点击下载
- 复用现有 `/api/files` allowed roots 安全边界

## 非目标

- 不实现目录打包下载
- 不实现跨会话 cwd 以外文件下载
- 不实现复杂文件管理（重命名、删除、移动）
- 不改变现有预览逻辑

## 核心决策

| 决策点 | 选择 |
|--------|------|
| 下载端点 | 复用 `GET /api/files/[...path]?type=download` |
| 权限 | 复用现有 allowed roots 校验 |
| 响应头 | `Content-Disposition: attachment` |
| 文件查看器 | 顶部工具条新增下载按钮 |
| 聊天路径 | 将 cwd 相对路径渲染为下载 chip/link |
| 绝对路径 | 不在聊天中自动下载，避免误暴露 |

## 数据流

```
FileExplorer/FileViewer: fullPath -> encodeFilePathForApi -> /api/files/<path>?type=download -> browser save
Chat message: relative path text -> cwd + relative path -> HEAD/GET metadata check -> download link
```

## API 设计

`GET /api/files/[...path]?type=download`

行为:
1. 路径解析沿用现有 route
2. allowed roots 校验沿用现有 route
3. 要求目标是普通文件
4. 以 stream 返回完整文件
5. 设置下载响应头

响应头:
```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="<basename>"
Content-Length: <size>
Cache-Control: no-cache
Accept-Ranges: bytes
```

## 前端设计

### FileViewer 下载按钮

文本、图片、音频三个 viewer 顶部工具条统一提供下载按钮。按钮直接打开下载 URL，不影响预览和 SSE watch。

### 聊天路径下载链接

`MessageView` 在渲染文本时识别常见文件路径：
- `uploads/report.pdf`
- `output/result.xlsx`
- `docs/foo.md`
- `images/chart.png`

只对相对路径生效，并根据当前会话 cwd 生成绝对路径后下载。识别失败或文件不存在时，普通文本仍照常显示。

## 安全边界

- 下载 route 仍必须通过 `isPathAllowed`
- 聊天路径只接受相对路径，不接受 `/abs/path`、`~/path`、`http://...`、`../secret`
- URL 编码沿用 `encodeFilePathForApi`

## 测试

- curl 下载文本文件返回 200 且带 `Content-Disposition: attachment`
- curl 下载不存在文件返回 404
- curl 下载 cwd 外文件返回 403
- 文件查看器按钮可下载当前文件
- 聊天消息中的 `uploads/foo.md` 渲染为下载入口并可下载

## 发布流程

1. 从 `main` 新建 `feat/file-download`
2. 开发并提交
3. 启动 dev 服务给用户验证
4. 用户验证 OK 后合并回 `main`
5. 运行 `npm run build` 重新生成 `.next/` 生产构建
6. 用 `systemctl --user restart pi-web.service` 重启正式服务

说明：正式服务通过 `next start` 运行 `.next/` 产物；只合并源码并重启 systemd 不会自动编译新功能。
