# 稳定 Demo 路线

这条路线用于 10 分钟课程展示，目标是稳定展示智能合约核心功能：部署、LP 资金池、购买保单、MOCK 行情推进、保单状态、模拟器结果。

## 0. 演示前准备

1. 确认 Node.js 和 npm 可用。

```powershell
node -v
npm -v
```

2. 在项目根目录安装依赖。

```powershell
npm install
```

3. 生成前端运行配置。

```powershell
npm run build:runtime-config
```

确认文件存在：

```text
frontend/runtime-config.json
```

4. 运行完整测试。

```powershell
npm test
```

期望看到：

```text
40 passing
```

## 1. 启动本地链

打开第一个终端，不要关闭：

```powershell
npm run node
```

这个终端会显示 Hardhat 本地测试账户和私钥。

MetaMask 需要添加本地网络：

```text
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency symbol: ETH
```

建议导入两个账户：

```text
Account 0: admin / LP / deployer
Account 1: buyer
```

## 2. 部署本地合约

打开第二个终端：

```powershell
npm run deploy:local
```

这一步会完成：

- 部署 `MockUSDC`
- 部署 `InsuranceVault`
- 部署 `PricingOracle`
- 部署 `PolicyFactory`
- 部署 oracle adapter 和 automation helper
- 配置 AAPL、TSLA、NVDA、MSFT、港股和 MOCK 市场
- 给 vault 注入初始流动性
- 给 buyer 分配测试用 mUSDC
- 写入 `frontend/deployments/localhost.json`

## 3. 启动前端服务

打开第三个终端：

```powershell
npm run serve
```

浏览器打开：

```text
Buyer:     http://127.0.0.1:8080/index.html
Admin:     http://127.0.0.1:8080/admin.html
Simulator: http://127.0.0.1:8080/simulation.html
```

## 4. Buyer 页面演示

1. MetaMask 切换到 buyer 账户。
2. 打开 Buyer 页面。
3. 点击 `Connect Wallet`。
4. 点击 `Load Contracts`。
5. 展示页面自动读取的合约地址和 mUSDC 结算资产。
6. 切换几个标的，例如：

```text
AAPL
0700HK
MOCK
```

7. 对 AAPL 或港股展示一周 K 线和当前行情。
8. 切换到 `MOCK`。
9. 设置一个容易演示的保单参数，例如：

```text
Symbol: MOCK
Direction: Downside 或 Upside
Notional: 1500
Duration: 720 hours
Trigger: 10% 或 15%
Deductible: 25
Payout Cap: 800
```

10. 点击 `Get Quote`，展示保费、spot、strike、vol、probability、premium breakdown。
11. 点击 `Buy Policy`。
12. 在 MetaMask 中确认授权和购买交易。
13. 点击 `Load My Policies`，展示保单状态为 Active。

## 5. Admin 页面演示

1. MetaMask 切换到 admin / LP 账户。
2. 打开 Admin 页面。
3. 点击 `Connect Wallet`。
4. 点击 `Load Contracts`。
5. 确认 monitor holder 是 buyer 地址。
6. monitor symbol 选择 `MOCK`。
7. 点击 `Refresh Dashboard`，展示：

- vault TVL
- reserved liquidity
- utilization
- symbol exposure
- direction exposure
- term exposure
- oracle / risk provider

8. 点击 `Load MOCK Scenario`。
9. 点击 `Autoplay MOCK Month`。
10. 按 MetaMask 提示确认交易，观察 MOCK 价格和本地链时间被推进。
11. 观察 Admin 页面中的 monitored policies 是否进入 trigger zone 或 settled 状态。

## 6. 回到 Buyer 页面验证

1. 切回 Buyer 页面。
2. 保持 buyer 账户。
3. 点击 `Load My Policies`。
4. 查看刚才购买的 MOCK policy：

- Active: 尚未到期
- Expired + In Trigger Zone: 到期且当前价格进入触发区，等待结算
- Settled + Triggered: 已结算并触发赔付
- Settled + Not Triggered: 已结算但未赔付

如果显示 `Expired` 且 `In Trigger Zone (Awaiting Settlement)`，点击 `Settle Policy` 输入对应 policy id 完成结算。

## 7. Simulator 页面演示

1. 打开 Simulator 页面。
2. 点击 `Load Policy Pack`。
3. 展示至少 10 个模拟保单，包含：

- 大部分未触发保单
- 少量正常触发保单
- 一个 model miss / unpriced shock 保单

4. 点击 `Run Simulator`。
5. 解释结果：

- 高风险保单保费更高
- 大部分保单未触发，LP 盈利
- 少数触发保单赔付高于保费
- model miss 展示模型没有预测到的尾部风险

## 8. 推荐 10 分钟时间分配

- 0:00-1:00 项目问题和价值：股票波动风险、散户对冲、LP 承保收益。
- 1:00-2:30 系统架构：Buyer、PolicyFactory、PricingOracle、InsuranceVault、Oracle Adapter。
- 2:30-4:00 合约功能：购买、锁定准备金、取消、结算、自动化。
- 4:00-5:30 风控和安全：AccessControl、Pausable、ReentrancyGuard、SafeERC20、solvency checks。
- 5:30-8:30 实机演示：Buyer 买 MOCK policy，Admin 推进行情，Buyer 查看结算。
- 8:30-9:30 Simulator 结果：展示整体盈利和少数赔付。
- 9:30-10:00 局限性和未来扩展：真实 oracle、监管、专业定价模型、生产审计。

## 9. 常见问题

如果前端读取不到 policy：

- 确认浏览器强制刷新。
- 确认 MetaMask 是 buyer 账户。
- 确认本地链和部署文件是同一轮启动生成的。

如果交易一直失败：

- 先重新运行 `npm run deploy:local`。
- 确认 `npm run node` 的终端没有关闭。
- 确认 MetaMask 网络是 chain id `31337`。

如果希望使用最新合约逻辑：

- 关闭旧 Hardhat node。
- 重新运行 `npm run node`。
- 重新运行 `npm run deploy:local`。
- 刷新前端后重新购买保单。
