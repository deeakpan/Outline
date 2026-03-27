// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./OutlineParimutuelToken.sol";

/// @notice Minimal Chainlink AggregatorV3 interface.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/// @notice Minimal ERC-4626 interface (Morpho vault).
interface IERC4626 {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function previewRedeem(uint256 shares) external view returns (uint256);
}

/// @notice Minimal factory interface — used to fetch the fee recipient.
interface IOutlineFactory {
    function owner() external view returns (address);
}

/// @title OutlineParimutuelMarket
/// @notice Range prediction market with PENDING → LIVE lifecycle and Morpho yield on all deposits.
///
///  Lifecycle:
///   PENDING  — waiting for opposing side to reach 50% of creator's stake
///   LIVE     — both sides funded; no new joins; waiting for expiry
///   SETTLED  — Chainlink price read at expiry; winners and losers paid
///   CANCELLED — creator cancelled while PENDING; all users refunded principal + yield
///
///  Yield:
///   Every deposit immediately flows into the Morpho ERC-4626 vault.
///   At settlement or cancellation all shares are redeemed in one call.
///   Losers receive proportional yield on their principal. Winners take the pool (minus 2% fee).
///
///  One side per user: a user can only be on BOUND or BREAK, not both.
contract OutlineParimutuelMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Status ───────────────────────────────────────────────────────────────

    enum MarketStatus { PENDING, LIVE, SETTLED, CANCELLED }

    // ─── Market config ────────────────────────────────────────────────────────

    struct MarketConfig {
        string asset;
        uint256 lowerBound;
        uint256 upperBound;
        uint256 expiryTimestamp;
        uint256 creationTimestamp;
        uint256 startPrice;
        bool initialized;
    }

    MarketConfig private _config;

    /// @notice Read market config as a tuple.
    function marketConfig() external view returns (
        string memory asset,
        uint256 lowerBound,
        uint256 upperBound,
        uint256 expiryTimestamp,
        uint256 creationTimestamp,
        uint256 startPrice,
        bool initialized
    ) {
        return (
            _config.asset,
            _config.lowerBound,
            _config.upperBound,
            _config.expiryTimestamp,
            _config.creationTimestamp,
            _config.startPrice,
            _config.initialized
        );
    }

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20  public immutable collateralToken;
    IERC4626 public immutable morphoVault;
    OutlineParimutuelToken public immutable boundToken;
    OutlineParimutuelToken public immutable breakToken;
    address public immutable creator;
    address public immutable factory;

    // ─── State ────────────────────────────────────────────────────────────────

    MarketStatus public status;
    AggregatorV3Interface public chainlinkFeed;

    /// @notice Did the creator bet BOUND (true) or BREAK (false)?
    bool public creatorSide;

    // USDC principal pools (6 decimals)
    uint256 public boundPool;
    uint256 public breakPool;

    // Morpho accounting
    uint256 public totalMorphoShares;    // live share balance while market is open
    uint256 public totalPrincipal;       // sum of all user USDC deposits
    uint256 private _snapshotShares;     // snapshot of totalMorphoShares taken at redeem time

    // Settled / cancelled state
    uint256 public totalRedeemed;        // USDC returned from Morpho at settlement / cancel
    uint256 public totalYield;           // totalRedeemed - totalPrincipal

    // Per-user accounting (one side only)
    struct UserPosition {
        uint256 principal;
        uint256 morphoShares;
        bool isBound;
        bool exists;
        bool claimed;
    }
    mapping(address => UserPosition) public positions;
    address[] public participants;

    // Settlement state
    bool public boundWins;
    uint256 public resolvedPrice;
    uint256 public redemptionRate;    // (winnings * 1e18) / winningTokenSupply

    // Constants
    uint256 public constant PROTOCOL_FEE_BPS = 180; // 1.8% → protocol
    uint256 public constant CREATOR_FEE_BPS  = 20;  // 0.2% → market creator
    uint256 public constant BPS_DENOMINATOR  = 10000;
    uint256 public constant EMERGENCY_DELAY = 7 days;
    uint256 public constant PRICE_STALENESS_LIMIT = 1 hours;

    // ─── Events ───────────────────────────────────────────────────────────────

    event MarketInitialized(string asset, uint256 lowerBound, uint256 upperBound, uint256 expiry, bool creatorSide);
    event MarketLive(uint256 boundPool, uint256 breakPool);
    event BoundPurchased(address indexed buyer, uint256 usdcAmount, uint256 tokens);
    event BreakPurchased(address indexed buyer, uint256 usdcAmount, uint256 tokens);
    event MarketSettled(bool boundWins, uint256 resolvedPrice, uint256 totalPool, uint256 totalYield);
    event MarketCancelled();
    event WinnerRedeemed(address indexed user, uint256 tokens, uint256 payout);
    event LoserYieldClaimed(address indexed user, uint256 yieldAmount);
    event RefundClaimed(address indexed user, uint256 principal, uint256 yieldAmount);
    event EmergencyWithdrawal(address indexed user, bool isBound, uint256 refund);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _collateralToken,
        address _morphoVault,
        address _boundToken,
        address _breakToken,
        address _creator,
        address _factory
    ) {
        collateralToken = IERC20(_collateralToken);
        morphoVault = IERC4626(_morphoVault);
        boundToken = OutlineParimutuelToken(_boundToken);
        breakToken = OutlineParimutuelToken(_breakToken);
        creator = _creator;
        factory = _factory;
    }

    // ─── Initialization (factory only) ────────────────────────────────────────

    /// @notice Called by the factory immediately after deployment.
    ///         The factory must have already transferred `creatorAmount` USDC to this contract.
    function initialize(
        string calldata asset,
        address _chainlinkFeed,
        uint256 bandPercent,
        uint256 expiryTimestamp,
        bool _creatorSide,
        uint256 creatorAmount
    ) external {
        require(msg.sender == factory, "Only factory");
        require(!_config.initialized, "Already initialized");
        require(_chainlinkFeed != address(0), "Zero feed");
        require(expiryTimestamp > block.timestamp, "Invalid expiry");
        require(creatorAmount > 0, "Zero creator amount");

        chainlinkFeed = AggregatorV3Interface(_chainlinkFeed);

        uint256 startPrice = _getChainlinkPrice();
        uint256 delta = (startPrice * bandPercent) / 10000;
        uint256 lowerBound = startPrice - delta;
        uint256 upperBound = startPrice + delta;
        require(lowerBound < upperBound, "Invalid bounds");

        _config = MarketConfig({
            asset: asset,
            lowerBound: lowerBound,
            upperBound: upperBound,
            expiryTimestamp: expiryTimestamp,
            creationTimestamp: block.timestamp,
            startPrice: startPrice,
            initialized: true
        });

        creatorSide = _creatorSide;

        // Split creator deposit 50/50 so both pools are seeded equally → price starts at 0.5.
        uint256 half = creatorAmount / 2;
        boundPool     = half;
        breakPool     = creatorAmount - half; // handles odd-wei amounts cleanly
        totalPrincipal = creatorAmount;

        // Deposit the full amount into Morpho in a single call.
        collateralToken.forceApprove(address(morphoVault), creatorAmount);
        uint256 sharesReceived = morphoVault.deposit(creatorAmount, address(this));
        totalMorphoShares = sharesReceived;

        // Track creator's position — they own the full deposit, tokens only for their chosen side.
        positions[creator].exists      = true;
        positions[creator].isBound     = _creatorSide;
        positions[creator].principal   = creatorAmount;
        positions[creator].morphoShares = sharesReceived;
        participants.push(creator);

        // At 50/50 price (0.5): tokens = half * 1e18 / 5e17 = creatorAmount.
        uint256 creatorTokens = creatorAmount;
        if (_creatorSide) {
            boundToken.mint(creator, creatorTokens);
        } else {
            breakToken.mint(creator, creatorTokens);
        }

        // Both pools are equal from the start → market is immediately LIVE.
        status = MarketStatus.LIVE;
        emit MarketLive(boundPool, breakPool);

        emit MarketInitialized(asset, lowerBound, upperBound, expiryTimestamp, _creatorSide);
    }

    // ─── Join ─────────────────────────────────────────────────────────────────

    /// @notice Buy BOUND tokens. Market must be PENDING or LIVE and not expired.
    function joinBound(uint256 amount, uint256 minTokensOut) external nonReentrant {
        _requireOpen();
        require(amount > 0, "Zero amount");

        // Enforce single side per user.
        if (positions[msg.sender].exists) {
            require(positions[msg.sender].isBound, "Already on BREAK side");
        }

        // Preview tokens before state changes for slippage check.
        uint256 tokensOut = _previewTokens(amount, true);
        require(tokensOut >= minTokensOut, "Slippage: insufficient tokens");

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        _deposit(msg.sender, amount, true);

        emit BoundPurchased(msg.sender, amount, tokensOut);
    }

    /// @notice Buy BREAK tokens. Market must be PENDING or LIVE and not expired.
    function joinBreak(uint256 amount, uint256 minTokensOut) external nonReentrant {
        _requireOpen();
        require(amount > 0, "Zero amount");

        if (positions[msg.sender].exists) {
            require(!positions[msg.sender].isBound, "Already on BOUND side");
        }

        uint256 tokensOut = _previewTokens(amount, false);
        require(tokensOut >= minTokensOut, "Slippage: insufficient tokens");

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        _deposit(msg.sender, amount, false);

        emit BreakPurchased(msg.sender, amount, tokensOut);
    }

    // ─── Cancel ───────────────────────────────────────────────────────────────

    /// @notice Creator cancels while PENDING. Redeems all Morpho shares immediately.
    function cancel() external nonReentrant {
        require(msg.sender == creator, "Only creator");
        require(status == MarketStatus.PENDING, "Only PENDING");

        status = MarketStatus.CANCELLED;
        _redeemAll();

        emit MarketCancelled();
    }

    /// @notice Claim full refund (principal + proportional yield) after cancellation.
    function claimRefund() external nonReentrant {
        require(status == MarketStatus.CANCELLED, "Not cancelled");
        UserPosition storage pos = positions[msg.sender];
        require(pos.exists && pos.principal > 0, "No position");
        require(!pos.claimed, "Already claimed");
        pos.claimed = true;

        uint256 yieldShare = _yieldShare(pos.morphoShares);
        uint256 total = pos.principal + yieldShare;
        collateralToken.safeTransfer(msg.sender, total);

        emit RefundClaimed(msg.sender, pos.principal, yieldShare);
    }

    // ─── Settlement ───────────────────────────────────────────────────────────

    /// @notice Settle the market after expiry. Anyone can call this.
    function settle() external nonReentrant {
        require(_config.initialized, "Not initialized");
        require(status == MarketStatus.PENDING || status == MarketStatus.LIVE, "Cannot settle");
        require(block.timestamp >= _config.expiryTimestamp, "Not expired");

        uint256 finalPrice = _getChainlinkPrice();
        boundWins = finalPrice >= _config.lowerBound && finalPrice <= _config.upperBound;
        resolvedPrice = finalPrice;
        status = MarketStatus.SETTLED;

        _redeemAll();

        // Fee is taken from the losing pool only: 1.8% to protocol, 0.2% to market creator.
        uint256 loserPool   = boundWins ? breakPool : boundPool;
        uint256 protocolFee = (loserPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 creatorFee  = (loserPool * CREATOR_FEE_BPS)  / BPS_DENOMINATOR;
        uint256 totalFee    = protocolFee + creatorFee;

        // Winners receive: totalPrincipal - totalFee.
        // Losers receive:  their yield share (via claimLoserYield).
        uint256 winnings = totalPrincipal - totalFee;
        uint256 winningSupply = boundWins ? boundToken.totalSupply() : breakToken.totalSupply();

        if (winningSupply > 0 && winnings > 0) {
            redemptionRate = (winnings * 1e18) / winningSupply;
        }

        if (protocolFee > 0) {
            collateralToken.safeTransfer(IOutlineFactory(factory).owner(), protocolFee);
        }
        if (creatorFee > 0) {
            collateralToken.safeTransfer(creator, creatorFee);
        }

        emit MarketSettled(boundWins, finalPrice, boundPool + breakPool, totalYield);
    }

    /// @notice Winners redeem position tokens for USDC payout.
    function redeemWinner(uint256 tokenAmount) external nonReentrant {
        require(status == MarketStatus.SETTLED, "Not settled");
        require(redemptionRate > 0, "No redemption rate");
        require(tokenAmount > 0, "Zero amount");

        OutlineParimutuelToken winToken = boundWins ? boundToken : breakToken;
        require(winToken.balanceOf(msg.sender) >= tokenAmount, "Insufficient winning tokens");

        uint256 payout = (tokenAmount * redemptionRate) / 1e18;
        require(payout > 0, "Zero payout");

        winToken.burnFrom(msg.sender, tokenAmount);
        collateralToken.safeTransfer(msg.sender, payout);

        emit WinnerRedeemed(msg.sender, tokenAmount, payout);
    }

    /// @notice Losers claim their proportional yield after settlement.
    function claimLoserYield() external nonReentrant {
        require(status == MarketStatus.SETTLED, "Not settled");
        UserPosition storage pos = positions[msg.sender];
        require(pos.exists && pos.principal > 0, "No position");
        require(!pos.claimed, "Already claimed");

        bool isLoser = boundWins ? !pos.isBound : pos.isBound;
        require(isLoser, "Not a loser");

        pos.claimed = true;
        uint256 yieldShare = _yieldShare(pos.morphoShares);

        if (yieldShare > 0) {
            collateralToken.safeTransfer(msg.sender, yieldShare);
        }
        emit LoserYieldClaimed(msg.sender, yieldShare);
    }

    // ─── Emergency withdrawal ─────────────────────────────────────────────────

    /// @notice Safety net: proportional principal + yield refund after EMERGENCY_DELAY post-expiry
    ///         if the market was never settled or cancelled.
    function emergencyWithdraw() external nonReentrant {
        require(_config.initialized, "Not initialized");
        require(status != MarketStatus.SETTLED && status != MarketStatus.CANCELLED, "Use normal claims");
        require(block.timestamp > _config.expiryTimestamp + EMERGENCY_DELAY, "Delay not elapsed");

        // Redeem Morpho once if not already done.
        if (totalMorphoShares > 0) {
            _redeemAll();
        }
        status = MarketStatus.CANCELLED;

        UserPosition storage pos = positions[msg.sender];
        require(pos.exists && pos.principal > 0, "No position");
        require(!pos.claimed, "Already claimed");
        pos.claimed = true;

        uint256 total = pos.principal + _yieldShare(pos.morphoShares);
        collateralToken.safeTransfer(msg.sender, total);

        emit EmergencyWithdrawal(msg.sender, pos.isBound, total);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Estimated USDC payout if the caller's side wins, accounting for their own
    ///         purchase's impact on the pool and token supply.
    /// @param isBound    True for BOUND side, false for BREAK.
    /// @param usdcAmount USDC the user intends to spend (6 decimals).
    function getEstimatedPayout(bool isBound, uint256 usdcAmount) external view returns (uint256) {
        uint256 total = boundPool + breakPool;
        if (total == 0 || usdcAmount == 0) return 0;

        uint256 pool = isBound ? boundPool : breakPool;
        if (pool == 0) return 0;

        // Tokens the user would receive at the current price.
        uint256 price      = (pool * 1e18) / total;
        uint256 userTokens = (usdcAmount * 1e18) / price;
        if (userTokens == 0) return 0;

        // Simulate pool state after the purchase.
        uint256 newBoundPool = isBound ? boundPool + usdcAmount : boundPool;
        uint256 newBreakPool = isBound ? breakPool : breakPool + usdcAmount;
        uint256 newTotal     = newBoundPool + newBreakPool;

        // Fee on the loser pool (assuming this side wins).
        uint256 loserPool   = isBound ? newBreakPool : newBoundPool;
        uint256 totalFee    = (loserPool * (PROTOCOL_FEE_BPS + CREATOR_FEE_BPS)) / BPS_DENOMINATOR;
        uint256 winnings    = newTotal - totalFee;

        // User's share: their tokens vs new total winning supply after purchase.
        uint256 currentSupply = isBound ? boundToken.totalSupply() : breakToken.totalSupply();
        uint256 newSupply     = currentSupply + userTokens;

        return (userTokens * winnings) / newSupply;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Enforce market is open for new deposits.
    function _requireOpen() internal view {
        require(_config.initialized, "Not initialized");
        require(status == MarketStatus.PENDING || status == MarketStatus.LIVE, "Market not open");
        require(block.timestamp < _config.expiryTimestamp, "Expired");
    }

    /// @dev Deposit USDC (already in contract) into Morpho, track shares, mint tokens.
    ///      Pool is updated AFTER token calculation so price reflects pre-deposit state.
    function _deposit(address user, uint256 usdcAmount, bool isBound) internal {
        // Calculate tokens at current price BEFORE updating pool.
        uint256 tokensToMint = _previewTokens(usdcAmount, isBound);

        // Now update pool and principal totals.
        if (isBound) {
            boundPool += usdcAmount;
        } else {
            breakPool += usdcAmount;
        }
        totalPrincipal += usdcAmount;

        // Deposit into Morpho.
        collateralToken.forceApprove(address(morphoVault), usdcAmount);
        uint256 sharesReceived = morphoVault.deposit(usdcAmount, address(this));
        totalMorphoShares += sharesReceived;

        // Track per-user position.
        if (!positions[user].exists) {
            positions[user].exists = true;
            positions[user].isBound = isBound;
            participants.push(user);
        }
        positions[user].principal += usdcAmount;
        positions[user].morphoShares += sharesReceived;

        // Mint position tokens.
        if (isBound) {
            boundToken.mint(user, tokensToMint);
        } else {
            breakToken.mint(user, tokensToMint);
        }

        // Check PENDING → LIVE transition after updating pools.
        if (status == MarketStatus.PENDING) {
            _checkAndActivate();
        }
    }

    /// @dev Flip to LIVE if smaller side is at least 50% of larger side.
    function _checkAndActivate() internal {
        uint256 smaller = boundPool < breakPool ? boundPool : breakPool;
        uint256 larger  = boundPool > breakPool ? boundPool : breakPool;
        if (larger > 0 && smaller * 2 >= larger) {
            status = MarketStatus.LIVE;
            emit MarketLive(boundPool, breakPool);
        }
    }

    /// @dev Redeem all Morpho shares in one call. Snapshots share total for yield math.
    function _redeemAll() internal {
        if (totalMorphoShares == 0) return;
        _snapshotShares = totalMorphoShares;
        totalMorphoShares = 0;
        uint256 redeemed = morphoVault.redeem(_snapshotShares, address(this), address(this));
        totalRedeemed = redeemed;
        totalYield = redeemed > totalPrincipal ? redeemed - totalPrincipal : 0;
    }

    /// @dev User's proportional yield based on their share count vs total at redeem time.
    function _yieldShare(uint256 userShares) internal view returns (uint256) {
        if (totalYield == 0 || _snapshotShares == 0) return 0;
        return (userShares * totalYield) / _snapshotShares;
    }

    /// @dev Parimutuel token price = pool / totalPool (1e18 precision), pre-deposit.
    function _previewTokens(uint256 usdcAmount, bool isBound) internal view returns (uint256) {
        uint256 total = boundPool + breakPool;
        if (total == 0) {
            // First deposit: price = 0.5, so tokens = amount * 2. But for the very first deposit
            // (creator, only side) price = 1.0 is more intuitive. Use 1:1 for first depositor.
            return usdcAmount;
        }
        uint256 pool = isBound ? boundPool : breakPool;
        if (pool == 0) {
            // This side has no deposits yet — price approaches 0, tokens approach infinity.
            // Cap to prevent absurd minting: use 1:1 as a safe fallback.
            return usdcAmount;
        }
        uint256 price = (pool * 1e18) / total;
        return (usdcAmount * 1e18) / price;
    }

    /// @dev Read and validate Chainlink price, normalised to 6 decimals.
    function _getChainlinkPrice() internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = chainlinkFeed.latestRoundData();
        require(answer > 0, "Invalid Chainlink price");
        require(updatedAt > 0 && block.timestamp - updatedAt < PRICE_STALENESS_LIMIT, "Stale Chainlink price");
        uint8 dec = chainlinkFeed.decimals();
        uint256 price;
        if (dec >= 6) {
            price = uint256(answer) / (10 ** (dec - 6));
        } else {
            price = uint256(answer) * (10 ** (6 - dec));
        }
        require(price > 0, "Zero price");
        return price;
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getBoundPrice() external view returns (uint256) {
        uint256 total = boundPool + breakPool;
        if (total == 0) return 5e17;
        return (boundPool * 1e18) / total;
    }

    function getBreakPrice() external view returns (uint256) {
        uint256 total = boundPool + breakPool;
        if (total == 0) return 5e17;
        return (breakPool * 1e18) / total;
    }

    function getParticipantCount() external view returns (uint256) {
        return participants.length;
    }

    /// @notice Live preview of accrued yield (unredeemed). Returns 0 after settlement/cancel.
    function previewYield() external view returns (uint256) {
        if (totalMorphoShares == 0) return totalYield;
        uint256 currentValue = morphoVault.previewRedeem(totalMorphoShares);
        return currentValue > totalPrincipal ? currentValue - totalPrincipal : 0;
    }
}
