// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MockUSDC.sol";

/// @notice Mock ERC-4626 vault for testnet.
///         Mints shares 1:1 on deposit. On redeem, returns principal + 1% by minting
///         extra MockUSDC — no reserve needed, no exhaustion possible.
///         previewRedeem reflects the 1% so the live yield ticker works correctly.
contract MockMorphoVault {
    using SafeERC20 for IERC20;

    MockUSDC public immutable usdc;

    // shares per user (shares are 1:1 with deposited USDC)
    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;
    uint256 public totalAssets;

    // 1% yield: redeem returns principal * 101 / 100
    uint256 public constant YIELD_BPS = 100;       // 1%
    uint256 public constant BPS_DENOMINATOR = 10000;

    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Redeem(address indexed caller, address indexed receiver, uint256 shares, uint256 assets);

    constructor(address _usdc) {
        usdc = MockUSDC(_usdc);
    }

    /// @notice ERC-4626: underlying asset.
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Deposit `assets` USDC, mint `assets` shares to `receiver` (1:1).
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assets > 0, "Zero assets");
        shares = assets; // 1:1

        IERC20(address(usdc)).safeTransferFrom(msg.sender, address(this), assets);

        sharesOf[receiver] += shares;
        totalShares += shares;
        totalAssets += assets;

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice Preview how much USDC `shares` redeems for (principal + 1%).
    function previewRedeem(uint256 shares) public pure returns (uint256) {
        return shares + (shares * YIELD_BPS) / BPS_DENOMINATOR;
    }

    /// @notice Redeem `shares` from `owner`, send USDC to `receiver`.
    ///         Extra 1% is minted from MockUSDC — no cap.
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(shares > 0, "Zero shares");
        require(sharesOf[owner] >= shares, "Insufficient shares");

        assets = previewRedeem(shares);

        sharesOf[owner] -= shares;
        totalShares -= shares;
        totalAssets -= shares; // subtract principal only

        // Mint the 1% bonus directly — mock USDC has no supply cap.
        uint256 bonus = assets - shares;
        if (bonus > 0) {
            usdc.mint(address(this), bonus);
        }

        IERC20(address(usdc)).safeTransfer(receiver, assets);

        emit Redeem(msg.sender, receiver, shares, assets);
    }
}
