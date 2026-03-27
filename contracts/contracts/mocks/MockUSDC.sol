// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Mock USDC for testnet.
///         Only the owner can mint externally (via UI/script).
///         Authorized minters (e.g. MockMorphoVault) can also mint for internal yield simulation.
contract MockUSDC is ERC20, Ownable {
    mapping(address => bool) public isMinter;

    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);

    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function addMinter(address minter) external onlyOwner {
        isMinter[minter] = true;
        emit MinterAdded(minter);
    }

    function removeMinter(address minter) external onlyOwner {
        isMinter[minter] = false;
        emit MinterRemoved(minter);
    }

    /// @notice Mint USDC. Only owner or authorized minters (e.g. vault).
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner() || isMinter[msg.sender], "Not authorized to mint");
        _mint(to, amount);
    }
}
