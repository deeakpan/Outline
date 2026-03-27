// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title OutlineParimutuelToken
/// @notice ERC20 token for BOUND or BREAK positions. Owned by the market contract.
contract OutlineParimutuelToken is ERC20, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        address factoryAddress
    ) ERC20(name, symbol) Ownable(factoryAddress) {}

    /// @notice Mint tokens — only the market (owner) can call.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn tokens from a user. Allowance required if caller != from.
    function burnFrom(address from, uint256 amount) external {
        if (msg.sender != from) {
            _spendAllowance(from, msg.sender, amount);
        }
        _burn(from, amount);
    }

    /// @notice 6 decimals — matches USDC.
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
