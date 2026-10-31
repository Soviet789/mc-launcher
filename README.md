# MC Launcher

跨平台 Minecraft 启动器（**Windows** / **Ubuntu），基于 Electron + Vue 3 构建。

![icon](build/icon.png)

## 功能特性

- **版本管理**：获取官方版本列表（正式版 / 快照 / 旧版），一键下载客户端、依赖库、原生库、游戏资源，支持 SHA-1 完整性校验与一键修复
- **模组加载器**：内置 Fabric / Quilt 安装器（Forge / NeoForge 计划中）
- **版本隔离**：每个实例拥有独立的存档 / 模组 / 配置目录，互不干扰；也可关闭隔离共享 `.minecraft`
- **账户登录**：Microsoft 正版登录（OAuth 2.0 + PKCE，Xbox Live → Minecraft Services 全链路）与离线登录（玩家名长度、格式均不限），令牌本机加密存储，过期自动刷新
- **资源下载**：接入 Modrinth，搜索 / 下载模组、资源包、光影；支持 **Fabric/Quilt 整合包（.mrpack）** 一键安装（自动建实例、装版本、装加载器、拉取模组、应用 overrides）
- **下载管理**：独立「下载」页集中展示进行中的安装 / 下载任务（实时进度、阶段、文件计数、可随时取消），历史记录保留结果 / 耗时 / 报错并**跨重启保留**
- **启动核心**：自动检测本机 Java（Windows / Linux 多路径扫描 + 启动器托管目录复用），缺失时自动下载对应大版本（Adoptium Temurin 官方源，按下载源偏好回退 Azul Zulu、Amazon Corretto 直连源，支持断点续传）；规则引擎解析平台/特性参数、原生库解压（零依赖 zip 实现）、class-path 组装、游戏日志实时流式展示
- **网络加速**：可切换 BMCLAPI 国内镜像（版本列表 / 客户端 / 依赖库），镜像失败自动回退官方源
- **启动器设置**：内存分配、JVM 参数、窗口分辨率、下载并发、Java 路径、下载源等，实例级可覆盖

## 环境要求

- Node.js ≥ 20（推荐 22）、npm
- Windows 10+ / Ubuntu 22.04+（或其他发行版，需自带 `tar`）

## 快速开始（开发模式）

```bash
npm install        # 安装依赖（.npmrc 已配置 electron 国内镜像）
npm run dev        # 启动 Vite + Electron
```

其他脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run build:renderer` | 仅构建前端静态资源到 `dist/` |
| `npm start` | 构建前端后以生产模式启动 Electron |
| `npm run build` | 完整打包（当前平台） |
| `npm run build:win` | 打包 Windows NSIS 安装包（需在 Windows 上执行，或本机装有 wine） |
| `npm run build:linux` | 打包 Ubuntu 的 AppImage + deb |
| `sudo scripts/linux-install.sh` | 安装 / 升级 Ubuntu deb（自动修复 Electron 沙箱：目录空格 + setuid） |
| `node scripts/selftest.mjs` | 核心逻辑自测（规则引擎 / 版本合并 / zip 解压 / 断点续传等） |
| `npm run ui-check` | 界面截图自检（输出 /tmp/mcl-ui*.png） |
| `npm run e2e` | 端到端集成测试：真实安装版本并启动游戏（可用 `--version x.y.z` 指定版本） |
| `node scripts/gen-icon.mjs` | 重新生成应用图标 |

打包产物输出到 `release/`。

## 打包发布

### Windows

在 Windows 机器上：

```bash
npm install
npm run build:win
# → release/MC Launcher-0.1.0-setup-x64.exe（自定义目录安装、创建桌面/开始菜单快捷方式）
```

### Ubuntu

```bash
npm install
npm run build:linux
# → release/mc-launcher-0.1.0-linux-x86_64.AppImage
# → release/mc-launcher-0.1.0-linux-amd64.deb

# deb 安装 / 升级（推荐，一条命令并自动修复 Electron 沙箱）：
sudo scripts/linux-install.sh
# 脚本动作：dpkg 安装 → /opt 安装目录去空格 → 菜单项同步 →
#          chmod 4755 chrome-sandbox → 修正 update-alternatives 入口

# AppImage 运行（需 FUSE）
chmod +x release/mc-launcher-0.1.0-linux-x86_64.AppImage
./release/mc-launcher-0.1.0-linux-x86_64.AppImage
```

AppImage 若提示缺少 FUSE：

```bash
sudo apt install libfuse2t64     # Ubuntu 24.04+；更老版本包名为 libfuse2
# 或免 FUSE 解压运行：
release/mc-launcher-0.1.0-linux-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

> **Ubuntu 24.04 沙箱说明**：GNOME 菜单启动依赖 setuid 沙箱（`chrome-sandbox` 属主 root、
> 权限 4755），且安装路径不能含空格——`scripts/linux-install.sh` 已自动处理这两点。
> AppImage 经 FUSE 挂载后强制 nosuid，叠加 24.04 默认的
> `kernel.apparmor_restrict_unprivileged_userns=1` 时双击会因沙箱中止：
> 本机建议用 deb 版，或临时 `./xxx.AppImage --no-sandbox` 运行。

> Linux 下若提示缺少系统库（`libnss3`、`libgtk-3-0` 等）：`sudo apt install libnss3 libgtk-3-0 libatk-bridge2.0-0 libasound2`

## 配置微软正版登录

微软要求 OAuth 应用使用自己注册的 Client ID（免费、约 2 分钟）：

1. 打开 [Azure 门户 → 新增注册](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)：
   - **名称**：随意，如 `My MC Launcher`
   - **支持的账户类型**：选择 **任何 Microsoft 账户（个人 Microsoft 账户也适用）** 或“仅个人 Microsoft 账户”
2. 注册完成后进入 **身份验证 → 添加平台 → 移动应用和桌面应用程序**，添加重定向 URI：
   ```
   http://localhost
   ```
   （启动器使用本地随机端口回环回调，`http://localhost` 前缀即可覆盖任意端口）
3. 复制 **应用程序（客户端）ID**，粘贴到启动器「设置 → 微软登录 → Azure 应用 Client ID」
4. 到「账户」页点击「使用 Microsoft 账户登录」

> 该应用无需密钥（Public Client + PKCE），令牌只保存在你本机（系统密钥环可用时会加密存储）。

## 目录结构

```
├── electron/                 # 主进程（纯 Node，无三方运行时依赖）
│   ├── main.js               # 窗口 / 生命周期 / 事件转发
│   ├── preload.js            # contextBridge 安全暴露 API
│   ├── ipc.js                # IPC 处理器
│   ├── core/
│   │   ├── manifest.js       # 版本列表、继承合并（Fabric/Quilt）
│   │   ├── install.js        # 客户端/依赖库/资源/日志配置下载
│   │   ├── rules.js          # 平台与特性规则引擎
│   │   ├── java.js           # Java 检测 + 多厂商（Temurin/Zulu/Corretto）自动下载
│   │   ├── launch.js         # 参数构建、原生解压、进程与日志管理
│   │   ├── accounts.js       # 账户存储（离线 UUID、加密落盘）
│   │   ├── microsoft.js      # MS OAuth → Xbox Live → Minecraft
│   │   ├── instances.js      # 实例（版本隔离）
│   │   ├── loader.js         # Fabric / Quilt 安装
│   │   ├── modrinth.js       # Modrinth 搜索与 mrpack 整合包安装
│   │   ├── mirror.js         # 官方 / BMCLAPI 镜像映射
│   │   ├── jobs.js           # 长任务进度与取消
│   │   └── settings.js       # 设置存储
│   └── util/                 # fs / net（带重试校验的下载）/ zip 解析
├── src/                      # 渲染进程（Vue 3 + Pinia + Vue Router）
│   ├── views/                # 启动 / 版本 / 资源下载 / 账户 / 设置
│   ├── stores/               # 状态仓库
│   └── components/           # 侧边栏 / Toast / 任务浮窗
├── scripts/                  # dev 启动器、自测、图标生成
├── dist/                     # 前端构建产物（打包时嵌入）
└── release/                  # 打包产物
```

## 数据存放位置

| 数据 | Windows | Ubuntu |
| --- | --- | --- |
| 游戏本体（版本/依赖库/资源） | `%APPDATA%\.minecraft` | `~/.minecraft` |
| 启动器数据（设置/账户/实例/日志） | `%APPDATA%\MC Launcher` | `~/.config/MC Launcher` |
| 实例（隔离存档/模组） | `…\MC Launcher\instances\<实例名>` | `~/.config/MC Launcher/instances/<实例名>` |

## 常见问题

- **启动时提示下载 Java**：启动器会按版本要求自动下载 JRE（Adoptium Temurin 官方源，按下载源偏好依次回退 Azul Zulu、Amazon Corretto 直连源，支持断点续传，存放于启动器数据目录），也可在「设置」手动指定本机 Java。
- **BMCLAPI 镜像失效**：启动器会在镜像失败时自动回退官方源；assets 资源始终走官方源（国内可直连）。
- **整合包安装报「基于 Forge/NeoForge」**：当前版本仅支持 Fabric / Quilt 整合包，Forge 支持在计划中。
- **离线模式能联机吗**：可以进行局域网联机 / 部分离线服务器；正版账户可加入正版服务器。
- **多开**：单实例锁会阻止重复启动启动器；游戏本身允许多实例并行（不同实例目录）。

## 免责声明

- Minecraft 是 Mojang Studios / Microsoft 的商标，本项目为第三方开源工具，与 Mojang、Microsoft 无关联。
- 请遵守 [Minecraft EULA](https://www.minecraft.net/eula) 与所在地区法律法规，仅将本工具用于你拥有的正版游戏副本。
- 微软登录的 Client ID 由使用者自行注册，令牌仅存于本地。

## License

MIT
