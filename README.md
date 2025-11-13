---

[English Version](#english-content) | [中文版本](#中文版本)

---


## English Content
# Super NOF1.ai - AI-driven cryptocurrency trading system

Inspired by Alpha Arena and the open-nof1.ai project, this project comprehensively improves upon open-nof1.ai (prompt, data acquisition, added feedback logic, optimized UI and icon display). It's an AI-based automated cryptocurrency futures trading system built using Next.js, integrating the Binance Futures API and the DeepSeek AI model. We will be making further improvements to the algorithm, prompt, model, analysis methods, and trading logic. Stay tuned!

## renew
- Fixed the issue of insufficient decimal precision in the trade function not displaying in the front end, and added content.
- Fixed the issue of the front-end chat outputting five messages at once; now it only outputs one message, saving space.
Operating Instructions:

Copy the five files "lib\ai\run.ts", "prisma\schma.prisma", "component\models_view.tsx", "app/api/cron/3-minutes-run-interval/route.ts", and "cron.ts" to your local machine, overwriting the original files.
- Update the database by executing the command line:
```
npx prisma db push
npx prisma generate
```
Then run `npm run dev` to use it.
## pipeline
Trading logic: Real-time market data is retrieved from the official API. The DeepSeek LLMs API is called every three minutes. The large model receives a carefully prepared input prompt, provides an analyzed strategy, and then the exchange API is called to execute the trades.

## Core Features

### AI Trading Decisions
- **Multi-model support:** Integration with DeepSeek Chat models for market analysis
- **Technical Indicator Analysis**: Multi-dimensional analysis including RSI, MACD, EMA, and trading volume.
- **Risk Management**: Automatic stop-loss and take-profit orders, dynamic leverage adjustment
- **Learning Feedback:** Summarize experiences from historical trades and continuously optimize strategies.

### Trading Function
- **Automated Trading**: Supports simultaneous trading of multiple currencies (BTC, ETH, SOL, BNB, DOGE)
- **Stop-Loss and Take-Profit Orders:** Automatically sets and manages stop-loss and take-profit orders.
- **Position Management**: Real-time monitoring of position status and profit/loss.
- **Risk Control**: Multi-layered Risk Protection Mechanism

### Data Visualization
- **Real-time Charts:** Key indicators such as account balance and yield.
- **Trading History**: Complete trading records and AI decision logs
- **Performance Analysis**: Statistics such as win rate, average profit/loss, and maximum drawdown.

### Security Features
- **Demo Trading**: Supports virtual trading platform testing (demo-fapi.binance.com)
- **Live Trading Mode:** Allows switching to real trading.
- **API Key Encryption**: Sensitive Information Environment Variable Management
- **Proxy Support:** Supports accessing the Binance API via a proxy.

---

## System Requirements

Before you begin, please ensure your system meets the following requirements:

### Required Software
- Node.js version 18.0 or later
- npm or yarn package manager
- PostgreSQL version 14.0 or later
- **Git** (used for cloning projects)

### Optional Software
- **Proxy tools** (such as Clash, V2Ray) are used to access the Binance API.
- VSCode or other code editors

### Account Requirements
- **Binance Account:** Requires registration and API key creation.
- **DeepSeek API Key**: Used for AI functions (optional, can also be used with OpenRouter)

---

## Complete Installation Guide

Step 1: Install Node.js

Windows users:
1. Visit the [Node.js official website](https://nodejs.org/)
2. Download the LTS version (18.x or higher recommended).
3. Run the installer and install using the default options.
4. Open a command prompt to verify the installation:
bash
node --version
npm --version
```

#### macOS users:
Install using Homebrew:
bash
brew install node@18
```

#### Linux users:
bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Installation
node --version
npm --version
```

Step 2: Install the PostgreSQL database

Windows users:

1. **Download the installation package**
- Visit the [PostgreSQL official website](https://www.postgresql.org/download/windows/)
- Download the latest version of the installer (14.x or later).

2. **Run the installer**
- Double-click the installation file
- Choose the installation path (the default is fine).
- Set the superuser (postgres) password** (Please remember this password!)**
- The port number uses the default 5432.
- Select the default language environment

3. **Verify Installation**
bash
# Open command prompt
psql --version
```

4. **Configure environment variables** (if the psql command is unavailable)
Right-click "This PC" → Properties → Advanced system settings → Environment Variables
- Add the following to the system variable Path: `C:\Program Files\PostgreSQL\14\bin`

#### macOS users:

1. **Install using Homebrew**
bash
brew install postgresql@14
brew services start postgresql@14
```

2. **Verify Installation**
bash
psql --version
```

#### Linux users:

bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify Installation
psql --version
```

Step 3: Create the database

1. **Connect to PostgreSQL**

**Windows:**
bash
# Open a command prompt and type:
psql -U postgres
# Enter the password you set during installation
```

**macOS/Linux:**
bash
sudo -u postgres psql
```

2. **Create database and users**
SQL
-- Create database
CREATE DATABASE nof1;

-- Create a user (optional, recommended)
CREATE USER trading_user WITH PASSWORD 'your_secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE trading_db TO trading_user;

-- Exit psql
\q
```

3. **Record database connection information**
- Database name: `nof1`
- Username: `trading_user` (or `postgres`)
- Password: The password you set
- Host: `localhost`
- Port: `5432`

Step 4: Obtain the Binance API Key
#### Virtual disk (recommended for beginners):

1. Visit [Binance Virtual Disk](https://testnet.binancefuture.com/)
2. Log in using your GitHub account
3. Click on your profile picture in the upper right corner → API Key
4. Create a new API Key
5. Save the API Key and Secret Key

Real-time trading:

⚠️ **WARNING:** This trading session involves real money. Please trade with extreme caution!

1. Log in to the [Binance website](https://www.binance.com/)
2. Account → API Management
3. Create an API Key
4. **Important: Configure API permissions** (Failure to configure will result in an error)
**Last Updated: November 3, 2025**
- ✅ Enable spot and leveraged trading
- ✅ Enable futures trading
- ✅ Enable read permission
5. **Configure an IP whitelist** (otherwise, transactions will not be possible)

6. Save the API Key and Secret Key

### Step 5: Obtain the AI ​​API Key (Optional)

#### Option A: DeepSeek (Recommended)
1. Visit the DeepSeek website (https://platform.deepseek.com/).
2. Register an account and log in
3. Go to the API Keys page
4. Create a new API Key
5. Save the API Key
(It's best to use Deepseek; Openrouter doesn't need to be configured.)

Option B: OpenRouter (generally not used)
1. Visit [OpenRouter](https://openrouter.ai/)
2. Register an account and log in
3. Create an API Key

4. Save the API Key

Step 6: Clone the project
bash
# Cloning Repository

git clone git@github.com:qingshungLI/Super-nof1.ai.git
# Enter the project directory
cd Super-nof1.ai

```

Step 7: Install project dependencies
bash
# Using npm

npm install
# Or use yarn

yarn install
# Or use pnpm (recommended, faster)
npm install -g pnpm
pnpm install

```

**Installation Time:** Depending on your network speed, it may take 5-15 minutes.
**If you encounter network problems:**
bash
# Use domestic mirrors
npm config set registry https://registry.npmmirror.com
npm install

```

Step 8: Configure Environment Variables
1. **Copy Environment Variable Template**
bash
# Windows

copy .env.example .env
# macOS/Linux
cp .env.example .env

```

2. **Edit the `.env` file (configure the database, the four Binance keys, the trading mode, and the Deepseek API key)**

Open the `.env` file using any text editor and fill in the following configuration:
```env
# ==========================================
# Database Configuration
# ==========================================
# Format: postgresql://username:password@host:port/databasename
**DATABASE_URL="postgresql://trading_user:(your_secure_password)@localhost:5432/nof1"**
  
Enter your password in #(your_secure_password) (remove the parentheses; they're for formatting). (nof1) can be replaced with your database name.
# Proxy configuration (Access from mainland China requires a proxy and a non-Chinese, non-US IP address)
# ==========================================
# If you need to access the Binance API through a proxy (Calsh requires port 7890, V2Ray requires port 10809)
BINANCE_HTTP_PROXY=http://127.0.0.1:7890
# Set to true if no proxy is needed

  
# BINANCE_DISABLE_PROXY=true
# ==========================================
# Binance API Configuration (Important Update!)

   
# ==========================================
# Virtual Disk API Configuration
**BINANCE_TESTNET_API_KEY="Your Virtual Disk API Key"
BINANCE_TESTNET_API_SECRET="Your Virtual Disk API Key Secret"**
BINANCE_TESTNET_BASE_URL="https://demo-fapi.binance.com"
#APIs need to retain quotes!
# Live Trading API Configuration
**BINANCE_LIVE_API_KEY="Your Live Trading API Key"
BINANCE_LIVE_API_SECRET="Your Live Trading API Key Secret"**

BINANCE_LIVE_BASE_URL="https://fapi.binance.com"
# Request timeout (It is recommended to leave this unchanged, as it has been tested)
   

BINANCE_FETCH_TIMEOUT_MS="25000"
# Trading Mode: Dry-run (virtual trading) or Live (real trading)
# 💡 You only need to modify this one parameter to switch modes! The system will automatically use the corresponding API configuration.
TRADING_MODE="dry-run"
 
# If it's changed to "live," then it's real-time trading.
# Risk Control Parameters (Risk control applicable to both virtual and live trading; user-configurable)
MAX_POSITION_SIZE_USDT=5000 # Maximum position size in USDT (increased for aggressive strategy)
MAX_LEVERAGE=30 # Maximum allowed leverage (increased to 30x for high-yield strategy)

 
DAILY_LOSS_LIMIT_PERCENT=20 # Maximum daily loss limit as a percentage of capital (20% for aggressive trading)
# ==========================================
# AI Model Configuration
# ==========================================
# DeepSeek API Key (Recommended)

**DEEPSEEK_API_KEY="Your DeepSeek Key"**
# ==========================================
# Application configuration (required)
# ==========================================
NEXT_PUBLIC_URL="http://localhost:3000"





CRON_SECRET_KEY="secretkey_change_this_in_production"

Step 9: Initialize the database
bash
# Generate Prisma client

npx prisma generate
# Create database table structure



npx prisma db push
**If you encounter a database connection error:**
- Check if DATABASE_URL is correct.
- Verify that the PostgreSQL service is running (if you find that you cannot connect to the database in pgAdmin after opening your computer (red cross), you need to open Services - PostgreSQL and start it by right-clicking).

- Verify that the database password and database name are correct.

Step 10: Start the project
bash
# Start Development Mode

npm run dev
# Or use yarn

yarn dev
# Or use pnpm
pnpm dev

```
**After successful startup**:
- Visit http://localhost:3000 to view the front-end interface
- The system will automatically begin executing AI trading decisions (every 3 minutes).

- The log will display: `🎮 Trading Mode: DRY-RUN (Virtual Trading)`
**To switch between demo and live trading strategies:**



- Simply configure both APIs in your .env file, then swap the TRADING_MODE (live) and dry-run settings.

### Database Management
Simply download and view it in the pgAdmin visual interface.
<img width="1518" height="1143" alt="image" src="https://github.com/user-attachments/assets/1ec01f5d-ddc5-4922-911a-5981a02c7acb" />

You can see data fluctuations in the dashboard at the top right, and perform queries using database languages ​​in SQL.

## 📊 Detailed Explanation of Database Models
### Chat Table (AI Decision Records)
```prisma
model Chat {
id String @id @default(cuid())
model String // AI model name
chat String @db.Text // AI analysis content
reasoning String? @db.Text // Reasoning process
userPrompt String @db.Text // User prompt text
tradings Trading[] // Related transactions
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
}

```
### Trading Table (Transaction Records)
```prisma
model Trading {
id String @id @default(cuid())
symbol String // Trading pair, such as BTC
operation String // Operation: Buy/Sell/Hold
pricing Float? // Price
amount Float? // Quantity
leverage Int? // Leverage ratio
stopLossPercent Float? // Stop Loss Percent
takeProfitPercent Float? // Profit-taking percentage
orderId (String) // Order ID
status String @default("pending") // Status
pnl Float? // Profit and Loss
exitReason String? // Exit reason
chat Chat @relation(...)
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
}

```
### Metrics Table (Performance Metrics)
```prisma
model Metrics {
id String @id @default(cuid())
name String // Indicator name
model String // Model version
data Json // Metric data (JSON format)
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
}

```
### LessonLearned Table (Learning Feedback)
```prisma
model LessonLearned {
id String @id @default(cuid())
tradeId String // Associated transaction ID
symbol String // Trading pair
outcome String // Result: profit/loss
pnl Float // Profit/Loss Amount
lesson String @db.Text // The lesson learned
Indicators Json // Technical Indicator Snapshot
createdAt DateTime @default(now())
}


```

## 🤝 Contribution Guidelines
We welcome you to submit Issue and Pull Requests!



Contact information: email: 2731468336@qq.com

## 📄 License


MIT License - See the [LICENSE](LICENSE) file for details.

**Disclaimer:** This project is for learning and research purposes only and does not constitute any investment advice. Cryptocurrency trading carries a high degree of risk and may result in the loss of some or all of your principal. Users assume all risks associated with using this system for live trading. The developers are not responsible for any trading losses.
**Risk Warning**:
- 📉 The cryptocurrency market is extremely volatile and can cause significant losses in a short period of time.
AI systems cannot guarantee profitability; past performance is not indicative of future results.
- 💰 Only invest the amount you can afford to lose.

- 📚 Please fully understand the relevant risks before investing.

---
Version: v1.0.0
**Maintenance Status:** 🟢 Active Maintenance




## 中文版本
# Super NOF1.ai - AI 驱动的加密货币交易系统

inspired by alpha arena和open-nof1.ai项目，本项目在open-nof1.ai基础之上全面改进（prompt,数据获取，添加了反馈逻辑，优化了Ui页面和图标显示），一个基于人工智能的自动化加密货币期货交易系统，使用 Next.js 构建，集成币安期货 API 和 DeepSeek AI 模型。之后我们将对算法、prompt、模型、分析方法和交易逻辑进行全面改进，欢迎持续关注！

## 更新
11.3
- 修改前端中trade小数精度不足不显示的问题，并添加内容
- 修改前端chat一次输出五条信息的问题，现在只输出一条信息，节省空间

  操作指南：
  - 复制"lib\ai\run.ts"   "prisma\schma.prisma"  "component\models_view.tsx" “app/api/cron/3-minutes-run-interval/route.ts” "cron.ts"五个文件到本地覆盖原文件
  - 更新数据库在命令行中执行：
    ```
    npx prisma db push
    npx prisma generate
    ```
再运行 ``` npm run dev```即可使用
## pipeline
交易逻辑：从官方api调取实时市场数据，每三分钟调用一次deepseek LLMs api，大模型经过精心准备输入的prompt，给出分析之后的策略，调用交易所api进行交易

## 核心特性

### AI 交易决策
- **多模型支持**：集成 DeepSeek Chat 模型进行市场分析
- **技术指标分析**：RSI、MACD、EMA、成交量等多维度分析
- **风险管理**：自动止损止盈、动态杠杆调整
- **学习反馈**：从历史交易中总结经验，持续优化策略

### 交易功能
- **自动化交易**：支持多币种同时交易（BTC、ETH、SOL、BNB、DOGE）
- **止盈止损**：自动设置和管理止损止盈订单
- **持仓管理**：实时监控持仓状态和盈亏
- **风险控制**：多层风险保护机制

###  数据可视化
- **实时图表**：账户余额、收益率等关键指标
- **交易历史**：完整的交易记录和 AI 决策日志
- **性能分析**：胜率、平均盈亏、最大回撤等统计

###  安全特性
- **模拟交易**：支持虚拟盘测试（demo-fapi.binance.com）
- **实盘模式**：可切换到真实交易
- **API 密钥加密**：敏感信息环境变量管理
- **代理支持**：支持通过代理访问币安 API

---

##  系统要求

在开始之前，请确保你的系统满足以下要求：

### 必需软件
- **Node.js** 18.0 或更高版本
- **npm** 或 **yarn** 包管理器
- **PostgreSQL** 14.0 或更高版本
- **Git** （用于克隆项目）

### 可选软件
- **代理工具**（如 Clash、V2Ray）用于访问币安 API
- **VSCode** 或其他代码编辑器

### 账户要求
- **币安账户**：需要注册并创建 API 密钥
- **DeepSeek API 密钥**：用于 AI 功能（可选，也可使用 OpenRouter）

---

##  完整安装指南

### 第 1 步：安装 Node.js

#### Windows 用户：
1. 访问 [Node.js 官网](https://nodejs.org/)
2. 下载 LTS 版本（推荐 18.x 或更高）
3. 运行安装程序，按默认选项安装
4. 打开命令提示符，验证安装：
```bash
node --version
npm --version
```

#### macOS 用户：
使用 Homebrew 安装：
```bash
brew install node@18
```

#### Linux 用户：
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

### 第 2 步：安装 PostgreSQL 数据库

#### Windows 用户：

1. **下载安装包**
   - 访问 [PostgreSQL 官网](https://www.postgresql.org/download/windows/)
   - 下载最新版本的安装程序（14.x 或更高）

2. **运行安装程序**
   - 双击安装文件
   - 选择安装路径（默认即可）
   - 设置超级用户（postgres）密码 **（请牢记此密码！）**
   - 端口号使用默认 5432
   - 选择默认语言环境

3. **验证安装**
   ```bash
   # 打开命令提示符
   psql --version
   ```

4. **配置环境变量**（如果 psql 命令不可用）
   - 右键"此电脑" → 属性 → 高级系统设置 → 环境变量
   - 在系统变量的 Path 中添加：`C:\Program Files\PostgreSQL\14\bin`

#### macOS 用户：

1. **使用 Homebrew 安装**
   ```bash
   brew install postgresql@14
   brew services start postgresql@14
   ```

2. **验证安装**
   ```bash
   psql --version
   ```

#### Linux 用户：

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 验证安装
psql --version
```

### 第 3 步：创建数据库

1. **连接到 PostgreSQL**

   **Windows:**
   ```bash
   # 打开命令提示符，输入：
   psql -U postgres
   # 输入你在安装时设置的密码
   ```

   **macOS/Linux:**
   ```bash
   sudo -u postgres psql
   ```

2. **创建数据库和用户**
   ```sql
   -- 创建数据库
   CREATE DATABASE nof1;

   -- 创建用户（可选，建议使用）
   CREATE USER trading_user WITH PASSWORD 'your_secure_password';

   -- 授予权限
   GRANT ALL PRIVILEGES ON DATABASE trading_db TO trading_user;

   -- 退出 psql
   \q
   ```

3. **记录数据库连接信息**
   - 数据库名：`nof1`
   - 用户名：`trading_user`（或 `postgres`）
   - 密码：你设置的密码
   - 主机：`localhost`
   - 端口：`5432`

### 第 4 步：获取币安 API 密钥
#### 虚拟盘（推荐新手先使用）：

1. 访问 [币安虚拟盘](https://testnet.binancefuture.com/)
2. 使用 GitHub 账号登录
3. 点击右上角头像 → API Key
4. 创建新的 API Key
5. 保存 API Key 和 Secret Key

#### 实盘：

⚠️ **警告：实盘涉及真实资金，请谨慎操作！**

1. 登录 [币安官网](https://www.binance.com/)
2. 账户 → API 管理
3. 创建 API Key
4. **重要：配置 API 权限**（若不配置会报错）
   - ✅ 启用现货和杠杆交易
   - ✅ 启用期货交易
   - ✅ 启用读取权限
5. **配置 IP 白名单**(不然无法交易)
6. 保存 API Key 和 Secret Key

### 第 5 步：获取 AI API 密钥（可选）

#### 方案 A：DeepSeek（推荐）

1. 访问 [DeepSeek 官网](https://platform.deepseek.com/)
2. 注册账号并登录
3. 进入 API Keys 页面
4. 创建新的 API Key
5. 保存 API Key
（最好使用deepseek,openrouter可以不配置）
#### 方案 B：OpenRouter(一般不用)

1. 访问 [OpenRouter](https://openrouter.ai/)
2. 注册账号并登录
3. 创建 API Key
4. 保存 API Key

### 第 6 步：克隆项目

```bash
# 克隆仓库
git clone git@github.com:qingshungLI/Super-nof1.ai.git

# 进入项目目录
cd Super-nof1.ai
```

### 第 7 步：安装项目依赖

```bash
# 使用 npm
npm install

# 或使用 yarn
yarn install

# 或使用 pnpm（推荐，速度更快）
npm install -g pnpm
pnpm install
```

**安装时间**：根据网络速度，可能需要 5-15 分钟

**如果遇到网络问题**：
```bash
# 使用国内镜像
npm config set registry https://registry.npmmirror.com
npm install
```

### 第 8 步：配置环境变量

1. **复制环境变量模板**
   ```bash
   # Windows
   copy .env.example .env

   # macOS/Linux
   cp .env.example .env
   ```

2. **编辑 `.env` 文件（配置数据库，币安四个key，交易模式和deepseek api key）**

   使用任意文本编辑器打开 `.env` 文件，填写以下配置：

   ```env
   # ==========================================
   # 数据库配置
   # ==========================================
   # 格式：postgresql://用户名:密码@主机:端口/数据库名
   **DATABASE_URL="postgresql://trading_user:(your_secure_password)@localhost:5432/nof1"**
   #(your_secure_password)里面填入密码(去掉括号，括号是为好看),(nof1)可以替换成为你的数据库名称
  
   # 代理配置（在中国大陆访问需要代理并且需要非中非美ip）
   # ==========================================
   # 如果需要通过代理访问币安 API（calsh需用端口7890，V2Ray端口10809）
   BINANCE_HTTP_PROXY=http://127.0.0.1:7890
   # 如果不需要代理，设置为 true
   # BINANCE_DISABLE_PROXY=true

  
   # ==========================================
   # 币安 API 配置（重要更新！）
   # ==========================================

   
   # 虚拟盘 API 配置
   **BINANCE_TESTNET_API_KEY="你的虚拟盘API密钥"
   BINANCE_TESTNET_API_SECRET="你的虚拟盘API密钥Secret"**
   BINANCE_TESTNET_BASE_URL="https://demo-fapi.binance.com"
   #API需要保留引号！
   # 实盘 API 配置
   **BINANCE_LIVE_API_KEY="你的实盘API密钥"
   BINANCE_LIVE_API_SECRET="你的实盘API密钥Secret"**
   BINANCE_LIVE_BASE_URL="https://fapi.binance.com"

   #请求超时时间（建议不动，已经过测试）
   BINANCE_FETCH_TIMEOUT_MS="25000"
   

   # 交易模式：dry-run（虚拟盘）或 live（实盘）
   # 💡 只需修改这一个参数即可切换模式！系统会自动使用对应的 API 配置
   TRADING_MODE="dry-run"
   # 如果改成live就是实盘操控
 
   # Risk Control Parameters (风险控制，适用于虚拟盘和实盘 / Apply to both virtual and live trading，可自行设定)
   MAX_POSITION_SIZE_USDT=5000  # 最大持仓Maximum position size in USDT (increased for aggressive strategy)
   MAX_LEVERAGE=30  # 最大杠杆Maximum allowed leverage (increased to 30x for high-yield strategy)
   DAILY_LOSS_LIMIT_PERCENT=20  # 最大日损失限制Daily loss limit as percentage of capital (20% for aggressive trading)

 
   # ==========================================
   # AI 模型配置
   # ==========================================
   # DeepSeek API Key（推荐）
   **  DEEPSEEK_API_KEY="你的DeepSeek密钥"**

   # ==========================================
   # 应用配置（必需）
   # ==========================================
   NEXT_PUBLIC_URL="http://localhost:3000"
   CRON_SECRET_KEY="secretkey_change_this_in_production"





### 第 9 步：初始化数据库

```bash
# 生成 Prisma 客户端
npx prisma generate

# 创建数据库表结构
npx prisma db push



**如果遇到数据库连接错误**：
- 检查 DATABASE_URL 是否正确
- 确认 PostgreSQL 服务是否运行（若打开电脑后发现pgAdmin的数据库前无法连接（红色叉），需要打开服务-postgresql右键启动）
- 验证数据库密码和数据库名称是否正确

### 第 10 步：启动项目

```bash
# 开发模式启动
npm run dev

# 或使用 yarn
yarn dev

# 或使用 pnpm
pnpm dev
```

**启动成功后**：
- 访问 http://localhost:3000 查看前端界面
- 系统会自动开始执行 AI 交易决策（每 3 分钟一次）
- 日志会显示：`🎮 Trading Mode: DRY-RUN (Virtual Trading)`

**若要切换模拟盘和实盘策略**：
- 只需在.env中配置好两种API之后，将TRADING_MODE live和dry-run对调即可



### 数据库管理

只需下载之后在pgAdmin可视化界面中查看
<img width="1518" height="1143" alt="image" src="https://github.com/user-attachments/assets/1ec01f5d-ddc5-4922-911a-5981a02c7acb" />
在右上的dashboard中看到数据波动，在SQL中可利用数据库语言进行查询

## 📊 数据库模型详解

### Chat 表（AI 决策记录）
```prisma
model Chat {
  id          String    @id @default(cuid())
  model       String    // AI 模型名称
  chat        String    @db.Text  // AI 分析内容
  reasoning   String?   @db.Text  // 推理过程
  userPrompt  String    @db.Text  // 用户提示词
  tradings    Trading[] // 关联的交易
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

### Trading 表（交易记录）
```prisma
model Trading {
  id              String    @id @default(cuid())
  symbol          String    // 交易对，如 BTC
  operation       String    // 操作: Buy/Sell/Hold
  pricing         Float?    // 价格
  amount          Float?    // 数量
  leverage        Int?      // 杠杆倍数
  stopLossPercent Float?    // 止损百分比
  takeProfitPercent Float?  // 止盈百分比
  orderId         String?   // 订单 ID
  status          String    @default("pending")  // 状态
  pnl             Float?    // 盈亏
  exitReason      String?   // 退出原因
  chat            Chat      @relation(...)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

### Metrics 表（性能指标）
```prisma
model Metrics {
  id        String   @id @default(cuid())
  name      String   // 指标名称
  model     String   // 模型版本
  data      Json     // 指标数据（JSON 格式）
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### LessonLearned 表（学习反馈）
```prisma
model LessonLearned {
  id         String   @id @default(cuid())
  tradeId    String   // 关联的交易 ID
  symbol     String   // 交易对
  outcome    String   // 结果: profit/loss
  pnl        Float    // 盈亏金额
  lesson     String   @db.Text  // 学到的教训
  indicators Json     // 技术指标快照
  createdAt  DateTime @default(now())
}
```


## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！
联系方式：email:2731468336@qq.com



## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件


**免责声明**：本项目仅供学习和研究使用，不构成任何投资建议。加密货币交易具有高风险，可能导致部分或全部本金损失。使用本系统进行实盘交易的所有风险由用户自行承担。开发者不对任何交易损失负责。

**风险提示**：
- 📉 加密货币市场波动极大，可能在短时间内造成重大损失
- 🤖 AI 系统不能保证盈利，过去的表现不代表未来结果
- 💰 只投入你能承受损失的资金
- 📚 在投资前请充分了解相关风险

---

**版本**：v1.0.0  
**最后更新**：2025年11月3日  
**维护状态**：🟢 活跃维护中
