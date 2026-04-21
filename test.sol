// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 测试用基础合约：存储 + 读写 + 事件 + 权限控制
contract TestContract {
    // 状态变量：存储一个数字
    uint256 public number;
    // 合约部署者（所有者）
    address public immutable owner;

    // 事件：用于测试日志输出
    event NumberChanged(uint256 oldValue, uint256 newValue);

    // 构造函数：部署时自动执行
    constructor() {
        owner = msg.sender; // 部署者成为所有者
        number = 100; // 初始值
    }

    // 只读函数：测试读取数据
    function getNumber() external view returns (uint256) {
        return number;
    }

    // 写入函数：测试修改状态
    function setNumber(uint256 _newNumber) external {
        uint256 oldValue = number;
        number = _newNumber;
        emit NumberChanged(oldValue, _newNumber); // 触发事件
    }

    // 权限函数：仅所有者可调用（测试权限）
    function resetNumber() external onlyOwner {
        number = 0;
    }

    // 修饰器：权限控制
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
}