# Golden Gate · 地标之间

精细金门大桥 3D 海湾场景，以 Three.js 程序化建模。

直接双击 **index.html** 即可在浏览器中运行。HTML 内含全部代码、图标和样式，不需要联网、构建或下载模型。需要支持 WebGL 2 的现代浏览器。

- 桥塔、主缆、双吊索、夹具、铆钉、桥底桁架、六车道与动态车辆
- 程序化海面、海岸山体、树木、船只、海鸟与远处城市
- 晴日、日落、夜景，海雾浓度调整
- 经典全景、桥塔细节、海湾俯瞰，支持鼠标和触控交互
- 自动环绕、键盘操作、全屏与高清 PNG 导出
- 手机布局、系统深色偏好、减少动态效果偏好

模型为艺术化建筑研究，局部比例、地形和城市经过调整。

## 开发

```sh
npm install
npm run build
npm run dev
```

访问 `http://127.0.0.1:5173`。修改 `src/scene.js`、`src/styles.css` 或 `src/page.html` 后，运行 `npm run build` 重新生成独立 HTML。

## 浏览器检查

```sh
npm test
```

使用本机 Google Chrome；可通过 `CHROME_PATH` 指定浏览器路径。检查离线打开、场景渲染、光照、雾气、视角、缩放、环绕、触控、弹窗与图片导出。截图和导出结果保存在 `test-results/`。

桥梁数据参考：[Golden Gate Bridge 官方历史资料](https://www.goldengate.org/bridge/history-research/)。Three.js 和 Phosphor Icons 的 MIT 许可证已包含在导出 HTML 中。
