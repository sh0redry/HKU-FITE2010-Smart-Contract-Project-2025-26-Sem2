# Presentation 实机演示流程

这份文档用于答辩或课堂展示时，按固定顺序完成本地环境准备、前端启动、Buyer 演示、Admin 演示和 Simulator 演示。

建议提前至少 15 分钟完成一次完整排练，确保本地链、MetaMask、前端页面和 `MOCK` 演示都能正常工作。

## 一、演示前准备

### 1. 生成前端运行配置

在项目根目录执行：

```bash
npm run build:runtime-config
```

确认已经生成：

- `frontend/runtime-config.json`

### 2. 启动本地 Hardhat 节点

打开 2 号终端窗口，并保持运行：

```powershell
npm run node
```

这个终端会持续打印本地测试账户和私钥，不要关闭。

需要在 MetaMask 中导入至少两个账户：

- `Account 0`：作为 LP / Admin 管理账户
- `Account 1`：作为 Buyer 购买保单账户

建议将本地链配置为：

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency Symbol: `ETH`

### 3. 部署本地合约

打开 3 号终端窗口：

```powershell
npm run deploy:local
```

这一步会自动：

- 部署合约
- 配置市场
- 写部署地址到前端
- 初始化资金池

确认以下文件存在：

- `frontend/deployments/localhost.json`

### 4. 启动本地前端服务

打开 4 号终端窗口：

```bash
npm run serve
```

默认部署在：

- `http://127.0.0.1:8080/index.html`
- `http://127.0.0.1:8080/admin.html`
- `http://127.0.0.1:8080/simulation.html`

对应页面用途：

- Buyer: `http://127.0.0.1:8080/index.html`
- Admin: `http://127.0.0.1:8080/admin.html`
- Simulator: `http://127.0.0.1:8080/simulation.html`

## 二、Buyer 页面演示流程

### 1. 切换到 Buyer 账户

在 MetaMask 中切换到：

- `Account 1`

这个账户用于购买保单。

### 2. 连接钱包与加载合约

打开 Buyer 页面后，依次点击：

1. `Connect Wallet`
2. `Load Contracts`

确认页面能正常显示：

- 钱包地址
- 合约地址
- Vault 状态

### 3. 展示不同市场行情

在 `Ticker` 下拉框中依次切换展示：

- `AAPL`
- 港股标的，如 `0700HK` 或 `9988HK`
- 最后切换到 `MOCK`

演示重点：

- 不同市场的价格图与风险快照
- 美股与港股市场数据
- `MOCK` 用于后续完整演示

### 4. 更新市场价格

点击：

- `Sync Latest Market Price`

这一步会通过本地代理从行情源同步最新市场价格，并刷新前端价格图。

### 5. 购买保单

在 Buyer 页面点击：

1. `Get Quote`
2. `Buy Policy`

MetaMask 中通常会出现两次确认：

1. 第一次：授权代币或资金使用
2. 第二次：正式购买保单

依次点击 `Confirm`

### 6. 查看保单

购买完成后，点击：

- `Load My Policies`

检查：

- 当前账户下已购买的所有保单
- 保单状态
- trigger 状态
- entry / strike / payout 等信息

## 三、Admin 页面演示流程

### 1. 切换到 Admin / LP 账户

在 MetaMask 中切换到：

- `Account 0`

该账户作为 LP / Admin 管理者。

### 2. 连接钱包与加载合约

打开 Admin 页面后，依次点击：

1. `Connect Wallet`
2. `Load Contracts`

### 3. 加载并播放 MOCK 场景

翻到页面底部，依次点击：

1. `Load MOCK Scenario`
2. `Autoplay MOCK Month`

在播放过程中，MetaMask 会不断弹出交易确认，因为 Admin 需要持续把 `MOCK` 价格推进到下一根 candle。

操作方式：

- 持续点击 `Confirm`
- 直到 `MOCK` 月度路径播放完成

演示重点：

- Admin 可以控制 `MOCK` 路径回放
- 保单状态会随着价格变化进入或离开触发区
- 其中包含普通触发保单和 `Model Miss` 异常保单

## 四、Simulator 页面演示流程

### 1. 加载模拟保单组合

打开 Simulator 页面后，点击：

- `Load MOCK Pack`

这会载入一组预先配置好的 `MOCK` 保单组合，包含：

- 多张未触发保单
- 少量正常触发保单
- 一张 `Model Miss` 黑天鹅保单

### 2. 运行模拟

点击：

- `Run Simulation`

页面会显示：

- 所有保单的 entry / exit / strike / premium / payout
- 哪些保单被触发
- 哪些保单未触发
- 总 premium
- 总 payout
- 总体 P&L

演示时建议重点指出：

- 大多数保单未触发，因此池子整体盈利
- 少数保单触发时，赔付金额高于保费，体现保险价值
- `Model Miss` 保单代表模型未正确预测风险，导致赔付远高于定价

## 五、推荐演示顺序

建议严格按下面顺序进行：

1. `npm run build:runtime-config`
2. `npm run node`
3. `npm run deploy:local`
4. `npm run serve`
5. Buyer 页面购买保单
6. Admin 页面播放 `MOCK`
7. Simulator 页面展示组合结果

## 六、演示重点讲解建议

### Buyer 页面重点

- 用户如何查看市场价格
- 用户如何实时定价并购买保险
- 用户如何查看已购买保单

### Admin 页面重点

- 管理者如何监控和推进 `MOCK` 行情
- 保单如何随价格变化进入触发区
- 管理者如何看到协议的风险与运行状态

### Simulator 页面重点

- 多张保单的组合结果
- 大多数保单未触发，整体盈利
- 少数触发保单赔付高于保费
- `Model Miss` 展示量化模型失误或黑天鹅事件

## 七、常见问题

### 1. 页面打不开

确认：

- `npm run serve` 仍在运行
- 使用的是 `http://127.0.0.1:8080/...`

### 2. 无法连接钱包

确认：

- MetaMask 已切换到本地链 `31337`
- 已导入 Hardhat 本地账户

### 3. `Load MOCK Scenario` 不工作

确认：

- 当前 Admin 使用的是 `Account 0`
- 本地链和部署脚本已经重新执行过

### 4. 买保单失败

确认：

- 当前账户是 Buyer
- 已点击 `Get Quote`
- MetaMask 的两次交易都已确认

## 八、演示结束后的建议收尾

你可以用下面这个逻辑收尾：

1. Buyer 证明了用户端交互成立
2. Admin 证明了价格驱动和管理端能力成立
3. Simulator 证明了组合层面大多数保单不触发、整体盈利
4. `Model Miss` 说明模型并非完美，也会遇到黑天鹅风险

这会让你的 presentation 形成完整闭环。
